// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import { authMiddleware } from '../../middleware';
import { issueSession, SESSION_COOKIE_NAME } from '../jwt';

beforeEach(() => {
  process.env.HIREWIRE_JWT_SECRET = 'test-secret-at-least-32-chars-long-xx';
});

describe('authMiddleware', () => {
  it('passes through non-protected paths', async () => {
    const req = new Request('http://localhost/login');
    const out = await authMiddleware(req);
    expect(out).toBeNull();
  });

  it('redirects to /login when cookie missing on /dashboard', async () => {
    const req = new Request('http://localhost/dashboard');
    const out = await authMiddleware(req);
    expect(out?.status).toBe(302);
    expect(out?.headers.get('Location')).toContain('/login');
  });

  it('passes through with a valid session cookie', async () => {
    const token = await issueSession({ projectId: 'uuid-x' });
    const req = new Request('http://localhost/dashboard', {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    const out = await authMiddleware(req);
    expect(out).toBeNull();
  });

  it('redirects when cookie is invalid', async () => {
    const req = new Request('http://localhost/dashboard', {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=not-a-jwt` },
    });
    const out = await authMiddleware(req);
    expect(out?.status).toBe(302);
  });
});
