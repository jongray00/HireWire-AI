/**
 * Fetch mock helper for API route tests
 */
import { vi } from 'vitest';

/**
 * Create a mock fetch that responds based on URL patterns.
 * @param {Object<string, { ok: boolean, status?: number, json?: any, text?: string }>} routes
 */
export function mockFetch(routes) {
  return vi.fn(async (url, options) => {
    for (const [pattern, response] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return {
          ok: response.ok ?? true,
          status: response.status ?? 200,
          json: async () => response.json ?? {},
          text: async () => response.text ?? '',
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'Not found' };
  });
}
