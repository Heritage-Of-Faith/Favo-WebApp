"use client";

// Lot drawer — task A8 (R10 recosting).
// A right-side slide-over listing all lots for an inventory item. Each lot's
// unit cost is editable (updateLotCost → audit + cogs_changes ping). Bean lots
// show a freshness badge (T02) derived from roast date.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listLots, updateLotCost } from "@/server/actions/inventory";
import { formatDate, formatZar } from "@/lib/format";
import { formatUnitCostRands, parseLotUnitCost } from "@/lib/admin-input";
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
  // Container model: open = currently in use, closed = finished.
  open: "ok",
  closed: "neutral",
} as const;

export default function LotDrawer({ item, onClose, onCostUpdated }: LotDrawerProps) {
  const open = item !== null;
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCost, setDraftCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);

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

  // R2-15: Escape closes the drawer (an open cost edit handles its own Escape first).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingId === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, editingId, onClose]);

  async function saveCost(lotId: string) {
    setCostError(null);
    // Same rule as the server: no empty, no 0, nothing numeric(10,4) can't hold.
    const parsed = parseLotUnitCost(draftCost);
    if (!parsed.ok) {
      setCostError(parsed.message);
      return;
    }
    setSaving(true);
    try {
      const res = await updateLotCost(lotId, parsed.value);
      if (res.ok) {
        toast.success("Lot cost updated.");
        setLots((prev) => prev.map((l) => (l.id === lotId ? { ...l, unitCostZar: parsed.value } : l)));
        setEditingId(null);
        onCostUpdated();
      } else {
        setCostError(res.message);
      }
    } catch {
      setCostError("Could not save the cost. Please try again.");
    } finally {
      setSaving(false);
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
            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] text-xl"
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
                  <span className="favo-small min-w-0 break-words [overflow-wrap:anywhere]" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
                    {lot.origin ?? lot.sourceName ?? "Lot"}
                    {lot.batchNumber ? ` · ${lot.batchNumber}` : ""}
                  </span>
                  <span className="shrink-0"><StatusBadge variant={LOT_STATE_VARIANT[lot.state]}>{lot.state}</StatusBadge></span>
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
                  {/* Legacy quantity-model lots only — container lots never set this. */}
                  {lot.quantityReceived && <Field label="Received qty">{lot.quantityReceived}</Field>}
                  {/* Container model (milk & beans): real size bought + cost paid — no
                      predicted yield, actual cups made is the only yield number. */}
                  {lot.containerSize && (
                    <Field label="Size">{lot.containerSize} {lot.containerSizeUnit}</Field>
                  )}
                  {lot.containerCostZar != null && (
                    <Field label="Paid">{formatZar(lot.containerCostZar)}</Field>
                  )}
                  {item.unit === "cup" && (
                    <Field label="Cups made">{lot.cupsMade ?? 0}</Field>
                  )}
                  {item.unit === "cup" && lot.openedAt && (
                    <Field label="Opened">{formatDate(lot.openedAt)}</Field>
                  )}
                  {item.unit === "cup" && lot.closedAt && (
                    <Field label="Closed">{formatDate(lot.closedAt)}</Field>
                  )}
                </dl>

                {/* Editable unit cost (R10 recosting) */}
                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2" style={{ borderColor: "var(--color-border-subtle)" }}>
                  {/* unit_cost_zar is CENTS per base unit (PRD §7.0.2) — say so. */}
                  <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
                    Cost / {item.unit} (cents)
                  </span>
                  {editingId === lot.id ? (
                    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Cost per ${item.unit} in cents`}
                        value={draftCost}
                        autoFocus
                        onChange={(e) => setDraftCost(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveCost(lot.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="h-11 w-28 rounded-[var(--radius-btn)] border px-2 text-base focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]"
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
                        className="min-h-11 px-2 favo-cta disabled:opacity-50"
                        style={{ color: "var(--color-accent)" }}
                      >
                        {saving ? "…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="min-h-11 px-1 favo-small"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        ✕
                      </button>
                      {costError && (
                        <span role="alert" className="w-full text-right favo-caption" style={{ color: "var(--color-error)", textTransform: "none", letterSpacing: 0 }}>
                          {costError}
                        </span>
                      )}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftCost(lot.unitCostZar ?? "");
                        setCostError(null);
                        setEditingId(lot.id);
                      }}
                      aria-label={`Edit cost per ${item.unit} for this lot`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-btn)] px-2 favo-small hover:bg-[color:var(--color-porcelain-soft)]"
                      style={{ color: "var(--color-text-strong)" }}
                    >
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {lot.unitCostZar
                          ? `${lot.unitCostZar} c (${formatUnitCostRands(lot.unitCostZar)})`
                          : "—"}
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
