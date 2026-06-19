// In-process sliding-window rate limiter.
// Keyed by an arbitrary string (e.g. "login:<ip>", "reset:<email>").
// Resets automatically when the window expires — no cleanup job needed.
// NOTE: state is per-process. Across Vercel function instances, limits are
// enforced per-instance, which is acceptable for this single-tenant app.

type Entry = { count: number; resetAt: number };
const _store = new Map<string, Entry>();

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSecs: number };

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = _store.get(key);

  if (!entry || now >= entry.resetAt) {
    _store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  entry.count += 1;
  if (entry.count > limit) {
    const retryAfterSecs = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfterSecs };
  }

  return { allowed: true };
}

// Exposed only for unit tests — do not call in production code.
export function _resetStoreForTest() {
  _store.clear();
}
