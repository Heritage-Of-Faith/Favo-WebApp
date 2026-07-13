"use client";

/**
 * TodaySessionsPlanner — AT-134 (wireframe screen 3 / 1c).
 * Admin view of today's opening sessions: rows come from the POS opening
 * prompt (tagged "via POS") or from admin planning here. End time optional
 * (open-ended). Falls back to the weekly schedule when no sessions exist.
 * Planner edits are silent — customer pushes only come from the barista flow.
 */

import { useState } from "react";
import {
  addTodaySession, updateTodaySession, deleteTodaySession,
  type OpeningSession,
} from "@/server/actions/opening";

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth"];

type EditState = { id: string | null; opensAt: string; closesAt: string; notify: boolean } | null;

export type TodaySessionsPlannerProps = {
  initialSessions: OpeningSession[];
  todayLabel: string;      // "Tue 7 Jul"
  fallbackLabel: string;   // "your usual Tuesday hours (07:00–17:00)" | "no usual hours set"
};

export default function TodaySessionsPlanner({ initialSessions, todayLabel, fallbackLabel }: TodaySessionsPlannerProps) {
  const [sessions, setSessions] = useState<OpeningSession[]>(initialSessions);
  const [edit, setEdit] = useState<EditState>(null); // id=null → adding
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!edit || busy) return;
    setBusy(true);
    setError(null);
    const input = { opensAt: edit.opensAt, closesAt: edit.closesAt || null, notify: edit.notify };
    const res = edit.id
      ? await updateTodaySession(edit.id, input)
      : await addTodaySession(input);
    setBusy(false);
    if (res.ok) { setSessions(res.data.sessions); setEdit(null); }
    else setError(res.message);
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await deleteTodaySession(id);
    setBusy(false);
    if (res.ok) setSessions(res.data.sessions);
    else setError(res.message);
  }

  const timeInput = (value: string, onChange: (v: string) => void, label: string) => (
    <input type="time" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
      className="rounded border border-border-subtle bg-surface px-2 py-1.5 text-sm text-text-strong focus:outline-none focus:ring-2 focus:ring-ring" />
  );

  // AT-134: admin edits are silent unless the admin opts in per change.
  const notifyCheckbox = (checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex items-center gap-1.5 text-sm text-text-muted">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border-subtle" aria-label="Notify customers" />
      Notify customers
    </label>
  );

  return (
    <section aria-label="Today's hours" className="mb-8 rounded-md border border-border-subtle bg-elevated p-4">
      <h2 className="text-base font-semibold text-text-strong">Today&rsquo;s Hours — {todayLabel}</h2>

      <div className="mt-3 space-y-2">
        {sessions.length === 0 && !edit && (
          <p className="text-sm text-text-muted">No sessions set for today.</p>
        )}
        {sessions.map((s, i) =>
          edit?.id === s.id ? (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded border border-border-subtle bg-surface px-3 py-2">
              <span className="text-sm font-medium text-text-strong w-32">{ORDINALS[i] ?? `${i + 1}th`} opening</span>
              {timeInput(edit.opensAt, (v) => setEdit({ ...edit, opensAt: v }), "Opens at")}
              <span className="text-text-muted text-sm">–</span>
              {timeInput(edit.closesAt, (v) => setEdit({ ...edit, closesAt: v }), "Closes at (optional)")}
              {notifyCheckbox(edit.notify, (v) => setEdit({ ...edit, notify: v }))}
              <button type="button" onClick={save} disabled={busy || !edit.opensAt}
                className="rounded border border-border-subtle bg-elevated px-3 py-1.5 text-sm font-medium text-text-strong hover:bg-surface disabled:opacity-40">
                Save
              </button>
              <button type="button" onClick={() => setEdit(null)} disabled={busy}
                className="text-sm text-text-muted hover:text-text-strong">
                Cancel
              </button>
            </div>
          ) : (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded border border-border-subtle bg-surface px-3 py-2">
              <span className="text-sm font-medium text-text-strong w-32">{ORDINALS[i] ?? `${i + 1}th`} opening</span>
              {s.viaPos && (
                <span className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  via POS
                </span>
              )}
              <span className="text-sm text-text-strong tabular-nums">
                {s.opensAt} {s.closesAt ? `– ${s.closesAt}` : "→ open-ended"}
              </span>
              <span className="ml-auto flex gap-3">
                <button type="button" disabled={busy}
                  onClick={() => setEdit({ id: s.id, opensAt: s.opensAt, closesAt: s.closesAt ?? "", notify: false })}
                  className="text-xs text-text-muted underline underline-offset-2 hover:text-text-strong">
                  Edit
                </button>
                <button type="button" disabled={busy} onClick={() => remove(s.id)}
                  className="text-xs text-text-muted underline underline-offset-2 hover:text-text-strong">
                  Delete
                </button>
              </span>
            </div>
          )
        )}

        {edit && edit.id === null && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-border-subtle bg-surface px-3 py-2">
            <span className="text-sm font-medium text-text-strong w-32">New session</span>
            {timeInput(edit.opensAt, (v) => setEdit({ ...edit, opensAt: v }), "Opens at")}
            <span className="text-text-muted text-sm">–</span>
            {timeInput(edit.closesAt, (v) => setEdit({ ...edit, closesAt: v }), "Closes at (optional)")}
            {notifyCheckbox(edit.notify, (v) => setEdit({ ...edit, notify: v }))}
            <button type="button" onClick={save} disabled={busy || !edit.opensAt}
              className="rounded border border-border-subtle bg-elevated px-3 py-1.5 text-sm font-medium text-text-strong hover:bg-surface disabled:opacity-40">
              Save
            </button>
            <button type="button" onClick={() => setEdit(null)} disabled={busy}
              className="text-sm text-text-muted hover:text-text-strong">
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-[var(--color-error,#ef4444)]" role="alert">{error}</p>}

      {!edit && (
        <button type="button" disabled={busy} onClick={() => setEdit({ id: null, opensAt: "", closesAt: "", notify: false })}
          className="mt-3 rounded border border-border-subtle bg-surface px-3 py-1.5 text-sm font-medium text-text-strong hover:bg-elevated">
          + Add session
        </button>
      )}

      <p className="mt-3 text-xs text-text-muted">
        Falls back to {fallbackLabel} if no sessions are set for today. Planner
        changes stay silent unless you tick &ldquo;Notify customers&rdquo; on the edit.
      </p>
    </section>
  );
}
