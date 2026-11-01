// AT-209 — which opening session "now" falls in (PRD §6.11.1: sessions are
// sequential, at most one open at a time, so "the current session" is a
// definition, not a search). opening_sessions has no closed_at yet, so a
// session runs from its opens_at to the next session's opens_at; the first runs
// from the start of the revenue day and the last to its end. This is the same
// rule src/server/tender/admin-notifier.ts uses for "two in one session".
// L33's "two comps per barista per session" is counted inside this window.

import { startOfDaySast } from "@/lib/format";

export type SessionWindow = { opensAt: string; from: Date; to: Date };

/** SAST is UTC+2 all year (no DST). */
function sessionStart(day: string, opensAt: string): Date {
  return new Date(`${day}T${opensAt}:00+02:00`);
}

/** null when the revenue day has no opening session (NO_SESSION). */
export function currentSessionWindow(day: string, opensAts: readonly string[], now: Date): SessionWindow | null {
  if (opensAts.length === 0) return null;
  const starts = [...opensAts].sort().map((opensAt) => ({ opensAt, at: sessionStart(day, opensAt) }));
  let idx = 0;
  starts.forEach((s, i) => { if (s.at.getTime() <= now.getTime()) idx = i; });
  const dayStart = startOfDaySast(day);
  const from = idx === 0 ? dayStart : starts[idx].at;
  const to = starts[idx + 1]?.at ?? new Date(dayStart.getTime() + 86_400_000);
  return { opensAt: starts[idx].opensAt, from, to };
}
