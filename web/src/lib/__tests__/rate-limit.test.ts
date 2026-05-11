// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, clientIp, _resetRateLimitForTests } from '../rate-limit';

beforeEach(() => _resetRateLimitForTests());

describe('checkRateLimit', () => {
  it('allows up to max in window', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit({ key: 'a', windowMs: 60_000, max: 5 }).allowed).toBe(true);
    }
    expect(checkRateLimit({ key: 'a', windowMs: 60_000, max: 5 }).allowed).toBe(false);
  });

  it('isolates by key', () => {
    for (let i = 0; i < 5; i++) checkRateLimit({ key: 'a', windowMs: 60_000, max: 5 });
    expect(checkRateLimit({ key: 'b', windowMs: 60_000, max: 5 }).allowed).toBe(true);
  });
});

describe('clientIp', () => {
  it('reads x-forwarded-for first value', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    });
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    const req = new Request('http://localhost/', { headers: { 'x-real-ip': '5.6.7.8' } });
    expect(clientIp(req)).toBe('5.6.7.8');
  });

  it('returns unknown for no headers', () => {
    const req = new Request('http://localhost/');
    expect(clientIp(req)).toBe('unknown');
  });
});
