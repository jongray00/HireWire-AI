/**
 * Mock for @/lib/db — used in API route tests
 */
import { vi } from 'vitest';

export const mockDb = {
  upsertUser: vi.fn(),
  getUserByProjectId: vi.fn(),
  getEmployeesByProject: vi.fn(() => []),
  getAllEmployees: vi.fn(() => []),
  getEmployeeById: vi.fn(),
  upsertEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  insertCallLog: vi.fn(),
  getCallLogs: vi.fn(() => []),
  employeeRowToJson: vi.fn((row) => row),
};

vi.mock('@/lib/db', () => mockDb);
