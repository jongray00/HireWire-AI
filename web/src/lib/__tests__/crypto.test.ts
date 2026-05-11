import { describe, expect, it, beforeEach } from 'vitest';
import { encrypt, decrypt, CryptoError } from '../crypto';

const KEY_B64 = 'dGVzdC1rZXktMzItYnl0ZXMtZm9yLWFlcy1nY20hISE='; // 32 bytes base64

beforeEach(() => {
  process.env.HIREWIRE_ENCRYPTION_KEY = KEY_B64;
});

describe('crypto', () => {
  it('round-trips plaintext', () => {
    const enc = encrypt('PT_signalwire_api_token_value');
    expect(Buffer.isBuffer(enc) || enc instanceof Uint8Array).toBe(true);
    const out = decrypt(enc);
    expect(out).toBe('PT_signalwire_api_token_value');
  });

  it('rejects tampered ciphertext', () => {
    const enc = encrypt('hello');
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decrypt(tampered)).toThrow(CryptoError);
  });

  it('emits v1 wire format (version byte 0x01 prefix)', () => {
    const enc = encrypt('x');
    expect(enc[0]).toBe(0x01);
  });

  it('produces distinct ciphertext per call (random nonce)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });
});
