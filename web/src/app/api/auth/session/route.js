/**
 * Session API Endpoint
 *
 * GET:    Returns current session info (projectId, spaceUrl) or 401
 * DELETE: Clears the session cookie (logout)
 */

import { getSessionFromRequest, buildClearSessionCookie } from '@/lib/session';
import { getUserByProjectId } from '@/lib/db';

export async function GET(request) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = getUserByProjectId(session.projectId);
  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 401 });
  }

  return Response.json({
    projectId: user.project_id,
    spaceUrl: user.space_url,
    subscriberId: user.subscriber_id,
    subscriberData: user.subscriber_data ? JSON.parse(user.subscriber_data) : null,
  });
}

export async function DELETE() {
  return new Response(JSON.stringify({ success: true, message: 'Logged out' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildClearSessionCookie(),
    },
  });
}
