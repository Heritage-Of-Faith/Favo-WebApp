"use client";

// Lot drawer — task A8 (R10 recosting).
// A right-side slide-over listing all lots for an inventory item. Each lot's
// unit cost is editable (updateLotCost → audit + cogs_changes ping). Bean lots
// show a freshness badge (T02) derived from roast date.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listLots, updateLotCost } from "@/server/actions/inventory";
import { formatDate } from "@/lib/format";
import { freshness } from "@/lib/status/freshness";
import StatusBadge, { freshnessVariant } from "@/components/shared/StatusBadge";
import type { InventoryItemStatus, InventoryLot } from "@/lib/types";

export interface LotDrawerProps {
  item: InventoryItemStatus | null;
  onClose: () => void;
  /** Called after a cost edit so the parent can refresh COGS-dependent views. */
  onCostUpdated: () => void;
}

const LOT_STATE_VARIANT = {
  active: "ok",
  depleted: "neutral",
  expired: "out",
  quarantined: "warning",
} as const;

export default function LotDrawer({ item, onClose, onCostUpdated }: LotDrawerProps) {
  const open = item !== null;
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCost, setDraftCost] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setLoading(true);
    setError(null);
    listLots(item.id)
      .then((res) => {
        if (res.ok) setLots(res.data.lots);
        else setError(res.message);
      })
      .catch(() => setError("Failed to load lots."))
      .finally(() => setLoading(false));
  }, [item]);

  async function saveCost(lotId: string) {
    const n = Number(draftCost);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Cost must be a number ≥ 0.");
      return;
    }
    setSaving(true);
    // unit_cost_zar is numeric(10,4) — pass a fixed-precision string.
    const res = await updateLotCost(lotId, n.toFixed(4));
    setSaving(false);
    if (res.ok) {
      toast.success("Lot cost updated.");
      setLots((prev) => prev.map((l) => (l.id === lotId ? { ...l, unitCostZar: n.toFixed(4) } : l)));
      setEditingId(null);
      onCostUpdated();
    } else {
      toast.error(res.message);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-label={`Lots for ${item.name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l shadow-[var(--shadow-2)]"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border-subtle)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          <div>
            <h2 className="admin-section-title" style={{ color: "var(--color-text-strong)" }}>
              {item.name}
            </h2>
            <p className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
              {item.kind} · {item.currentStock} {item.unit} in stock
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-btn)] text-xl"
            style={{ color: "var(--color-text-muted)" }}
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
              Loading lots…
            </p>
          )}
          {error && (
            <p className="favo-small" style={{ color: "var(--color-error)" }}>
              {error}
            </p>
          )}
          {!loading && !error && lots.length === 0 && (
            <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
              No lots recorded for this item yet.
            </p>
          )}

          <ul className="space-y-3">
            {lots.map((lot) => (
              <li
                key={lot.id}
                className="rounded-[var(--radius-card)] border p-3"
                style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
                    {lot.origin ?? lot.sourceName ?? "Lot"}
                    {lot.batchNumber ? ` · ${lot.batchNumber}` : ""}
                  </span>
                  <StatusBadge variant={LOT_STATE_VARIANT[lot.state]}>{lot.state}</StatusBadge>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <Field label="Received">{formatDate(lot.receivedAt)}</Field>
                  <Field label="Remaining">
                    {lot.quantityRemaining} {item.unit}
                  </Field>
                  {lot.roastDate && (
                    <Field label="Roasted">
                      <span className="inline-flex items-center gap-1.5">
                        {formatDate(lot.roastDate)}
                        <StatusBadge variant={freshnessVariant(freshness(lot.roastDate))} dot={false} />
                      </span>
                    </Field>
                  )}
                  {lot.quantityReceived && <Field label="Received qty">{lot.quantityReceived}</Field>}
                </dl>

                {/* Editable unit cost (R10 recosting) */}
                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2" style={{ borderColor: "var(--color-border-subtle)" }}>
                  <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
                    Cost / {item.unit}
                  </span>
                  {editingId === lot.id ? (
                    <span className="inline-flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        step="0.0001"
                        value={draftCost}
                        autoFocus
                        onChange={(e) => setDraftCost(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveCost(lot.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-9 w-28 rounded-[var(--radius-btn)] border px-2 favo-small"
                        style={{
                          background: "var(--color-surface)",
                          color: "var(--color-text-strong)",
                          borderColor: "var(--color-border-subtle)",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => void saveCost(lot.id)}
                        disabled={saving}
                        className="min-h-9 px-2 favo-cta disabled:opacity-50"
                        style={{ color: "var(--color-accent)" }}
                      >
                        {saving ? "…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="min-h-9 px-1 favo-small"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftCost(lot.unitCostZar ?? "0");
                        setEditingId(lot.id);
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-btn)] px-2 favo-small hover:bg-[color:var(--color-porcelain-soft)]"
                      style={{ color: "var(--color-text-strong)" }}
                    >
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {lot.unitCostZar ?? "—"}
                      </span>
                      <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
                        ✎
                      </span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </dt>
      <dd className="favo-small" style={{ color: "var(--color-text-strong)" }}>
        {children}
      </dd>
    </div>
  );
}
