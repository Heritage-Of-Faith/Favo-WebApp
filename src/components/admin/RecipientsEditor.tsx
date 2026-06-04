"use client";

// Low-stock recipient editor — task A12.
// A scope × staff matrix: rows are "Global" + each inventory item, columns are
// staff. Toggling a cell adds/removes a stock_alert_recipients row. Toggles are
// optimistic and revert on server error.

import { useState } from "react";
import { toast } from "sonner";
import {
  addStockAlertRecipient,
  removeStockAlertRecipient,
} from "@/server/actions/alert-recipients";
import type { AlertRecipient } from "@/lib/types";

export interface RecipientsEditorProps {
  /** Inventory items (scopes), excluding the Global pseudo-scope. */
  items: { id: string; name: string }[];
  /** Active staff who can receive alerts. */
  staff: { id: string; name: string; role: string }[];
  initialRecipients: AlertRecipient[];
}

const GLOBAL = "__global__";
const PENDING = "__pending__";

function key(staffId: string, scope: string) {
  return `${staffId}::${scope}`;
}

export default function RecipientsEditor({ items, staff, initialRecipients }: RecipientsEditorProps) {
  // key(staffId, scope) → recipientId (or PENDING while in flight)
  const [map, setMap] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const r of initialRecipients) {
      m.set(key(r.staffId, r.inventoryItemId ?? GLOBAL), r.id);
    }
    return m;
  });
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  const scopes = [{ id: GLOBAL, name: "Global (all items)" }, ...items];

  function setBusy(k: string, busy: boolean) {
    setInFlight((prev) => {
      const next = new Set(prev);
      if (busy) next.add(k);
      else next.delete(k);
      return next;
    });
  }

  async function toggle(staffId: string, scope: string) {
    const k = key(staffId, scope);
    if (inFlight.has(k)) return;
    const existing = map.get(k);

    if (existing && existing !== PENDING) {
      // Optimistic remove
      setMap((prev) => {
        const next = new Map(prev);
        next.delete(k);
        return next;
      });
      setBusy(k, true);
      const res = await removeStockAlertRecipient(existing);
      setBusy(k, false);
      if (!res.ok) {
        // revert
        setMap((prev) => new Map(prev).set(k, existing));
        toast.error(res.message);
      }
    } else if (!existing) {
      // Optimistic add
      setMap((prev) => new Map(prev).set(k, PENDING));
      setBusy(k, true);
      const res = await addStockAlertRecipient({
        staffId,
        inventoryItemId: scope === GLOBAL ? null : scope,
      });
      setBusy(k, false);
      if (res.ok) {
        setMap((prev) => new Map(prev).set(k, res.data.recipientId));
      } else {
        setMap((prev) => {
          const next = new Map(prev);
          next.delete(k);
          return next;
        });
        toast.error(res.message);
      }
    }
  }

  if (staff.length === 0) {
    return (
      <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
        No active staff to assign. Add staff first.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={{ borderColor: "var(--color-border-subtle)" }}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr style={{ background: "var(--color-elevated)" }}>
            <th className="sticky left-0 z-10 px-3 py-2.5 favo-caption" style={{ background: "var(--color-elevated)", color: "var(--color-text-muted)" }}>
              Scope
            </th>
            {staff.map((s) => (
              <th key={s.id} className="px-3 py-2.5 text-center favo-caption" style={{ color: "var(--color-text-muted)" }}>
                <span style={{ display: "block", color: "var(--color-text-strong)", fontWeight: 600 }}>{s.name}</span>
                <span style={{ textTransform: "capitalize" }}>{s.role}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scopes.map((scope, rowIdx) => (
            <tr
              key={scope.id}
              style={{
                borderTop: "1px solid var(--color-border-subtle)",
                background: scope.id === GLOBAL ? "color-mix(in srgb, var(--color-info) 6%, transparent)" : undefined,
              }}
            >
              <th
                scope="row"
                className="sticky left-0 z-10 px-3 py-2.5 favo-small"
                style={{
                  background: scope.id === GLOBAL ? "color-mix(in srgb, var(--color-info) 6%, var(--color-surface))" : "var(--color-surface)",
                  color: "var(--color-text-strong)",
                  fontWeight: rowIdx === 0 ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {scope.name}
              </th>
              {staff.map((s) => {
                const k = key(s.id, scope.id);
                const checked = map.has(k);
                const busy = inFlight.has(k);
                return (
                  <td key={s.id} className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => void toggle(s.id, scope.id)}
                      aria-label={`${s.name} receives alerts for ${scope.name}`}
                      style={{ width: 18, height: 18, cursor: busy ? "wait" : "pointer", accentColor: "var(--color-accent)" }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
