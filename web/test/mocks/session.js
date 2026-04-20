/**
 * Mock for @/lib/session — used in API route tests
 */
import { vi } from 'vitest';

export const mockSession = {
  createSessionToken: vi.fn(() => 'mock-jwt-token'),
  verifySessionToken: vi.fn(() => ({ projectId: 'test-project', spaceUrl: 'test.signalwire.com' })),
  buildSessionCookie: vi.fn(() => 'sally_session=mock-jwt-token; Path=/; HttpOnly'),
  buildClearSessionCookie: vi.fn(() => 'sally_session=; Path=/; HttpOnly; Max-Age=0'),
  getSessionFromRequest: vi.fn(() => ({ projectId: 'test-project', spaceUrl: 'test.signalwire.com' })),
};

vi.mock('@/lib/session', () => mockSession);
