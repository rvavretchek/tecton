import { argon2, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AuthProvider, PasswordVerification } from './auth-provider.js';
import { assertValidPepper, PepperConfigError, type Pepper } from './pepper.js';

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

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const VERSION = 19;
// Stored hashes above these limits are refused without running Argon2id, so a tampered row
// cannot make a login allocate unbounded memory or CPU.
const CEILING: Readonly<Argon2idParams> = { memoryKiB: 1_048_576, passes: 16, parallelism: 16 };

const INVALID: PasswordVerification = { valid: false, needsRehash: false };
const B64 = /^[A-Za-z0-9+/]+$/;
const PHC = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+),keyid=([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

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

function resolveParams(params: Partial<Argon2idParams> = {}): Argon2idParams {
  const resolved = { ...ARGON2ID_FLOOR, ...params };
  for (const key of Object.keys(ARGON2ID_FLOOR) as Array<keyof Argon2idParams>) {
    const value = resolved[key];
    if (!Number.isInteger(value) || value < ARGON2ID_FLOOR[key]) {
      throw new RangeError(`Argon2id ${key} must be an integer of at least ${ARGON2ID_FLOOR[key]}; got ${value}`);
    }
  }
  return resolved;
}

interface ParsedHash {
  params: Argon2idParams;
  pepperId: string;
  salt: Buffer;
  tag: Buffer;
}

function parseHash(stored: string): ParsedHash | undefined {
  const match = PHC.exec(stored);
  if (!match) return undefined;
  const [, version, m, t, p, keyId, salt, tag] = match;
  if (Number(version) !== VERSION) return undefined;
  const pepperId = decodeB64(keyId ?? '')?.toString('utf8');
  const saltBytes = decodeB64(salt ?? '');
  const tagBytes = decodeB64(tag ?? '');
  const params = { memoryKiB: Number(m), passes: Number(t), parallelism: Number(p) };
  if (pepperId === undefined || !saltBytes || !tagBytes) return undefined;
  if (saltBytes.length < 8 || tagBytes.length < 4) return undefined;
  for (const key of Object.keys(params) as Array<keyof Argon2idParams>) {
    if (!Number.isSafeInteger(params[key]) || params[key] < 1) return undefined;
  }
  return { params, pepperId, salt: saltBytes, tag: tagBytes };
}

/**
 * Reference AuthProvider: NFKC-normalized password -> HMAC-SHA256 keyed with the Pepper ->
 * Argon2id (native node:crypto) -> PHC string carrying the Pepper id as `keyid`.
 */
export function createArgon2idAuthProvider(options: Argon2idAuthProviderOptions): AuthProvider {
  if (options.peppers.length === 0) throw new PepperConfigError('at least one Pepper is required');
  // Keys live only in this closure, never on the returned object.
  const keys = new Map<string, Buffer>();
  for (const pepper of options.peppers) {
    assertValidPepper(pepper);
    if (keys.has(pepper.id)) throw new PepperConfigError(`Pepper id "${pepper.id}" is configured more than once`);
    keys.set(pepper.id, Buffer.from(pepper.key));
  }
  const currentId = options.currentPepperId;
  const currentKey = keys.get(currentId);
  if (!currentKey) throw new PepperConfigError(`current Pepper "${currentId}" is not among the configured Peppers`);
  const params = resolveParams(options.params);
  const ceiling: Argon2idParams = {
    memoryKiB: Math.max(params.memoryKiB, CEILING.memoryKiB),
    passes: Math.max(params.passes, CEILING.passes),
    parallelism: Math.max(params.parallelism, CEILING.parallelism),
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
      const salt = randomBytes(SALT_BYTES);
      const tag = await derive(password, currentKey, salt, params, TAG_BYTES);
      const encodedParams = `m=${params.memoryKiB},t=${params.passes},p=${params.parallelism},keyid=${encodeB64(Buffer.from(currentId, 'utf8'))}`;
      return `$argon2id$v=${VERSION}$${encodedParams}$${encodeB64(salt)}$${encodeB64(tag)}`;
    },

    async verifyPassword(password, storedHash) {
      const parsed = typeof storedHash === 'string' ? parseHash(storedHash) : undefined;
      if (!parsed) return INVALID;
      const key = keys.get(parsed.pepperId);
      if (!key) return INVALID;
      const stored = parsed.params;
      if (stored.memoryKiB > ceiling.memoryKiB || stored.passes > ceiling.passes || stored.parallelism > ceiling.parallelism) {
        return INVALID;
      }
      let computed: Buffer;
      try {
        computed = await derive(password, key, parsed.salt, stored, parsed.tag.length);
      } catch {
        return INVALID;
      }
      if (computed.length !== parsed.tag.length || !timingSafeEqual(computed, parsed.tag)) return INVALID;
      const needsRehash =
        stored.memoryKiB < params.memoryKiB ||
        stored.passes < params.passes ||
        stored.parallelism < params.parallelism ||
        parsed.tag.length < TAG_BYTES ||
        parsed.pepperId !== currentId;
      return { valid: true, needsRehash };
    },
  };
}
