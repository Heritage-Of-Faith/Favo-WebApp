// AT-206 — PRD §9.6.2 job 3: "for week ending …". Shared by the push and the
// screen so both name the week the same way. Pure and client-safe.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-16" → "16 Aug 2026" (a calendar date; no timezone involved). */
export function formatWeekEnding(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
