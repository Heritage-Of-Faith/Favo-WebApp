// R3-3: how one of today's sessions reads on the admin Hours page. Only the one
// open session (closed_at IS NULL, §6.11.1) is open-ended; a closed session
// shows its planned end, or the time it was actually closed.

export type SessionSpanInput = {
  opensAt: string;
  closesAt: string | null;
  /** "HH:mm" SAST when the session was closed; null/undefined while open. */
  closedAt?: string | null;
};

/** "HH:mm" strings compare correctly as text. */
const after = (t: string, opensAt: string) => t > opensAt;

export function sessionSpan(s: SessionSpanInput): string {
  if (s.closedAt) {
    // QA R4-2: a close time is shown only when it is after the open time (a
    // future opening closed early would otherwise read "23:59 – 08:46").
    const closedAt = after(s.closedAt, s.opensAt) ? s.closedAt : null;
    if (s.closesAt) {
      return closedAt
        ? `${s.opensAt} – ${s.closesAt} · closed ${closedAt}`
        : `${s.opensAt} – ${s.closesAt} · closed`;
    }
    return closedAt ? `${s.opensAt} – ${closedAt} · closed` : `${s.opensAt} · closed`;
  }
  return s.closesAt ? `${s.opensAt} – ${s.closesAt}` : `${s.opensAt} → open-ended`;
}

const ORDINAL_WORDS = [
  "First", "Second", "Third", "Fourth", "Fifth", "Sixth",
  "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth",
];

/**
 * QA R6-2: a planned end must come after the open time. Returns the refusal
 * message, or null when the times are fine (no end = open-ended, fine).
 * Shared by the Hours planner form and the admin session actions.
 */
export function plannedEndError(opensAt: string, closesAt: string | null | undefined): string | null {
  if (!closesAt) return null;
  return closesAt > opensAt ? null : "The planned end must be after the open time.";
}

/** Row label for the i-th (0-based) session: always a word, never "6th" (QA R4-2). */
export function openingLabel(i: number): string {
  const word = ORDINAL_WORDS[i];
  return word ? `${word} opening` : `Opening ${i + 1}`;
}
