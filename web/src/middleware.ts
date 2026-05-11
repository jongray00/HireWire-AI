/**
 * Route guard for /dashboard/**.
 *
 * React Router v7 + Hono Server runtime: this middleware is invoked by
 * server-side request handling before the route module renders. If the
 * hirewire_session cookie is missing or invalid, redirect to /login.
 */
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/jwt';

export interface RouteContext {
  request: Request;
  url: URL;
}

export const PROTECTED_PREFIXES = ['/dashboard'];

export async function authMiddleware(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!PROTECTED_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    return null;
  }
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) {
    return Response.redirect(new URL('/login', request.url).toString(), 302);
  }
  try {
    await verifySession(match[1]);
    return null;
  } catch {
    return Response.redirect(new URL('/login', request.url).toString(), 302);
  }
}
