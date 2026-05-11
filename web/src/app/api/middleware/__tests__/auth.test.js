// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { issueSession, SESSION_COOKIE_NAME } from '@/lib/jwt';

// Mock the db module
vi.mock('@/lib/db', () => ({
  getUserByProjectId: vi.fn(),
}));

import { getUserByProjectId } from '@/lib/db';
import { requireAuth, optionalAuth } from '../auth';

beforeEach(() => {
  process.env.HIREWIRE_JWT_SECRET = 'test-secret-at-least-32-chars-long-xx';
});

function makeRequest(cookie) {
  const headers = cookie ? { Cookie: cookie } : {};
  return new Request('http://localhost/api/test', { headers });
}

describe('requireAuth', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when no cookie', async () => {
    const result = await requireAuth(makeRequest());
    expect(result.error).toBeDefined();
    const body = await result.error.json();
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 401 when user not in database', async () => {
    const token = await issueSession({ projectId: 'missing' });
    getUserByProjectId.mockReturnValue(null);

    const result = await requireAuth(makeRequest(`${SESSION_COOKIE_NAME}=${token}`));
    expect(result.error).toBeDefined();
  });

  it('returns user data when session is valid', async () => {
    const token = await issueSession({ projectId: 'proj-1' });
    getUserByProjectId.mockReturnValue({
      project_id: 'proj-1',
      space_url: 'test.sw.com',
      api_token: 'tok-123',
      subscriber_id: 'sub-1',
      subscriber_data: null,
    });

    const result = await requireAuth(makeRequest(`${SESSION_COOKIE_NAME}=${token}`));
    expect(result.error).toBeUndefined();
    expect(result.projectId).toBe('proj-1');
    expect(result.apiToken).toBe('tok-123');
  });
});

describe('optionalAuth', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null when no cookie (no error)', async () => {
    const result = await optionalAuth(makeRequest());
    expect(result).toBeNull();
  });

  it('returns user data when session is valid', async () => {
    const token = await issueSession({ projectId: 'proj-1' });
    getUserByProjectId.mockReturnValue({
      project_id: 'proj-1',
      space_url: 'test.sw.com',
      api_token: 'tok-123',
      subscriber_id: null,
      subscriber_data: null,
    });

    const result = await optionalAuth(makeRequest(`${SESSION_COOKIE_NAME}=${token}`));
    expect(result.projectId).toBe('proj-1');
  });
});
