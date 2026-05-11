// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import { issueSession, verifySession, SESSION_COOKIE_NAME, SessionError } from '../jwt';

beforeEach(() => {
  process.env.HIREWIRE_JWT_SECRET = 'test-secret-at-least-32-chars-long-xx';
});

describe('jwt session helper', () => {
  it('round-trips a valid JWT', async () => {
    const jwt = await issueSession({ projectId: 'uuid-1' });
    const claims = await verifySession(jwt);
    expect(claims.projectId).toBe('uuid-1');
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a tampered JWT', async () => {
    const jwt = await issueSession({ projectId: 'uuid-1' });
    const tampered = jwt.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    await expect(verifySession(tampered)).rejects.toThrow(SessionError);
  });

  it('rejects an expired JWT', async () => {
    const jwt = await issueSession({ projectId: 'uuid-1' }, { ttlSeconds: -1 });
    await expect(verifySession(jwt)).rejects.toThrow(SessionError);
  });

  it('rejects a JWT missing the projectId claim', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.HIREWIRE_JWT_SECRET);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(secret);
    await expect(verifySession(jwt)).rejects.toThrow(SessionError);
  });

  it('exposes the cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('hirewire_session');
  });
});
