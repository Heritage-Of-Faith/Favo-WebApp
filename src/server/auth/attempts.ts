// In-process sliding-window attempt counters and cooldowns for PRD §9.5.3.
// Per-process state, like src/server/rate-limit.ts — acceptable for one
// always-on single-tenant server (§9.2).

const events = new Map<string, number[]>();
const cooldowns = new Map<string, number>(); // key → until (epoch ms)

function prune(key: string, windowMs: number, now: number): number[] {
  const kept = (events.get(key) ?? []).filter((t) => now - t < windowMs);
  if (kept.length) events.set(key, kept);
  else events.delete(key);
  return kept;
}

/** How many events were noted against `key` in the last `windowMs`. */
export function countRecent(key: string, windowMs: number): number {
  return prune(key, windowMs, Date.now()).length;
}

/** Note one event (e.g. a failed attempt) against `key`. */
export function noteAttempt(key: string, windowMs: number): void {
  const now = Date.now();
  const kept = prune(key, windowMs, now);
  kept.push(now);
  events.set(key, kept);
}

export function clearAttempts(key: string): void {
  events.delete(key);
}

/** Start a cooldown; returns its end time. */
export function startCooldown(key: string, ms: number): number {
  const until = Date.now() + ms;
  cooldowns.set(key, until);
  return until;
}

/** Seconds left on a cooldown, or 0 when none is running. */
export function cooldownSecsLeft(key: string): number {
  const until = cooldowns.get(key);
  if (until === undefined) return 0;
  const ms = until - Date.now();
  if (ms <= 0) {
    cooldowns.delete(key);
    return 0;
  }
  return Math.max(1, Math.ceil(ms / 1000));
}

/** Indirection so tests can observe delays without waiting for them. */
export const timing = {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

// Exposed only for unit tests — do not call in production code.
export function _resetAttemptsForTest(): void {
  events.clear();
  cooldowns.clear();
}
