/**
 * Session API Endpoint (Phase 2)
 *
 * GET: Returns the current Phase 2 session derived from the
 *      `hirewire_session` JWT cookie. Used by the login page to
 *      auto-redirect already-authenticated users to /dashboard.
 *
 *      Shape:
 *        200 { authenticated: true,  projectId }
 *        401 { authenticated: false }
 *
 * DELETE: Clears the `hirewire_session` cookie (logout fallback).
 */

import { getSessionFromRequest, buildClearSessionCookie } from '@/lib/jwt';

export async function GET(request) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  return Response.json({
    authenticated: true,
    projectId: session.projectId,
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
