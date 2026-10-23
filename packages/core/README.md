# @tecton/core

The service runtime of Tecton: a Fastify server whose routes come from the domain manifest
(`POST /<domain>/<action-in-kebab-case>`), the single error serializer, the OpenAPI document,
and the local token verification of every service.

## Token verification (Zero Trust, AD-7)

Every action that is not `auth.public: true` verifies its Bearer token itself, before the request
body is read. No service trusts the Gateway, another service or a header such as `x-user-id`:
identity comes only from the token the service verified.

- The token must be an EdDSA (Ed25519) JWT with header `typ: at+jwt` and a `kid`, and claims
  `iss`, `aud`, `sub`, `jti`, `iat`, `exp`, `typ: user` and `perms`. Any other `alg` (`none`,
  `HS256`, `RS256`...) is refused.
- Every permission listed in `auth.requires` is required.
- The handler gets the verified caller as `context.principal` (`subject`, `permissions`,
  `tokenId`, `issuedAt`, `expiresAt`).

| Situation | Response |
|---|---|
| no `Authorization: Bearer`, or a bad, forged or expired token | 401 with `WWW-Authenticate: Bearer` |
| valid token without every permission of `auth.requires` | 403 |
| the keys cannot be fetched (Auth unreachable, invalid JWKS, timeout) | 503 with `Retry-After: 5` |

The 503 is fail closed: a request is never accepted unverified. It is distinct from 401 so that a
client retries instead of refreshing its session or logging the user out.

### Configuration

`startDomainServer` builds the verifier from the environment when it is not given one, and stops
at startup when a setting is missing or invalid:

| Variable | Meaning |
|---|---|
| `TECTON_JWKS_URL` | JWKS of the Auth service, e.g. `https://auth.internal/auth/.well-known/jwks.json`. Must be `https`, except in development |
| `TECTON_ENV` | only `development` allows an `http` JWKS URL; anything else, or no value, means production rules |
| `TECTON_AUTH_ISSUER`, `TECTON_AUTH_AUDIENCE` | expected `iss` and `aud`; defaults `urn:tecton:auth` and `urn:tecton:api`, the same as the Auth service |
| `TECTON_JWKS_CA_FILE` | optional PEM file of the CA that signs the JWKS certificate, trusted for that request only |
| `TECTON_VALKEY_URL` | Valkey of the token revocations (`redis://` or `rediss://`); required |
| `TECTON_VALKEY_TIMEOUT_MS` | time limit of a revocation check, 50-5000; default 500 (`TECTON_REVOCATION_TIMEOUT_MS`, its former name, is still read) |

In a generated workspace these come from the workspace `.env` (shared, no secrets), and the
domain's own database from `apps/domains/<domain>/.env`.

### Revocation (Story 2.5)

After the signature and the claims, every token is checked against the `TokenRevocationStore` of
`@tecton/providers` (Valkey): by its `jti` (logout) and by its subject (every token issued until a
given instant, e.g. after a refresh token reuse). A revoked token is a 401. When Valkey is
unreachable or slower than the time limit, the request is a 503: a token is never accepted
without checking revocation (FR-14, fail closed).

A subject revocation covers every token with `iat` (whole seconds) at or before its instant: a
token issued in the same second, even just after, is refused too (conservative). Revocations
outlive the tokens they cover by 60 seconds: the 30 s the verifier accepts past `exp`, plus 30 s
for a service whose clock runs behind the Auth service's.

### JWKS fetching

- A redirect is never followed: any 3xx is refused, so no one on the internal network can hand
  out a fake key.
- Keys are cached for 5 minutes, the same as the `Cache-Control` of the Auth JWKS. A key removed
  from the JWKS can stay trusted for that long; immediate revocation is the `TokenRevocationStore`
  (Story 2.5).
- A token with an unknown `kid` fetches the JWKS again only if the last attempt, successful or
  not, is older than 30 seconds: a burst of unknown tokens costs at most one fetch. A key published
  during a rotation (Auth, three-step rotation) is found that way.
- After a failed fetch, no new fetch starts for 5 seconds (the `Retry-After`): requests fail fast
  with 503 instead of each waiting on a struggling Auth service.
- Each fetch has a 5-second limit and reads at most 64 KiB of JSON. A duplicated `kid` or an
  invalid JWKS is unavailability (503), never a bad token: a broken JWKS must not log users out.
- When the cache expires and the Auth service stays unreachable, the old keys are not used:
  every protected action answers 503 until a fetch succeeds. The reason (refused redirect, TLS
  error, timeout...) is logged as a warning, without the URL or the token.
- A clock skew of up to 30 seconds is accepted on `exp` and `iat`; a token issued further in the
  future is refused.

The registration of routes refuses a manifest with protected actions but no verifier, and a
protected action that requires no permission: a protected route never runs unverified.
