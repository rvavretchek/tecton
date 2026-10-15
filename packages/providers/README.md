# @tecton/providers

Provider ports (AD-1: services depend on interfaces, never on concrete infrastructure) and their
reference adapters.

## AuthProvider: password hashing

```ts
import { createArgon2idAuthProvider, pepperFromEnv, type AuthProvider } from '@tecton/providers';

const auth: AuthProvider = createArgon2idAuthProvider({
  peppers: [pepperFromEnv()],
  currentPepperId: '1',
});

const stored = await auth.hashPassword(password); // PHC string, safe to store
const { valid, needsRehash } = await auth.verifyPassword(password, stored);
if (valid && needsRehash) await saveHash(await auth.hashPassword(password));
```

Code that uses the provider types against the `AuthProvider` interface only. A structural test
fails the build if anything but the Argon2id adapter calls Argon2.

### How a password is hashed

1. The password is normalized with Unicode NFKC (NIST SP 800-63B), so the same password typed on
   different keyboards or input methods verifies the same.
2. HMAC-SHA256 is applied with the **Pepper** as key. The Pepper is a secret kept outside the
   database, so a leaked database alone cannot be brute-forced.
3. Argon2id runs on the HMAC output with a random 16-byte salt and a 32-byte tag.
4. The result is a PHC string:

   ```text
   $argon2id$v=19$m=19456,t=2,p=1,keyid=MQ$<salt>$<hash>
   ```

   `keyid` is the PHC parameter for a key identifier (base64 of the Pepper id, at most 8 bytes).
   Salt and hash are base64 without padding.

`verifyPassword` recomputes with the parameters and the Pepper recorded in the stored hash and
compares in constant time. It never throws because of the stored value: a malformed or foreign
hash, an unknown Pepper, or parameters above a safety ceiling (1 GiB of memory, 16 passes,
16 lanes, or the configured values if higher) are simply not valid. That ceiling stops a tampered
row from making a login allocate unbounded memory.

### Parameters

| Parameter | Default and floor | Meaning |
|---|---|---|
| `memoryKiB` | 19456 (19 MiB) | Argon2id memory cost |
| `passes` | 2 | iterations |
| `parallelism` | 1 | lanes |

The defaults are the OWASP minimum for Argon2id. Configuration can raise them, never lower them,
and lowering throws `RangeError`. When the stored hash uses lower values than the configuration,
`verifyPassword` returns `needsRehash: true` after a successful check.

### Pepper

| Variable | Meaning |
|---|---|
| `TECTON_AUTH_PEPPER` | the secret, at least 32 bytes (UTF-8). Generate one with `openssl rand -base64 48`. |
| `TECTON_AUTH_PEPPER_ID` | its version id, 1-8 characters of `[A-Za-z0-9_-]`; default `1` |

A missing or short Pepper fails at startup with `PepperConfigError`, before any hash is produced.
The message never contains the value. `pepperFromEnv` is a minimal reader; the `ConfigProvider`
(Story 3.1) will replace it.

**Rotation:** configure the new Pepper and keep the old ones in `peppers`, and point
`currentPepperId` at the new one. Old hashes keep verifying, with `needsRehash: true`, so they move
to the new Pepper on each user's next login. Remove an old Pepper only when no stored hash uses it.

### Why native `crypto.argon2`

The adapter uses Node's built-in `crypto.argon2`, available since Node 24.7.0, the minimum version
of this project. In the Node 24.20.0 documentation it carries no experimental marker (it inherits
the stability of the `crypto` module), and calling it emits no `ExperimentalWarning`. Using it
avoids a native addon such as `@node-rs/argon2`, which would need a build-script exception in the
package manager.

The hash is always computed asynchronously (`crypto.argon2`, never `argon2Sync`), so a login does
not block the event loop. The Pepper goes through HMAC rather than Argon2's own `secret` input:
that keeps the Pepper layer independent of the hashing algorithm.
