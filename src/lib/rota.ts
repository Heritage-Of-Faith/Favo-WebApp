// The barista rota — pure helpers shared by the Admin rota actions and screen.
// PRD §6.3, §10.3 barista_shifts (`shift_date + slot`), §6.11.1 COL-23.
//
// A slot is a session's order of opening on its revenue day: 1 = the first
// session, 2 = the second (a Sunday's evening session). It is what lets a rota
// entry exist before its session does.

export const ROTA_DAYS = 14;

/** The slots the Admin screen offers. The table accepts any slot >= 1. */
export const ROTA_SLOTS = [1, 2] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isRotaDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** `start` and the following days, YYYY-MM-DD, `days` in all. */
export function rotaDates(start: string, days: number = ROTA_DAYS): string[] {
  const base = new Date(`${start}T00:00:00Z`).getTime();
  return Array.from({ length: days }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}
