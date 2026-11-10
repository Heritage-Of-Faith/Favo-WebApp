// REQ-122 · PRD §7.2: the rollup is read over "a selected week or month".
// A week is Monday–Sunday (the same week /admin/write-downs uses); a month is
// its first to last calendar day. Revenue days are SAST calendar dates (L07),
// so this is plain calendar arithmetic. Pure and client-safe.

export type RollupPeriodKind = "week" | "month";

export function isCalendarDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The week (Mon–Sun) or month containing `day` (YYYY-MM-DD), inclusive. */
export function periodContaining(kind: RollupPeriodKind, day: string): { from: string; to: string } {
  const d = new Date(`${day}T00:00:00Z`);
  if (kind === "week") {
    const sinceMonday = (d.getUTCDay() + 6) % 7;
    const monday = new Date(d.getTime() - sinceMonday * 86_400_000);
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
  }
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
