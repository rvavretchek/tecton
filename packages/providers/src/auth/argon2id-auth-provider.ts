import { argon2, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AuthProvider, PasswordVerification } from './auth-provider.js';
import { assertValidPepper, isValidPepperId, PepperConfigError, type Pepper } from './pepper.js';

const argon2Async = promisify(argon2);

export interface Argon2idParams {
  /** Memory cost in KiB. Floor and default: 19456 (19 MiB). */
  memoryKiB: number;
  /** Iterations. Floor and default: 2. */
  passes: number;
  /** Lanes. Floor and default: 1. */
  parallelism: number;
}

export interface Argon2idAuthProviderOptions {
  /** Every Pepper still in use: the current one and, during a rotation, the previous ones. */
  peppers: readonly Pepper[];
  /** Id of the Pepper used for new hashes. */
  currentPepperId: string;
  /** Can only raise the floor (OWASP minimum for Argon2id). */
  params?: Partial<Argon2idParams>;
}

/** OWASP Password Storage minimum for Argon2id; also the default. */
export const ARGON2ID_FLOOR: Readonly<Argon2idParams> = { memoryKiB: 19456, passes: 2, parallelism: 1 };

/**
 * Longest password accepted, in UTF-16 code units. Normalization and HMAC run on the event
 * loop before Argon2id, so an unbounded input would block it. Password policy (minimum length,
 * complexity) belongs to the Auth service, not here.
 */
export const MAX_PASSWORD_LENGTH = 4096;

// Upper limits accepted by node:crypto's argon2.
const ARGON2_LIMITS: Readonly<Argon2idParams> = { memoryKiB: 2 ** 32 - 1, passes: 2 ** 32 - 1, parallelism: 2 ** 24 - 1 };
// A stored hash may cost at most this many times the configured parameters; anything above is
// refused without running Argon2id, so a tampered row cannot make a login expensive.
const CEILING_FACTOR = 4;
const SALT_BYTES = 16;
const TAG_BYTES = 32;
const SALT_RANGE = { min: 8, max: 64 } as const;
const TAG_RANGE = { min: 16, max: 64 } as const;
const MAX_STORED_LENGTH = 256;
const VERSION = 19;

const B64 = /^[A-Za-z0-9+/]+$/;
// Canonical numbers only (no leading zeros), as the PHC string format requires.
const NUMBER = '(0|[1-9][0-9]{0,9})';
const PHC = new RegExp(
  `^\\$argon2id\\$v=${NUMBER}\\$m=${NUMBER},t=${NUMBER},p=${NUMBER},keyid=([A-Za-z0-9+/]{1,11})\\$([A-Za-z0-9+/]+)\\$([A-Za-z0-9+/]+)$`,
);

/** A fresh object each time: a caller mutating one result must never affect the next. */
function invalid(): PasswordVerification {
  return { valid: false, needsRehash: false };
}

/** PHC "B64": standard base64 without padding. */
function encodeB64(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/, '');
}

/** Strict decoding: undefined unless `text` is exactly the encoding of some bytes. */
function decodeB64(text: string): Buffer | undefined {
  if (!B64.test(text)) return undefined;
  const buffer = Buffer.from(text, 'base64');
  return encodeB64(buffer) === text ? buffer : undefined;
}

const PARAM_KEYS = Object.keys(ARGON2ID_FLOOR) as Array<keyof Argon2idParams>;

function resolveParams(params: Partial<Argon2idParams> = {}): Argon2idParams {
  const resolved: Argon2idParams = { ...ARGON2ID_FLOOR };
  for (const key of PARAM_KEYS) {
    const value = params[key];
    if (value !== undefined) resolved[key] = value;
  }
  for (const key of PARAM_KEYS) {
    const value = resolved[key];
    if (!Number.isInteger(value) || value < ARGON2ID_FLOOR[key] || value > ARGON2_LIMITS[key]) {
      throw new RangeError(
        `Argon2id ${key} must be an integer between ${ARGON2ID_FLOOR[key]} and ${ARGON2_LIMITS[key]}; got ${value}`,
      );
    }
  }
  if (resolved.memoryKiB < 8 * resolved.parallelism) {
    throw new RangeError(`Argon2id memoryKiB must be at least 8 x parallelism (${8 * resolved.parallelism}); got ${resolved.memoryKiB}`);
  }
  return resolved;
}

/** Undefined when the password cannot be hashed: not a string, malformed UTF-16, or too long. */
function passwordProblem(password: unknown): string | undefined {
  if (typeof password !== 'string') return 'password must be a string';
  // Lone surrogates would all be encoded as U+FFFD, making different passwords collide.
  if (!password.isWellFormed()) return 'password is not well-formed UTF-16';
  if (password.length > MAX_PASSWORD_LENGTH) return `password is longer than ${MAX_PASSWORD_LENGTH} characters`;
  return undefined;
}

