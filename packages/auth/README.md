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
  - `auth:service:register`, to register services (see Service credentials);
  - `auth:credential:create`, to create credentials (Story 4.3).

## Manifest

The package ships its own `tecton.yaml` (actions `login`, `refresh`, `logout`, `serviceToken`,
`registerService`),
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
| `TECTON_AUTH_SERVICE_TOKEN_TTL_SECONDS` | service token lifetime, 60-900; default 300 (5 minutes) |
| `TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS` | fixed lifetime of a session (refresh token family), 3600-7776000; default 604800 (7 days) |
| `TECTON_VALKEY_URL` | Valkey of the token revocations, shared with every service; required |
| `TECTON_VALKEY_TIMEOUT_MS` | time limit of every Valkey call (revocation and lockout), 50-5000; default 500 (`TECTON_REVOCATION_TIMEOUT_MS`, its former name, is still read) |
| `TECTON_AUTH_LOCKOUT_MAX_FAILURES` | failed logins of one identifier that lock it, 1-100; default 5 |
| `TECTON_AUTH_LOCKOUT_WINDOW_SECONDS` | window those failures are counted in, 60-86400; default 900 (15 minutes) |
| `TECTON_AUTH_LOCKOUT_DURATION_SECONDS` | how long a lock lasts, 60-86400; default 900 (15 minutes) |
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

## Login lockout

After 5 failed logins of one identifier within 15 minutes (configurable), from any origin, that
identifier is locked for 15 minutes (Story 2.6). The window is fixed: it starts at the first
failure and is not renewed by the next ones, so right at its turn up to 2 x (N - 1) failures can
fit in a short span without a lock; the Gateway rate limit (Story 3.7) bounds that. The count lives in Valkey, shared by every
instance of the Auth service; keys hold the SHA-256 of the normalized login, never the login.

- Every refused login of a valid identifier counts: wrong password, disabled credential, unknown
  login. An unknown login is counted and locked exactly like an existing one, so the lock never
  tells which logins exist. A malformed login is not counted.
- The attempt that reaches the limit still gets the usual 401. While locked, every login of that
  identifier, even with the right password, gets **429** with `Retry-After` (seconds left), and
  the password is not checked.
- A successful login clears the count, but never a lock set meanwhile by concurrent failures:
  only its expiry or `tecton-admin auth unlock` lifts a lock.
- While locked, failures are not counted and never extend the lock.
- A lock is logged as a security event (`event: "auth.login.locked"`, with the identifier and the
  duration, never a password).
- If Valkey is unreachable or slow, logins are refused with 503 (fail closed), never let through
  unchecked.

**Accepted risk:** because the count is per identifier, someone can lock another person's account
on purpose by failing its password. That is the known cost of locking by account. The remedy is:

```bash
TECTON_VALKEY_URL=redis://... tecton-admin auth unlock alice@example.com
```

It removes the lock and the count of that identifier (normalized like a login), directly in
Valkey; there is no HTTP endpoint for it. It says whether there was anything to remove.

**Valkey memory:** the lockout keeps one short-lived key per identifier that fails a login, unknown
ones included, in the same Valkey as the token revocations. Configure Valkey with
`maxmemory-policy noeviction`: under memory pressure, writes then fail and logins answer 503 (fail
closed), instead of evicting revocations. Concurrent attempts already past the check when the lock
is set still finish; the Gateway rate limit (Story 3.7) bounds that volume.

## Service credentials

A domain service authenticates to other services with a service token (client credentials, FR-13).
Only the Auth service holds service credentials: one per domain, with the Argon2id hash of its
secret (the same `AuthProvider` and Pepper as passwords), the permissions an administrator granted
and the domains it may call.

Register a service from the workspace, as an administrator with `auth:service:register`:

```bash
export TECTON_AUTH_URL=http://127.0.0.1:3001   # https outside TECTON_ENV=development
printf '%s' "$ADMIN_PASSWORD" | tecton-admin auth register-service billing --login admin --permission invoice:write
```

- The command logs in, calls `POST /auth/register-service` with the access token, and logs out at
  the end, also on failure: the token is revoked and never written to disk. The password comes
  from `TECTON_AUTH_ADMIN_PASSWORD` or standard input, never from an argument.
- The domains the service calls come from `dependencies` in `apps/domains/<domain>/tecton.yaml`.
  The service token carries `call:<domain>` for each of them, and only for them; the callee
  checks it (Story 2.7b). `--permission call:...` is refused: `call:` comes from the
  `dependencies` the registration sends. The CLI reads them from the manifest; the endpoint
  itself trusts the administrator who calls it (`auth:service:register`), so grant that
  permission as you would grant any other.
- `--permission` (repeatable) grants other permissions. Without it, the service has only its
  `call:` permissions.
- The secret is printed once. The Auth service cannot show it again.
- A domain registered already answers 409, and the command exits 2 with nothing changed.
  `--rotate` replaces the credential: a new secret, and the old one stops working at once. Every
  token issued to `service:<domain>` until then is revoked. Changing the permissions or the
  dependencies of a service also needs `--rotate`. The revocation is written before the new
  secret: if Valkey is down, the rotation answers 503 and nothing changes.
- If the command gets no answer to the registration (a timeout), the registration may have been
  applied and its secret lost: run it again, with `--rotate` if it says the service is already
  registered.

The service exchanges its credential for a token:

```http
POST /auth/service-token
{ "serviceId": "billing", "secret": "<secret>" }
```

The answer is an access token (`typ: service`, `sub: service:billing`, `perms`, same key, issuer
and audience as user tokens), valid for `TECTON_AUTH_SERVICE_TOKEN_TTL_SECONDS` (5 minutes by
default). There is no refresh: the service asks for a new token. An unknown service, a wrong
secret and a revoked credential get the same 401, after the same Argon2id work. A service token is
never a user session: `refresh` and `login` refuse it, and `logout` revokes nothing for it.

**Accepted risk.** A service that receives a user token to act on the user's behalf can reuse it
until it expires (15 minutes) if the service is compromised. This comes with token propagation;
the `call:<domain>` check of the callee limits where the token can be used.

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
keep working and are re-hashed with the new one at each user's next login. Service secrets are
re-hashed the same way, at the service's next `service-token` call. Remove the old Pepper only
when no stored hash uses it any more.

## Capacity

Every login runs one Argon2id hash (about 19 MiB and tens of milliseconds), including failed and
unknown logins, so the response never reveals which accounts exist. Argon2id runs on the libuv
threadpool (4 threads by default): size it for the expected concurrent logins with
`UV_THREADPOOL_SIZE`, and put rate limiting in front of the endpoint. The Gateway rate limit
(Story 3.7) and the lockout per identifier (Story 2.6) cover that in Tecton.
