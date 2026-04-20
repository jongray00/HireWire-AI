// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken, buildSessionCookie, buildClearSessionCookie, getSessionFromRequest } from '../session';

describe('JWT session', () => {
  it('creates and verifies a token', async () => {
    const token = await createSessionToken({ projectId: 'proj-1', spaceUrl: 'test.signalwire.com' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const payload = await verifySessionToken(token);
    expect(payload).toEqual({ projectId: 'proj-1', spaceUrl: 'test.signalwire.com' });
  });

  it('returns null for invalid token', async () => {
    const payload = await verifySessionToken('invalid.token.here');
    expect(payload).toBeNull();
  });

  it('returns null for empty token', async () => {
    const payload = await verifySessionToken('');
    expect(payload).toBeNull();
  });

  it('builds a session cookie with correct attributes', () => {
    const cookie = buildSessionCookie('test-token');
    expect(cookie).toContain('sally_session=test-token');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=');
  });

  it('builds a clear cookie with Max-Age=0', () => {
    const cookie = buildClearSessionCookie();
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('sally_session=');
  });

  it('extracts session from request cookie', async () => {
    const token = await createSessionToken({ projectId: 'proj-2', spaceUrl: 'demo.signalwire.com' });
    const request = new Request('http://localhost', {
      headers: { Cookie: `sally_session=${token}` },
    });
    const session = await getSessionFromRequest(request);
    expect(session).toEqual({ projectId: 'proj-2', spaceUrl: 'demo.signalwire.com' });
  });

  it('returns null when no cookie present', async () => {
    const request = new Request('http://localhost');
    const session = await getSessionFromRequest(request);
    expect(session).toBeNull();
  });
});
