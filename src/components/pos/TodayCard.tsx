"use client";

/**
 * TodayCard — task M12.
 * Barista-readable view of today's volume: order count, revenue, waste events.
 * Big numbers, no charts. Pull-to-refresh via the refresh button.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import { getPosToday } from "@/server/actions/pos-summary";
import { formatZar } from "@/lib/format";
import type { PosTodaySummary } from "@/lib/types";

export default function TodayCard() {
  const router = useRouter();
  const [data, setData] = useState<PosTodaySummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getPosToday();
    if (r.ok) setData(r.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="min-h-screen bg-dark-teal">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cool-steel/20 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/pos/queue")}
            aria-label="Back to POS"
            className="flex h-11 w-11 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain"
          >
            <ArrowLeft size={18} strokeWidth={2} />
          </button>
          <h1 className="favo-h3 text-porcelain">Today</h1>
        </div>
        <button
          type="button"
          onClick={load}
          aria-label="Refresh"
          className="flex h-11 w-11 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain"
        >
          {loading ? <Loader2 size={16} strokeWidth={2} className="animate-spin" /> : <RefreshCw size={16} strokeWidth={2} />}
        </button>
      </div>

      {/* Big numbers */}
      <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-3">
        <Metric label="Orders" value={data ? String(data.orderCount) : "—"} />
        <Metric label="Revenue" value={data ? formatZar(data.revenueZar) : "—"} />
        <Metric label="Waste events" value={data ? String(data.wasteCount) : "—"} />
      </div>

      {data && (
        <p className="px-6 favo-small text-cool-steel">For {data.date} · Africa/Johannesburg</p>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[2px] border border-cool-steel/20 bg-porcelain/5 p-6 text-center">
      <p className="favo-label text-cool-steel mb-2">{label}</p>
      <p
        className="text-porcelain"
        style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 44, letterSpacing: "0.02em", lineHeight: 1 }}
      >
        {value}
      </p>
    </div>
  );
}
