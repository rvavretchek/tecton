# @tecton/auth

The ready-made Auth service of Tecton. It stores credentials in its own database and (from
Story 2.2b) issues EdDSA access tokens that every service verifies on its own (AD-7).

This first part provides credentials, persistence and the first administrator. Login, tokens and
the JWKS endpoint come next.

## Credentials

A credential is all the Auth service keeps about a subject, and nothing else:

| Field | Meaning |
|---|---|
| `id` | subject id, UUID v7 (AD-5) |
| `login` | normalized login identifier, unique |
| `passwordHash` | PHC string from the `AuthProvider` of `@tecton/providers` (Argon2id + Pepper), never the password |
| `status` | `active` or `disabled` |
| `permissions` | list in the manifest format, e.g. `tenant:create` |
| `createdAt`, `updatedAt` | from the `Clock` port |

Logins are normalized with `normalizeLogin`: Unicode NFKC, surrounding whitespace removed, lower
case. Accents are kept, so `josé` and `jose` are different logins on every database.

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

It runs `prisma migrate deploy` for the right dialect. Error messages never contain the URL, which
holds the database password. `tecton-admin migrate` (Story 6.1) will run it for every service.

## First administrator

```bash
export TECTON_AUTH_DATABASE_URL=postgresql://...   # direct access to the Auth database
export TECTON_AUTH_PEPPER=...                      # the same Pepper the service uses
printf '%s' "$PASSWORD" | tecton-admin auth bootstrap --login admin
```

- It works only while the Auth database has no credentials. Afterwards it refuses and changes
  nothing.
- The password comes from `TECTON_AUTH_BOOTSTRAP_PASSWORD` or standard input. There is no
  command-line option for it, so it never shows up in shell history or process lists. From an
  interactive terminal without the variable, the command asks you to pipe the password.
- It writes directly to the database. There is no HTTP endpoint for bootstrapping (AD-7).
- The administrator gets `BOOTSTRAP_ADMIN_PERMISSIONS`:
  - `auth:service:register`, to register services (Story 2.7);
  - `auth:credential:create`, to create credentials (Story 4.3).

## Manifest

The package ships its own `tecton.yaml` (actions `login`, `refresh`, `logout`, `serviceToken`),
declared in `package.json` under `"tecton": { "manifests": ["./tecton.yaml"] }`. A domain that
lists `auth` in `dependencies` resolves through the installed package (`tecton-admin lint`). The
JWKS endpoint is infrastructure, not an action, so it is not in the manifest.
