"use client";

// Stock-take counter — task A9.
// One lot's count step in the walk-lots flow. Mobile-friendly: a large numeric
// input the admin taps on a phone. Save advances; skip/back navigate.
// Shows lot context (supplier, received date, roast date) so the user knows
// which physical container to count.

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import type { StockTakeLine } from "@/lib/types";

export interface StockTakeCounterProps {
  line: StockTakeLine;
  index: number;
  total: number;
  saving: boolean;
  canBack: boolean;
  onSave: (counted: number) => void;
  onSkip: () => void;
  onBack: () => void;
}

export default function StockTakeCounter({
  line,
  index,
  total,
  saving,
  canBack,
  onSave,
  onSkip,
  onBack,
}: StockTakeCounterProps) {
  const [draft, setDraft] = useState(line.counted !== null ? String(line.counted) : "");

  // Reset the field when navigating to a different line.
  useEffect(() => {
    setDraft(line.counted !== null ? String(line.counted) : "");
  }, [line.id, line.counted]);

  const n = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(n) && n >= 0;
  const unitLabel = line.unit ?? "units";
  const isBean = line.itemKind === "bean"; // InventoryKind uses "bean" (singular)

  return (
    <div
      className="mx-auto flex max-w-md flex-col gap-5 rounded-[var(--radius-card)] border p-5"
      style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
    >
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
          Lot {index + 1} of {total}
        </span>
        {line.counted !== null && (
          <span className="favo-caption" style={{ color: "var(--color-success)" }}>
            counted
          </span>
        )}
      </div>

      {/* Item name + lot context */}
      <div className="space-y-1 text-center">
        <h2 className="admin-section-title" style={{ color: "var(--color-text-strong)" }}>
          {line.inventoryItemName}
        </h2>
        {/* Lot context: helps user identify the physical container */}
        <div className="flex flex-col gap-0.5">
          {line.lotSourceName && (
            <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
              {line.lotSourceName}
            </p>
          )}
          {line.lotReceivedAt && (
            <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
              Received {formatDate(line.lotReceivedAt)}
            </p>
          )}
          {isBean && line.roastDate && (
            <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
              Roasted {formatDate(line.roastDate)}
            </p>
          )}
        </div>
        <p className="favo-small mt-1" style={{ color: "var(--color-text-muted)" }}>
          System expects:{" "}
          <span style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
            {line.expected} {unitLabel}
          </span>
        </p>
      </div>

      {/* Large tap-friendly input */}
      <label className="block">
        <span className="favo-label">Counted ({unitLabel})</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={draft}
          autoFocus
          aria-label={`Counted quantity in ${unitLabel}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) onSave(n);
          }}
          className="mt-1 w-full rounded-[var(--radius-btn)] border px-3 text-center focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]"
          style={{
            height: 72,
            fontFamily: "var(--font-display)",
            fontSize: "2rem",
            fontWeight: 700,
            background: "var(--color-surface)",
            color: "var(--color-text-strong)",
            borderColor: "var(--color-border-subtle)",
            fontVariantNumeric: "tabular-nums",
          }}
        />
        <p className="mt-1.5 text-center favo-caption" style={{ color: "var(--color-text-muted)" }}>
          Enter the quantity you physically measured on the shelf
        </p>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={!canBack || saving}
          className="min-h-12 rounded-[var(--radius-btn)] border px-4 favo-small disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-strong)" }}
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={saving}
          title="Skip this lot — it will remain uncounted for now"
          className="min-h-12 px-4 favo-small disabled:opacity-40"
          style={{ color: "var(--color-text-muted)" }}
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => valid && onSave(n)}
          disabled={!valid || saving}
          className="ml-auto min-h-12 flex-1 rounded-[var(--radius-btn)] px-4 favo-cta disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)" }}
        >
          {saving ? "Saving…" : index + 1 === total ? "Save" : "Save & next"}
        </button>
      </div>
    </div>
  );
}
