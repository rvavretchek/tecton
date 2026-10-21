# @tecton/auth

The ready-made Auth service of Tecton. It stores credentials in its own database and issues EdDSA
(Ed25519) access tokens that every service verifies on its own through the public keys it
publishes (AD-7). No service but Auth can sign a token. Sessions continue through an opaque refresh
token that only the Auth service ever receives.

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

Both scripts read the workspace `.env` (settings every service shares) and then `apps/auth/.env`
(the Auth database, `PORT=3001` and the secrets), each copied from its `.env.example`. Keep the
Pepper and the signing key in `apps/auth/.env` only: the domains read the workspace `.env` and
their own, never this one, so no domain can sign a token.

| Variable | Meaning |
|---|---|
| `TECTON_AUTH_DATABASE_URL` | the Auth database (Dev Services creates an `auth` database) |
| `TECTON_AUTH_PEPPER`, `TECTON_AUTH_PEPPER_ID` | see `@tecton/providers` |
| `TECTON_AUTH_SIGNING_KEY` | Ed25519 private key, PEM PKCS#8: `openssl genpkey -algorithm ed25519`. A PEM written on one line with literal `\n` is accepted |
| `TECTON_AUTH_PREVIOUS_PUBLIC_KEYS` | optional: public keys of previous signing keys (PEM SPKI blocks), still verifying older tokens |
| `TECTON_AUTH_NEXT_PUBLIC_KEYS` | optional: public key of the next signing key, published before it signs (rotation step 1) |
| `TECTON_AUTH_PREVIOUS_PEPPERS` | optional: Peppers kept after a Pepper rotation, as JSON `{"<id>": "<value>"}`; their hashes keep verifying and are re-hashed at the next login |
| `TECTON_AUTH_ISSUER` | `iss` claim; default `urn:tecton:auth` |
| `TECTON_AUTH_AUDIENCE` | `aud` claim, one audience for the whole workspace; default `urn:tecton:api` |
| `TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS` | access token lifetime, 60-3600; default 900 (15 minutes) |
| `TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS` | fixed lifetime of a session (refresh token family), 3600-7776000; default 604800 (7 days) |
| `TECTON_VALKEY_URL` | Valkey of the token revocations, shared with every service; required |
| `TECTON_REVOCATION_TIMEOUT_MS` | time limit of a revocation call, 50-5000; default 500 |
| `PORT`, `HOST` | default 3000 and `127.0.0.1` (loopback only; set `HOST=0.0.0.0` to expose it) |

Every setting is validated before the service listens. A missing or invalid signing key (not
Ed25519, or a public key instead of the private one) stops it with a message that never contains
the key.

## Login

`POST /auth/login` with `{ "login": "...", "password": "..." }` returns
`{ "accessToken": "...", "tokenType": "Bearer", "expiresIn": 900 }` and sets the refresh cookie
(see below). The access token is a JWT:

- header: `alg: EdDSA`, `kid` (RFC 7638 thumbprint of the public key), `typ: at+jwt` (RFC 9068);
- claims: `iss`, `sub` (the credential id), `aud`, `iat`, `exp`, `jti` (UUID v7), `typ: user` and
  `perms` (the credential permissions).

An unknown login, a wrong password, a disabled credential and a malformed login all get the same
401 response. Argon2id runs in every case, against a dummy hash made at startup when the login
does not exist, so neither the response nor its cost tells which logins exist. When a stored hash
needs re-hashing (weaker parameters, old Pepper), the login re-hashes it; if that fails, the
login still succeeds and a warning is logged without secrets.

Logs never contain passwords, hashes, the Pepper, keys or tokens: request bodies are not logged,
and the `authorization`, `cookie` and `set-cookie` headers are redacted.

## Refresh and logout

The login also opens a session: a family of opaque refresh tokens. The token is 256 random bits
and travels only in a cookie, never in a response body:

```
Set-Cookie: tecton_refresh=<43 base64url characters>; Max-Age=<seconds left>; Path=/auth; HttpOnly; Secure; SameSite=Strict
```

- `Path=/auth` sends it to the Auth routes only, so no domain service ever receives it (FR-12).
  The Gateway (Story 3.6) routes `/auth/*` to this service without touching the cookie.
