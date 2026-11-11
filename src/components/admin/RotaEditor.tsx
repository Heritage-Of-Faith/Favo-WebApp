"use client";

// The barista rota editor — PRD §6.3, §10.3 barista_shifts (`shift_date +
// slot`), COL-23. Admin only (§11 matrix). Rows are the next 14 days × the
// day's sessions (1 = first, 2 = second); columns are the active baristas.
// Ticking a cell puts that barista on duty for that session. Optimistic, and
// reverts on a server refusal. A shift whose session has opened is locked.

import { useState } from "react";
import { toast } from "sonner";
import { addShift, removeShift, type RotaShift } from "@/server/actions/rota";
import { ROTA_SLOTS } from "@/lib/rota";

export interface RotaEditorProps {
  today: string;
  /** Sessions opened today, deleted ones included: today's slots up to this are locked. */
  openedToday: number;
  dates: string[];
  baristas: { id: string; name: string }[];
  initialShifts: RotaShift[];
}

type Cell = { id: string; locked: boolean } | "pending";

function key(date: string, slot: number, staffId: string) {
  return `${date}#${slot}#${staffId}`;
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
  }).format(new Date(`${date}T00:00:00Z`));
}

const SLOT_LABEL: Record<number, string> = { 1: "First session", 2: "Second session" };

export default function RotaEditor({ today, openedToday, dates, baristas, initialShifts }: RotaEditorProps) {
  const [cells, setCells] = useState<Map<string, Cell>>(() => {
    const m = new Map<string, Cell>();
    for (const s of initialShifts) m.set(key(s.shiftDate, s.slot, s.staffId), { id: s.id, locked: s.sessionOpened });
    return m;
  });

  function set(k: string, v: Cell | null) {
    setCells((prev) => {
      const next = new Map(prev);
      if (v === null) next.delete(k);
      else next.set(k, v);
      return next;
    });
  }

  async function toggle(date: string, slot: number, staffId: string) {
    const k = key(date, slot, staffId);
    const cur = cells.get(k);
    if (cur === "pending" || (cur && cur.locked) || (date === today && slot <= openedToday)) return;
    if (cur) {
      set(k, null);
      const res = await removeShift(cur.id);
      if (!res.ok) { set(k, cur); toast.error(res.message); }
    } else {
      set(k, "pending");
      const res = await addShift({ staffId, shiftDate: date, slot });
      if (res.ok) set(k, { id: res.data.shiftId, locked: false });
      else { set(k, null); toast.error(res.message); }
    }
  }

  if (baristas.length === 0) {
    return (
      <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
        No active baristas. Add one under Staff first.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={{ borderColor: "var(--color-border-subtle)" }}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr style={{ background: "var(--color-elevated)" }}>
            <th className="sticky left-0 z-10 px-3 py-2.5 favo-caption" style={{ background: "var(--color-elevated)", color: "var(--color-text-muted)" }}>
              Day · session
            </th>
            {baristas.map((b) => (
              <th key={b.id} className="px-3 py-2.5 text-center favo-caption" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
                {b.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.flatMap((date) =>
            ROTA_SLOTS.map((slot) => (
              <tr key={`${date}#${slot}`} style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 px-3 py-2.5 favo-small"
                  style={{ background: "var(--color-surface)", color: "var(--color-text-strong)", whiteSpace: "nowrap", fontWeight: slot === 1 ? 600 : 400 }}
                >
                  {slot === 1 ? `${dayLabel(date)}${date === today ? " (today)" : ""}` : ""}
                  <span className="favo-caption" style={{ display: "block", color: "var(--color-text-muted)", fontWeight: 400 }}>
                    {SLOT_LABEL[slot]}
                  </span>
                </th>
                {baristas.map((b) => {
                  const cell = cells.get(key(date, slot, b.id));
                  const busy = cell === "pending";
                  const slotOpened = date === today && slot <= openedToday;
                  const locked = slotOpened || (cell !== undefined && cell !== "pending" && cell.locked);
                  return (
                    <td key={b.id} className="px-3 py-2.5 text-center">
                      <label
                        className="inline-flex items-center justify-center"
                        style={{ width: 44, height: 44, cursor: busy || locked ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}
                      >
                        <input
                          type="checkbox"
                          checked={cell !== undefined}
                          disabled={busy || locked}
                          onChange={() => void toggle(date, slot, b.id)}
                          aria-label={`${b.name} on duty, ${dayLabel(date)}, ${SLOT_LABEL[slot]}${locked ? " (session opened)" : ""}`}
                          style={{ width: 18, height: 18, accentColor: "var(--color-accent)" }}
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
