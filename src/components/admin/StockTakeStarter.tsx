"use client";

// Start-take controls — task A9.
// Kicks off a new stock take (full or spot) and routes to its walk-lots page.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { runStockTake } from "@/server/actions/stock-takes";
import type { StockTakeKind } from "@/lib/types";

export default function StockTakeStarter() {
  const router = useRouter();
  const [starting, setStarting] = useState<StockTakeKind | null>(null);

  async function start(kind: StockTakeKind) {
    setStarting(kind);
    const res = await runStockTake(kind);
    if (res.ok) {
      router.push(`/admin/stock-takes/${res.data.stockTakeId}`);
    } else {
      toast.error(res.message);
      setStarting(null);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => start("full")}
        disabled={starting !== null}
        className="min-h-10 rounded-[var(--radius-btn)] px-4 favo-cta disabled:opacity-50"
        style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)" }}
      >
        {starting === "full" ? "Starting…" : "Start full take"}
      </button>
      <button
        type="button"
        onClick={() => start("spot")}
        disabled={starting !== null}
        className="min-h-10 rounded-[var(--radius-btn)] border px-4 favo-small disabled:opacity-50"
        style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-strong)" }}
      >
        {starting === "spot" ? "Starting…" : "Spot take"}
      </button>
    </div>
  );
}
