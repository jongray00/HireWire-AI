/**
 * JWT Session Module
 *
 * Lightweight session management using signed JWT cookies.
 * JWT payload: { projectId, spaceUrl }
 *
 * Uses `jose` for JWT sign/verify (works in all runtimes).
 */

import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'sally_session';
const JWT_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'sally-sales-default-session-secret-change-me'
);
const JWT_ISSUER = 'sally-sales';
const JWT_EXPIRATION = '7d';

export interface SessionPayload {
  projectId: string;
  spaceUrl: string;
}

/**
 * Create a signed JWT token
 */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(JWT_EXPIRATION)
    .sign(JWT_SECRET);
}

/**
 * Verify and decode a JWT token
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
    });
    if (payload.projectId && payload.spaceUrl) {
      return {
        projectId: payload.projectId as string,
        spaceUrl: payload.spaceUrl as string,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build Set-Cookie header value for the session
 */
export function buildSessionCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 60 * 60}`, // 7 days
  ];
  if (isProduction) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Build Set-Cookie header value that clears the session
 */
export function buildClearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Extract session from a Request object (reads the cookie)
 */
export async function getSessionFromRequest(request: Request): Promise<SessionPayload | null> {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySessionToken(match[1]);
}

/**
 * Cookie name export for external use
 */
export { COOKIE_NAME };
