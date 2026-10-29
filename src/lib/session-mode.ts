// AT-181 — the default mode of an opening session, from its date.
//
// PRD §10.3: opening_sessions.mode is "the day's mode, defaulted from the
// date, confirmed by the barista". PRD §4.2 mode table: Monday–Friday →
// Weekday; Sunday → Sunday; Saturday → "No default — the café is closed
// unless an event says otherwise", and "a session cannot be opened on a
// Saturday at all unless an event window is in force". Event windows do not
// exist yet, so a Saturday has no mode and callers must refuse the session.
// The barista's confirmation step is not built here.

export type SessionMode = "weekday" | "sunday" | "event";

/**
 * Default mode for a session date (YYYY-MM-DD, already the SAST revenue day —
 * see todaySast / revenueDay), or `null` on a Saturday, which has no default.
 * A calendar date's weekday does not depend on a timezone, so it is read at
 * UTC noon.
 */
export function defaultSessionMode(sessionDate: string): Exclude<SessionMode, "event"> | null {
  const dow = new Date(`${sessionDate}T12:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  if (Number.isNaN(dow)) throw new Error(`Invalid session date: ${sessionDate}`);
  if (dow === 0) return "sunday";
  if (dow === 6) return null;
  return "weekday";
}

/** Refusal for a Saturday session while no event window can be in force. */
export const SATURDAY_CLOSED = {
  code: "SATURDAY_CLOSED",
  message: "The café is closed on Saturdays unless an event is set up. Events aren't available yet.",
} as const;
