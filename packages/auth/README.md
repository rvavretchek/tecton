# @tecton/auth

The ready-made Auth service of Tecton. It stores credentials in its own database and issues EdDSA
(Ed25519) access tokens that every service verifies on its own through the public keys it
publishes (AD-7). No service but Auth can sign a token.

## Credentials

A credential is all the Auth service keeps about a subject, and nothing else:

| Field | Meaning |
|---|---|
| `id` | subject id, UUID v7 (AD-5) |
| `login` | normalized login identifier, unique |
| `passwordHash` | PHC string from the `AuthProvider` of `@tecton/providers` (Argon2id + Pepper), never the password |
| `status` | `active` or `disabled`; any other value read back fails closed |
| `permissions` | list in the manifest format, e.g. `tenant:create` |
| `createdAt`, `updatedAt` | from the `Clock` port |

Logins are normalized with `normalizeLogin`: Unicode NFKC, surrounding whitespace removed, lower
case. Accents are kept, so `josé` and `jose` are different logins on every database. Logins
with control, invisible (zero-width, bidirectional overrides, soft hyphen), separator,
private-use or unassigned characters are refused, so no login can look identical to another.

Only the Auth service reads or writes this database (AD-9). Other services learn who a user is
from the signed token, never from the table.

## Database

Set `TECTON_AUTH_DATABASE_URL` to one of:

| URL | Database |
|---|---|
| `postgresql://...` (or `postgres://`) | PostgreSQL |
| `mysql://...` or `mariadb://...` | MySQL or MariaDB |

The package ships one Prisma 7 schema and one generated client per SQL dialect (`prisma/postgresql`
and `prisma/mysql`), and picks the dialect from the URL. Switching databases changes the URL, not
code (NFR-4). A test keeps the two schemas identical apart from native column types.

Apply the migrations with:

```ts
import { applyAuthMigrations } from '@tecton/auth';

await applyAuthMigrations({ databaseUrl: process.env.TECTON_AUTH_DATABASE_URL! });
```

It runs `prisma migrate deploy` for the right dialect, with a 120 s timeout. The child process
gets only what the Prisma CLI needs plus the URL, never the Pepper or other secrets. Error messages
never contain the URL or its password. For PostgreSQL, `?schema=` in the URL is honored by both the
migrations and the runtime client. `tecton-admin migrate` (Story 6.1) will run it for every service.

## First administrator

Apply the migrations first, then:

```bash
export TECTON_AUTH_DATABASE_URL=postgresql://...   # direct access to the Auth database
export TECTON_AUTH_PEPPER=...                      # the same Pepper the service uses
export TECTON_AUTH_PEPPER_ID=1                     # and the same Pepper id (default 1)
printf '%s' "$PASSWORD" | tecton-admin auth bootstrap --login admin
```

- It works only while the Auth database has no credentials, and two runs at the same time never
  both succeed: the final check and the insert share one serializable transaction. Afterwards it
  refuses, changes nothing and exits with code 2. Other failures exit with 1.
- The password needs at least 12 characters (`MIN_ADMIN_PASSWORD_LENGTH`).
- The password comes from `TECTON_AUTH_BOOTSTRAP_PASSWORD` or standard input. There is no
  command-line option for it, so it never shows up in shell history or process lists. From an
  interactive terminal without the variable, the command asks you to pipe the password. Standard
  input must close within 10 seconds.
- Database errors are reported in one line, without the connection string.
- It writes directly to the database. There is no HTTP endpoint for bootstrapping (AD-7).
- The administrator gets `BOOTSTRAP_ADMIN_PERMISSIONS`:
  - `auth:service:register`, to register services (Story 2.7);
  - `auth:credential:create`, to create credentials (Story 4.3).

## Manifest

The package ships its own `tecton.yaml` (actions `login`, `refresh`, `logout`, `serviceToken`),
declared in `package.json` under `"tecton": { "manifests": ["./tecton.yaml"] }`. A domain that
lists `auth` in `dependencies` resolves through the installed package (`tecton-admin lint`). The
JWKS endpoint is infrastructure, not an action, so it is not in the manifest.

## Running the service

A workspace created by `tecton-admin new` has `apps/auth`, a configured instance of this package:

```bash
pnpm --filter ./apps/auth build
pnpm --filter ./apps/auth migrate   # applies the Auth database migrations
pnpm --filter ./apps/auth start     # startAuthServiceFromEnv(process.env)
```

| Variable | Meaning |
|---|---|
| `TECTON_AUTH_DATABASE_URL` | the Auth database (Dev Services creates an `auth` database) |
| `TECTON_AUTH_PEPPER`, `TECTON_AUTH_PEPPER_ID` | see `@tecton/providers` |
| `TECTON_AUTH_SIGNING_KEY` | Ed25519 private key, PEM PKCS#8: `openssl genpkey -algorithm ed25519`. A PEM on one line with literal `
` is accepted |
| `TECTON_AUTH_PREVIOUS_PUBLIC_KEYS` | optional: previous public keys (PEM SPKI blocks), published during a rotation |
| `TECTON_AUTH_ISSUER` | `iss` claim; default `urn:tecton:auth` |
| `TECTON_AUTH_AUDIENCE` | `aud` claim, one audience for the whole workspace; default `urn:tecton:api` |
| `TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS` | access token lifetime, 60-3600; default 900 (15 minutes) |
| `PORT`, `HOST` | default 3000 and `127.0.0.1` (loopback only; set `HOST=0.0.0.0` to expose it) |

Every setting is validated before the service listens. A missing or invalid signing key (not
Ed25519, or a public key instead of the private one) stops it with a message that never contains
the key.

## Login

`POST /auth/login` with `{ "login": "...", "password": "..." }` returns
`{ "accessToken": "...", "tokenType": "Bearer", "expiresIn": 900 }`. The access token is a JWT:

- header: `alg: EdDSA`, `kid` (RFC 7638 thumbprint of the public key), `typ: JWT`;
- claims: `iss`, `sub` (the credential id), `aud`, `iat`, `exp`, `jti` (UUID v7), `typ: user` and
  `perms` (the credential permissions).

An unknown login, a wrong password, a disabled credential and a malformed login all get the same
401 response. Argon2id runs in every case, against a dummy hash made at startup when the login
does not exist, so neither the response nor its cost tells which logins exist. When a stored hash
needs re-hashing (weaker parameters, old Pepper), the login re-hashes it; if that fails, the
login still succeeds and a warning is logged without secrets.

Logs never contain passwords, hashes, the Pepper, keys or tokens: request bodies are not logged,
and the `authorization` and `cookie` headers are redacted.

## JWKS and key rotation

`GET /auth/.well-known/jwks.json` returns the public keys only (`kty: OKP`, `crv: Ed25519`, `x`,
`kid`, `alg`, `use`), with `Cache-Control: public, max-age=300`. To rotate the signing key:

1. Generate a new key and set it as `TECTON_AUTH_SIGNING_KEY`.
2. Put the old public key (`openssl pkey -in old.pem -pubout`) in `TECTON_AUTH_PREVIOUS_PUBLIC_KEYS`.
3. After the old tokens have expired (the access token lifetime, 15 minutes by default) plus the
   JWKS cache time, remove it.

No old private key is needed: tokens signed with it are verified with its public key.
