/**
 * AES-GCM-256 with a 1-byte version prefix.
 *
 * Wire format (matches agent/lib/crypto.py):
 *   [ 0x01 ][ 12-byte nonce ][ ciphertext ][ 16-byte GCM tag ]
 *
 * Key is base64-encoded 32 bytes in HIREWIRE_ENCRYPTION_KEY.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const VERSION = 0x01;
const NONCE_LEN = 12;
const TAG_LEN = 16;

export class CryptoError extends Error {}

function getKey(): Buffer {
  const b64 = process.env.HIREWIRE_ENCRYPTION_KEY;
  if (!b64) throw new CryptoError('HIREWIRE_ENCRYPTION_KEY not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new CryptoError(`HIREWIRE_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

export function encrypt(plaintext: string): Buffer {
  const key = getKey();
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), nonce, ct, tag]);
}

export function decrypt(payload: Uint8Array | Buffer): string {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buf.length < 1 + NONCE_LEN + TAG_LEN) {
    throw new CryptoError('ciphertext too short');
  }
  if (buf[0] !== VERSION) {
    throw new CryptoError(`unsupported wire version: 0x${buf[0].toString(16)}`);
  }
  const nonce = buf.subarray(1, 1 + NONCE_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(1 + NONCE_LEN, buf.length - TAG_LEN);
  const key = getKey();
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
  } catch (err) {
    throw new CryptoError(`decryption failed: ${(err as Error).message}`);
  }
}