interface ParsedHash {
  params: Argon2idParams;
  pepperId: string;
  salt: Buffer;
  tag: Buffer;
}

function parseHash(stored: string): ParsedHash | undefined {
  if (stored.length > MAX_STORED_LENGTH) return undefined;
  const match = PHC.exec(stored);
  if (!match) return undefined;
  const [, version, m, t, p, keyId, salt, tag] = match;
  if (Number(version) !== VERSION) return undefined;
  const pepperId = decodeB64(keyId ?? '')?.toString('utf8');
  const saltBytes = decodeB64(salt ?? '');
  const tagBytes = decodeB64(tag ?? '');
  if (pepperId === undefined || !saltBytes || !tagBytes) return undefined;
  if (saltBytes.length < SALT_RANGE.min || saltBytes.length > SALT_RANGE.max) return undefined;
  if (tagBytes.length < TAG_RANGE.min || tagBytes.length > TAG_RANGE.max) return undefined;
  const params = { memoryKiB: Number(m), passes: Number(t), parallelism: Number(p) };
  for (const key of PARAM_KEYS) {
    if (params[key] < 1) return undefined;
  }
  return { params, pepperId, salt: saltBytes, tag: tagBytes };
}

/**
 * Reference AuthProvider: NFKC-normalized password -> HMAC-SHA256 keyed with the Pepper ->
 * Argon2id (native node:crypto) -> PHC string carrying the Pepper id as `keyid`.
 */
export function createArgon2idAuthProvider(options: Argon2idAuthProviderOptions): AuthProvider {
  if (!Array.isArray(options.peppers) || options.peppers.length === 0) {
    throw new PepperConfigError('at least one Pepper is required');
  }
  // Keys live only in this closure, never on the returned object.
  const keys = new Map<string, Buffer>();
  for (const pepper of options.peppers) {
    assertValidPepper(pepper);
    if (keys.has(pepper.id)) throw new PepperConfigError(`Pepper id "${pepper.id}" is configured more than once`);
    keys.set(pepper.id, Buffer.from(pepper.key));
  }
  const currentId = options.currentPepperId;
  // Validated before being echoed: an invalid value might be a misplaced secret.
  if (!isValidPepperId(currentId)) throw new PepperConfigError('currentPepperId is not a valid Pepper id');
  const currentKey = keys.get(currentId);
  if (!currentKey) throw new PepperConfigError(`current Pepper "${currentId}" is not among the configured Peppers`);
  const params = resolveParams(options.params);
  const ceiling: Argon2idParams = {
    memoryKiB: params.memoryKiB * CEILING_FACTOR,
    passes: params.passes * CEILING_FACTOR,
    parallelism: params.parallelism * CEILING_FACTOR,
  };

  const derive = (password: string, key: Buffer, salt: Buffer, hashParams: Argon2idParams, tagLength: number) =>
    argon2Async('argon2id', {
      message: createHmac('sha256', key).update(password.normalize('NFKC'), 'utf8').digest(),
      nonce: salt,
      memory: hashParams.memoryKiB,
      passes: hashParams.passes,
      parallelism: hashParams.parallelism,
      tagLength,
    });

  return {
    async hashPassword(password) {
      const problem = passwordProblem(password);
      if (problem) throw new RangeError(problem);
      const salt = randomBytes(SALT_BYTES);
      const tag = await derive(password, currentKey, salt, params, TAG_BYTES);
      const encodedParams = `m=${params.memoryKiB},t=${params.passes},p=${params.parallelism},keyid=${encodeB64(Buffer.from(currentId, 'utf8'))}`;
      return `$argon2id$v=${VERSION}$${encodedParams}$${encodeB64(salt)}$${encodeB64(tag)}`;
    },

    async verifyPassword(password, storedHash) {
      if (passwordProblem(password)) return invalid();
      const parsed = typeof storedHash === 'string' ? parseHash(storedHash) : undefined;
      if (!parsed) return invalid();
      const key = keys.get(parsed.pepperId);
      if (!key) return invalid();
      const stored = parsed.params;
      if (PARAM_KEYS.some((name) => stored[name] > ceiling[name])) return invalid();
      let computed: Buffer;
      try {
        computed = await derive(password, key, parsed.salt, stored, parsed.tag.length);
      } catch {
        // Fail closed (spec): an unexpected Argon2 failure never counts as a match.
        return invalid();
      }
      if (computed.length !== parsed.tag.length || !timingSafeEqual(computed, parsed.tag)) return invalid();
      const needsRehash =
        PARAM_KEYS.some((name) => stored[name] < params[name]) ||
        parsed.salt.length !== SALT_BYTES ||
        parsed.tag.length !== TAG_BYTES ||
        parsed.pepperId !== currentId;
      return { valid: true, needsRehash };
    },
  };
}
