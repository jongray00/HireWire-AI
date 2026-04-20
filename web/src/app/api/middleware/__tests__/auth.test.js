// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionToken } from '@/lib/session';

// Mock the db module
vi.mock('@/lib/db', () => ({
  getUserByProjectId: vi.fn(),
}));

import { getUserByProjectId } from '@/lib/db';
import { requireAuth, optionalAuth } from '../auth';

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
    const token = await createSessionToken({ projectId: 'missing', spaceUrl: 'test.sw.com' });
    getUserByProjectId.mockReturnValue(null);

    const result = await requireAuth(makeRequest(`sally_session=${token}`));
    expect(result.error).toBeDefined();
  });

  it('returns user data when session is valid', async () => {
    const token = await createSessionToken({ projectId: 'proj-1', spaceUrl: 'test.sw.com' });
    getUserByProjectId.mockReturnValue({
      project_id: 'proj-1',
      space_url: 'test.sw.com',
      api_token: 'tok-123',
      subscriber_id: 'sub-1',
      subscriber_data: null,
    });

    const result = await requireAuth(makeRequest(`sally_session=${token}`));
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
    const token = await createSessionToken({ projectId: 'proj-1', spaceUrl: 'test.sw.com' });
    getUserByProjectId.mockReturnValue({
      project_id: 'proj-1',
      space_url: 'test.sw.com',
      api_token: 'tok-123',
      subscriber_id: null,
      subscriber_data: null,
    });

    const result = await optionalAuth(makeRequest(`sally_session=${token}`));
    expect(result.projectId).toBe('proj-1');
  });
});
