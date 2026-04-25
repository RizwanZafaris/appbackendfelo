import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Tiny app-level cipher used to protect TOTP seeds and recovery codes
 * at rest in Postgres.
 *
 * Algorithm: AES-256-GCM with a per-record random 12-byte IV and 16-byte
 * authentication tag. Output format on disk:
 *
 *     base64(  IV(12) || TAG(16) || CIPHERTEXT(N)  )
 *
 * The encryption key is derived from `FELO_DATA_ENCRYPTION_KEY` (32+
 * bytes random, set via env / secret manager) using scrypt to a 32-byte
 * AES key. Rotating the env var rotates the key for *new* writes; old
 * rows can still be decrypted as long as the previous value is supplied.
 *
 * NEVER commit the env value to git. Store in Supabase Vault / Doppler.
 */

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_SALT = 'felo-data-encryption-key.v1';

function deriveKey(passphrase: string): Buffer {
  return scryptSync(passphrase, SCRYPT_SALT, KEY_BYTES);
}

function getKey(): Buffer {
  const passphrase = process.env.FELO_DATA_ENCRYPTION_KEY;
  if (!passphrase || passphrase.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FELO_DATA_ENCRYPTION_KEY missing or too short (need 32+ chars)');
    }
    // Dev fallback so local dev doesn't need the secret. Throws in prod.
    return deriveKey('felo-dev-key-NOT-FOR-PRODUCTION-USE');
  }
  return deriveKey(passphrase);
}

export function encryptString(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptString(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Ciphertext too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Hash a recovery code with PBKDF2-SHA256 (OWASP-recommended params).
 * Output: `pbkdf2$<iterations>$<saltHex>$<hashHex>` — self-describing
 * so we can bump iterations later without migration.
 */
const PBKDF2_ITER = 600_000;
const PBKDF2_KEYLEN = 32;

export function hashRecoveryCode(code: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(code, salt, PBKDF2_ITER, PBKDF2_KEYLEN, 'sha256');
  return `pbkdf2$${PBKDF2_ITER}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyRecoveryCode(code: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = parseInt(parts[1], 10);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  const got = pbkdf2Sync(code, salt, iter, expected.length, 'sha256');
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}
