"use client";

// Stock-take runner — task A9 orchestrator.
// Walks the take's lots one at a time (StockTakeCounter), gates "Close take"
// behind full coverage (server also enforces), and shows the variance summary
// once closed.

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { recordStockTakeLine, closeStockTake, getStockTake } from "@/server/actions/stock-takes";
import StockTakeCounter from "@/components/admin/StockTakeCounter";
import VarianceSummary from "@/components/admin/VarianceSummary";
import { formatDate } from "@/lib/format";
import type { StockTake } from "@/lib/types";

export interface StockTakeRunnerProps {
  initialTake: StockTake;
}

export default function StockTakeRunner({ initialTake }: StockTakeRunnerProps) {
  const [take, setTake] = useState<StockTake>(initialTake);
  const [currentIdx, setCurrentIdx] = useState(() => {
    const firstUncounted = initialTake.lines.findIndex((l) => l.counted === null);
    return firstUncounted === -1 ? 0 : firstUncounted;
  });
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);

  const closed = take.completedAt !== null;
  const total = take.lines.length;
  const countedCount = useMemo(
    () => take.lines.filter((l) => l.counted !== null).length,
    [take.lines]
  );
  const allCounted = total > 0 && countedCount === total;

  function advance() {
    // Move to the next still-uncounted line, else the next index, else stay.
    const next = take.lines.findIndex((l, i) => i > currentIdx && l.counted === null);
    if (next !== -1) setCurrentIdx(next);
    else if (currentIdx + 1 < total) setCurrentIdx(currentIdx + 1);
  }

  async function handleSave(counted: number) {
    const line = take.lines[currentIdx];
    setSaving(true);
    const res = await recordStockTakeLine(take.id, line.inventoryLotId, counted);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setTake((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === currentIdx ? { ...l, counted } : l)),
    }));
    advance();
  }

  async function handleClose() {
    setClosing(true);
    const res = await closeStockTake(take.id);
    if (res.ok) {
      const refreshed = await getStockTake(take.id);
      if (refreshed.ok) setTake(refreshed.data.take);
      toast.success("Stock take closed.");
    } else {
      toast.error(res.message);
    }
    setClosing(false);
  }

  // ── Closed: read-only summary ───────────────────────────────────────────────
  if (closed) {
    return (
      <div className="mx-auto max-w-md space-y-5">
        <div>
          <h1 className="admin-page-title" style={{ color: "var(--color-text-strong)" }}>
            Take complete
          </h1>
          <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
            {take.kind} take · closed {take.completedAt ? formatDate(take.completedAt) : ""}
          </p>
        </div>
        <VarianceSummary take={take} />
        <Link
          href="/admin/stock-takes"
          className="inline-flex min-h-10 items-center rounded-[var(--radius-btn)] border px-4 favo-small"
          style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-strong)" }}
        >
          ← Back to stock takes
        </Link>
      </div>
    );
  }

  // ── In progress: walk lots ──────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div>
        <h1 className="admin-page-title" style={{ color: "var(--color-text-strong)" }}>
          {take.kind === "full" ? "Full" : "Spot"} stock take
        </h1>
        <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
          {countedCount} of {total} lots counted
        </p>
        {/* Progress bar */}
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)]"
          style={{ background: "var(--color-border-subtle)" }}
        >
          <div
            style={{
              width: `${total === 0 ? 0 : (countedCount / total) * 100}%`,
              height: "100%",
              background: "var(--color-success)",
              transition: "width var(--dur-base) var(--ease-out)",
            }}
          />
        </div>
      </div>

      {total > 0 && (
        <StockTakeCounter
          line={take.lines[currentIdx]}
          index={currentIdx}
          total={total}
          saving={saving}
          canBack={currentIdx > 0}
          onSave={handleSave}
          onSkip={advance}
          onBack={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
        />
      )}

      {allCounted && (
        <div className="mx-auto max-w-md space-y-3">
          <p className="favo-small" style={{ color: "var(--color-success)" }}>
            All lots counted. Review and close to apply corrective adjustments (T01).
          </p>
          <button
            type="button"
            onClick={handleClose}
            disabled={closing}
            className="min-h-12 w-full rounded-[var(--radius-btn)] favo-cta disabled:opacity-50"
            style={{ background: "var(--color-text-strong)", color: "var(--color-text-inverse)" }}
          >
            {closing ? "Closing…" : "Close take"}
          </button>
        </div>
      )}
    </div>
  );
}
