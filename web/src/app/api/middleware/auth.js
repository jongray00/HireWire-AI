/**
 * Auth Middleware for API Routes
 *
 * Reads the JWT session cookie, verifies it, and returns the user's
 * credentials from the database. Returns 401 if no valid session.
 *
 * Usage in route handlers:
 *   import { requireAuth } from '@/app/api/middleware/auth';
 *
 *   const auth = await requireAuth(request);
 *   if (auth.error) return auth.error;
 *   const { projectId, spaceUrl, apiToken } = auth;
 */

import { getSessionFromRequest } from '@/lib/session';
import { getUserByProjectId } from '@/lib/db';

/**
 * Require authentication — returns user info or a 401 Response
 */
export async function requireAuth(request) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return {
      error: Response.json(
        { error: 'Not authenticated' },
        { status: 401 }
      ),
    };
  }

  const user = getUserByProjectId(session.projectId);
  if (!user) {
    return {
      error: Response.json(
        { error: 'User not found' },
        { status: 401 }
      ),
    };
  }

  return {
    projectId: user.project_id,
    spaceUrl: user.space_url,
    apiToken: user.api_token,
    subscriberId: user.subscriber_id,
    subscriberData: user.subscriber_data ? JSON.parse(user.subscriber_data) : null,
  };
}

/**
 * Optional auth — returns user info or null (no error response)
 */
export async function optionalAuth(request) {
  const session = await getSessionFromRequest(request);
  if (!session) return null;

  const user = getUserByProjectId(session.projectId);
  if (!user) return null;

  return {
    projectId: user.project_id,
    spaceUrl: user.space_url,
    apiToken: user.api_token,
    subscriberId: user.subscriber_id,
    subscriberData: user.subscriber_data ? JSON.parse(user.subscriber_data) : null,
  };
}
