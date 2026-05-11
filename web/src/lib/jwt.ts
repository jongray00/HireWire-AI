import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE_NAME = 'hirewire_session';
export const SESSION_TTL_SECS = 24 * 60 * 60; // 24h, per spec §Flow A step 7
const JWT_ISSUER = 'hirewire';

export interface SessionClaims {
  projectId: string;
}

export interface VerifiedClaims extends SessionClaims {
  iat: number;
  exp: number;
}

export class SessionError extends Error {}

function getSecret(): Uint8Array {
  const raw = process.env.HIREWIRE_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new SessionError('HIREWIRE_JWT_SECRET must be at least 32 chars');
  }
  return new TextEncoder().encode(raw);
}

export async function issueSession(
  claims: SessionClaims,
  opts: { ttlSeconds?: number } = {},
): Promise<string> {
  const ttl = opts.ttlSeconds ?? SESSION_TTL_SECS;
  return new SignJWT({ projectId: claims.projectId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<VerifiedClaims> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
    });
    if (typeof payload.projectId !== 'string' || payload.projectId.length === 0) {
      throw new SessionError('missing projectId claim');
    }
    return {
      projectId: payload.projectId,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch (err) {
    if (err instanceof SessionError) throw err;
    throw new SessionError((err as Error).message);
  }
}

export function buildSessionCookie(token: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECS}`,
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export async function getSessionFromRequest(request: Request): Promise<VerifiedClaims | null> {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    return await verifySession(match[1]);
  } catch {
    return null;
  }
}