- The database stores only the SHA-256 of each token, with its family.
- The family expires a fixed time after the login (7 days by default). Refreshing never extends
  it: after that, the user logs in again.

`POST /auth/refresh` (no body, or `{}`; a body with fields is a 400) returns a new access token and a new
cookie, and marks the presented token as used. Presenting a used token again revokes the whole
family, the newest token included, and logs a security event
(`event: "auth.refresh_token.reuse"`, with the family id and the subject, never the token). Every
refusal (unknown, malformed, expired, revoked or reused token, inactive credential) is the same
401, and it clears the cookie.

`POST /auth/logout` (no body, or `{}`) revokes the family of the cookie and clears it. It answers
200 `{}` with or without a valid cookie, so it works even after the access token expired. With
several `tecton_refresh` cookies (one planted next to the real one), it revokes the family of each.
If the database fails, the answer is 500 but the cookie is cleared anyway.

A refresh whose credential lookup or token signing fails answers 500 and does not use up the
cookie: retrying with it works.
Login, refresh and logout responses carry `Cache-Control: no-store`.

Two refreshes with the same cookie at the same time count as a reuse: one succeeds, the other
revokes the family, and the user is logged out. A client must send a single refresh at a time and
make other requests wait for it (single flight; the Directory admin SPA does this, Story 4.7).

`SameSite=Strict` keeps other sites from triggering refresh or logout with the cookie. `Secure`
requires `https`; Chrome and Firefox also accept it on `http://localhost`, but not every browser
does.

## Token revocation

The Auth service writes revocations to the Valkey every service checks (`TokenRevocationStore`,
Story 2.5):

- `POST /auth/logout` with `Authorization: Bearer <access token>` revokes that token until it
  expires, besides the refresh family. The token is verified locally with this service's own keys;
  without a valid one, only the family is revoked. If Valkey fails, the answer is 503, with the
  cookie already cleared and the family already revoked: log out again.
- A refresh token reuse revokes every access token of the subject issued until then. If Valkey
  fails, the refresh is still a 401 and the failure is logged
  (`event: "auth.refresh_token.reuse.revocation_failed"`).

## JWKS and key rotation

`GET /auth/.well-known/jwks.json` returns the public keys only (`kty: OKP`, `crv: Ed25519`, `x`,
`kid`, `alg`, `use`), with `Cache-Control: public, max-age=300`. Verifiers may keep it for 5 minutes,
so a new key must be published before it signs. To rotate the signing key:

1. **Publish the next key.** Generate it and put its public key
   (`openssl pkey -in next.pem -pubout`) in `TECTON_AUTH_NEXT_PUBLIC_KEYS`. Deploy, and wait at least
   the JWKS cache time (5 minutes) so every verifier knows it.
2. **Sign with it.** Set it as `TECTON_AUTH_SIGNING_KEY`, move the old public key to
   `TECTON_AUTH_PREVIOUS_PUBLIC_KEYS` and clear `TECTON_AUTH_NEXT_PUBLIC_KEYS`. Deploy.
3. **Retire the old key.** Once the old tokens have expired (the access token lifetime, 15
   minutes by default) plus the JWKS cache time, remove it from `TECTON_AUTH_PREVIOUS_PUBLIC_KEYS`.

No old private key is needed: tokens signed with it are verified with its public key.

## Pepper rotation

Set the new Pepper as `TECTON_AUTH_PEPPER` with a new `TECTON_AUTH_PEPPER_ID`, and keep the old one in
`TECTON_AUTH_PREVIOUS_PEPPERS` (`{"<old id>": "<old value>"}`). Passwords hashed with the old Pepper
keep working and are re-hashed with the new one at each user's next login. Remove the old Pepper only
when no stored hash uses it any more.

## Capacity

Every login runs one Argon2id hash (about 19 MiB and tens of milliseconds), including failed and
unknown logins, so the response never reveals which accounts exist. Argon2id runs on the libuv
threadpool (4 threads by default): size it for the expected concurrent logins with
`UV_THREADPOOL_SIZE`, and put rate limiting in front of the endpoint. The Gateway rate limit
(Story 3.7) and the lockout per identifier (Story 2.6) cover that in Tecton.
