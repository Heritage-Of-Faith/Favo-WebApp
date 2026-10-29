"use client";

// The §6.0.5 write-off approval queue — AT-207 (REQ-035).
// Same shape as PendingApprovalsBanner: rendered in the admin shell, polls on
// mount, renders nothing when nothing is pending. One item per revenue day,
// listing every write-off with its value, reason and barista (daily_seq does
// not exist yet, so the order's time stands in for it). An Admin clears the
// day with their own PIN; until then the day's write-offs are `unapproved`.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { approveDayWriteOffs, listWriteOffApprovalQueue } from "@/server/actions/write-offs";
import { formatZar, formatDate } from "@/lib/format";
import type { QueueDay } from "@/server/close/write-offs";

export default function WriteOffApprovalsBanner() {
  const [days, setDays] = useState<QueueDay[]>([]);
  const [pins, setPins] = useState<Record<string, string>>({});
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(() => {
    listWriteOffApprovalQueue()
      .then((res) => {
        if (res.ok) setDays(res.data);
      })
      .catch(() => {
        /* non-fatal — banner just stays hidden */
      });
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function approve(day: string) {
    setApproving(day);
    try {
      const res = await approveDayWriteOffs(day, pins[day] ?? "");
      if (res.ok) {
        toast.success(`Write-offs for ${day} approved.`);
        setDays((prev) => prev.filter((d) => d.revenueDay !== day));
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Failed to approve the write-offs.");
    } finally {
      setPins((prev) => ({ ...prev, [day]: "" }));
      setApproving(null);
    }
  }

  if (days.length === 0) return null;

  return (
    <div
      role="status"
      className="mb-4 rounded-[var(--radius-card)] border p-3"
      style={{
        background: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
        borderColor: "color-mix(in srgb, var(--color-warning) 40%, transparent)",
      }}
    >
      {days.map((d) => (
        <div key={d.revenueDay} className="mb-2 last:mb-0">
          <p className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
            {d.count} write-off{d.count === 1 ? "" : "s"} unapproved for {d.revenueDay} · {formatZar(d.totalZar)}
          </p>
          <ul className="mt-1 space-y-1">
            {d.items.map((i) => (
              <li key={i.orderId} className="favo-caption" style={{ color: "var(--color-text-muted)", textTransform: "none", letterSpacing: 0 }}>
                {formatDate(i.placedAt)} · {formatZar(i.valueZar)} · {i.reason ?? "no reason recorded"} · {i.baristaName ?? i.staffId}
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void approve(d.revenueDay);
            }}
          >
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              aria-label={`Admin PIN to approve the write-offs of ${d.revenueDay}`}
              placeholder="Admin PIN"
              value={pins[d.revenueDay] ?? ""}
              onChange={(e) => setPins((prev) => ({ ...prev, [d.revenueDay]: e.target.value.replace(/\D/g, "") }))}
              className="min-h-9 w-28 rounded-[var(--radius-btn)] border px-2"
            />
            <button
              type="submit"
              disabled={approving === d.revenueDay || (pins[d.revenueDay] ?? "").length < 4}
              className="min-h-9 rounded-[var(--radius-btn)] px-3 favo-cta disabled:opacity-50"
              style={{ background: "var(--color-warning)", color: "var(--color-text-inverse)" }}
            >
              {approving === d.revenueDay ? "…" : "Approve"}
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
