// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';

import { GET as getSession, DELETE as deleteSession } from '../session/route';
import { issueSession, SESSION_COOKIE_NAME } from '@/lib/jwt';

beforeEach(() => {
  process.env.HIREWIRE_JWT_SECRET = 'test-secret-at-least-32-chars-long-xx';
});

function makeReq(cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers['Cookie'] = cookie;
  return new Request('http://localhost/api/auth/session', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/auth/session', () => {
  it('returns authenticated=true with projectId when a valid hirewire_session cookie is present', async () => {
    const jwt = await issueSession({ projectId: 'uuid-test' });
    const resp = await getSession(makeReq(`${SESSION_COOKIE_NAME}=${jwt}`));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.authenticated).toBe(true);
    expect(body.projectId).toBe('uuid-test');
  });

  it('returns 401 + authenticated=false when no cookie is sent', async () => {
    const resp = await getSession(makeReq());
    expect(resp.status).toBe(401);
    const body = await resp.json();
    expect(body.authenticated).toBe(false);
  });

  it('returns 401 + authenticated=false when the cookie JWT is invalid', async () => {
    const resp = await getSession(
      makeReq(`${SESSION_COOKIE_NAME}=not-a-real-jwt`),
    );
    expect(resp.status).toBe(401);
    const body = await resp.json();
    expect(body.authenticated).toBe(false);
  });

  it('ignores the legacy sally_session cookie (only honors hirewire_session)', async () => {
    const jwt = await issueSession({ projectId: 'uuid-test' });
    const resp = await getSession(makeReq(`sally_session=${jwt}`));
    expect(resp.status).toBe(401);
  });
});

describe('DELETE /api/auth/session', () => {
  it('clears the hirewire_session cookie', async () => {
    const resp = await deleteSession();
    expect(resp.status).toBe(200);
    const cookie = resp.headers.get('Set-Cookie') || '';
    expect(cookie).toMatch(/hirewire_session=;/);
    expect(cookie).toMatch(/Max-Age=0/);
  });
});
