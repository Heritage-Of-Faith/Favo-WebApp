"use client";

/**
 * DailyHistory — AT-146 (wireframe screen 4).
 * Barista-readable per-item "what was made" list for the last 7 SAST days,
 * newest first. Counts only — no revenue, no charts, no filters. Every active
 * menu item is always listed (zeros included) so the short list stays
 * scannable day-to-day.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import { getDailyItemHistory, type DailyHistoryDay } from "@/server/actions/pos-summary";

const DAY_LABEL = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  weekday: "short",
  day: "numeric",
  month: "short",
});

function headingFor(day: DailyHistoryDay, index: number): string {
  const pretty = DAY_LABEL.format(new Date(`${day.date}T12:00:00+02:00`));
  const prefix = index === 0 ? "Today" : index === 1 ? "Yesterday" : pretty;
  const suffix = index <= 1 ? ` — ${pretty}` : "";
  return `${prefix}${suffix} · ${day.totalItems} item${day.totalItems === 1 ? "" : "s"} made`;
}

export default function DailyHistory() {
  const router = useRouter();
  const [days, setDays] = useState<DailyHistoryDay[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getDailyItemHistory(7);
    if (r.ok) setDays(r.data.days);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Bar widths are relative to the busiest item across the whole span so days
  // are visually comparable with each other, not just within themselves.
  const maxQty = Math.max(1, ...(days ?? []).flatMap(d => d.items.map(i => i.quantity)));

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
          <h1 className="favo-h3 text-porcelain">Order history</h1>
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

      {/* NB: the project theme redefines Tailwind's container scale, so named
          max-w-* utilities are tiny here — use an arbitrary value like the
          rest of the codebase. */}
      <div className="mx-auto w-full max-w-[640px] p-6 flex flex-col gap-8">
        {days === null ? (
          <p className="favo-small text-cool-steel">{loading ? "Loading…" : "Could not load history."}</p>
        ) : (
          days.map((day, index) => (
            <section key={day.date} aria-label={headingFor(day, index)}>
              <h2 className="favo-h3 text-porcelain mb-3">{headingFor(day, index)}</h2>
              <ul className="flex flex-col gap-2">
                {day.items.map((item) => (
                  <li key={item.menuItemId} className="flex items-center gap-3">
                    <span className="favo-small text-porcelain w-32 shrink-0">{item.name}</span>
                    <span
                      aria-hidden
                      className="h-3 rounded-[2px] bg-crimson-carrot/80"
                      style={{ width: `${(item.quantity / maxQty) * 100}%`, minWidth: item.quantity > 0 ? 6 : 0 }}
                    />
                    <span className="favo-small text-cool-steel tabular-nums">{item.quantity}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
