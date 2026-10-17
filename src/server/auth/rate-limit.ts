// In-memory fixed-window limiter. Adequate for a single application instance;
// use a shared store (e.g. Redis) when running several instances.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryInSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryInSec: 0 };
  }
  b.count++;
  if (b.count > limit) return { ok: false, retryInSec: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryInSec: 0 };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}
