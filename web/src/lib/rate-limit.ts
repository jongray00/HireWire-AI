/**
 * Simple in-process token-bucket rate limiter.
 *
 * Per-IP buckets — N requests per windowMs window. Returns true if allowed,
 * false if rate-limited. Buckets self-expire after windowMs of inactivity.
 *
 * In-process only. For multi-process deploys, replace with Redis later.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitOpts {
  key: string;
  windowMs: number;
  max: number;
}

export function checkRateLimit(opts: RateLimitOpts): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = buckets.get(opts.key);
  if (!existing || existing.resetAt < now) {
    buckets.set(opts.key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (existing.count >= opts.max) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }
  existing.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

/** For tests only: clear all buckets between cases. */
export function _resetRateLimitForTests(): void {
  buckets.clear();
}
