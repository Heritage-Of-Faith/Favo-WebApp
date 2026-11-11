"use client";

/**
 * TodayCard — task M12, extended by REQ-128 (PRD §7.5).
 * The barista's Day summary: orders, drinks, gross, fee, net, write-offs,
 * comps, entitlement cups and walk-in cups (plus waste events). It is a READ:
 * nothing is confirmed and no tap ends the day — the only button is Refresh.
 * Fee and net read UNAVAILABLE, "settles overnight", until the fee import has
 * run — never R0.00 (REQ-129). A day with no orders shows zeroes.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import { getPosToday } from "@/server/actions/pos-summary";
import { formatZar } from "@/lib/format";
import { UNAVAILABLE, NET_TONE_COLOR } from "@/lib/cost-state";
import { SETTLES_OVERNIGHT } from "@/lib/pos-today";
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

  const count = (n: number | undefined) => (data ? String(n ?? 0) : "—");
  const zar = (n: number | undefined) => (data ? formatZar(n ?? 0) : "—");

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
        <Metric label="Orders" value={count(data?.orderCount)} />
        <Metric label="Drinks" value={count(data?.drinks)} />
        <Metric label="Gross" value={zar(data?.revenueZar)} />
        <FeeMetric label="Card fees" data={data} value={data?.feeZar} />
        <FeeMetric label="Net settled" data={data} value={data?.netSettledZar} />
        <Metric label="Written off" value={zar(data?.writtenOffZar)} />
        <Metric label="Comps" value={zar(data?.compsZar)} />
        <Metric label="Entitlement cups" value={count(data?.entitlementCups)} />
        <Metric label="Walk-in cups" value={count(data?.walkInCups)} />
        <Metric label="Waste events" value={count(data?.wasteCount)} />
        {/* §7.5 "Deferred: open · settled · written off" (REQ-133). */}
        <Metric
          label="Deferred: open · settled · written off"
          value={data ? `${zar(data.deferredOpenZar)} · ${zar(data.deferredSettledZar)} · ${zar(data.deferredWrittenOffZar)}` : "—"}
        />
      </div>

      {data && (
        <p className="px-6 favo-small text-cool-steel">For {data.date} · Africa/Johannesburg</p>
      )}
    </main>
  );
}

/** REQ-108 / REQ-129: NULL is UNAVAILABLE with "settles overnight" — never blank, never R0.00. */
function FeeMetric({ label, data, value }: { label: string; data: PosTodaySummary | null; value: number | null | undefined }) {
  if (!data) return <Metric label={label} value="—" />;
  if (value === null || value === undefined) {
    return <Metric label={label} value={UNAVAILABLE} note={SETTLES_OVERNIGHT} color={NET_TONE_COLOR.unavailable} />;
  }
  return <Metric label={label} value={formatZar(value)} />;
}

function Metric({ label, value, note, color }: { label: string; value: string; note?: string; color?: string }) {
  return (
    <div className="rounded-[2px] border border-cool-steel/20 bg-porcelain/5 p-6 text-center">
      <p className="favo-label text-cool-steel mb-2">{label}</p>
      <p
        className="text-porcelain"
        style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: note ? 28 : 44, letterSpacing: "0.02em", lineHeight: 1, ...(color ? { color } : {}) }}
      >
        {value}
      </p>
      {note && <p className="favo-small text-cool-steel mt-2">{note}</p>}
    </div>
  );
}
