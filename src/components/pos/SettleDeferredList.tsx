"use client";

/**
 * SettleDeferredList — PRD v7.0 §6.0.4 T3 steps 3a/3b, §6.7 paths A and B.
 *
 * "Barista | Settling | The unpaid list, oldest first, with the amount. On
 * success the order leaves the list. On ALREADY_RESOLVED: 'Already paid — do
 * not charge again', naming who settled it and when."
 *
 * Per order:
 *   • Settle with a slip reference — path B: the standalone machine's
 *     reference (at least 4 characters), settleDeferredOrder(id, ref).
 *   • Take card payment — path A: settleDeferredOrder(id) queries Yoco first
 *     and only then begins a NEW attempt, which the existing TenderPanel sends
 *     and polls. With no machine linked it shows the server's message.
 *
 * Copy not in the PRD (invented, listed in the report): the page heading, the
 * two button labels, the reference field label, "Settle", "No unpaid orders.",
 * "settled by … at …".
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import { listOpenDeferredOrders, settleDeferredOrder } from "@/server/actions/deferred";
import type { UnpaidOrderRow } from "@/server/deferred/unpaid";
import TenderPanel from "@/components/pos/TenderPanel";
import { formatZar } from "@/lib/format";

type Busy = { orderId: string; mode: "slip" | "card" } | null;
type Card = { orderId: string; attempt: number; amountZar: number } | null;

export default function SettleDeferredList() {
  const router = useRouter();
  const [rows, setRows] = useState<UnpaidOrderRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [slipFor, setSlipFor] = useState<string | null>(null);
  const [slip, setSlip] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [card, setCard] = useState<Card>(null);
  const [message, setMessage] = useState<{ orderId: string; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await listOpenDeferredOrders().catch(() => null);
    if (r && r.ok) setRows(r.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function refusal(orderId: string, r: { message: string; settledAt?: string; settledBy?: string | null }) {
    const who = r.settledAt
      ? ` — settled${r.settledBy ? ` by ${r.settledBy}` : ""} at ${new Date(r.settledAt).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" })}`
      : "";
    setMessage({ orderId, text: `${r.message}${who}` });
  }

  async function settleWithSlip(orderId: string) {
    if (busy) return;
    setBusy({ orderId, mode: "slip" });
    setMessage(null);
    const r = await settleDeferredOrder(orderId, slip).catch(() => null);
    setBusy(null);
    if (!r) return setMessage({ orderId, text: "Couldn't reach FAVO — try again." });
    if (!r.ok) return refusal(orderId, r);
    setSlipFor(null);
    setSlip("");
    await load();
  }

  async function takeCard(orderId: string) {
    if (busy) return;
    setBusy({ orderId, mode: "card" });
    setMessage(null);
    const r = await settleDeferredOrder(orderId).catch(() => null);
    setBusy(null);
    if (!r) return setMessage({ orderId, text: "Couldn't reach FAVO — try again." });
    if (!r.ok) return refusal(orderId, r);
    if (r.data.path === "card") setCard({ orderId, attempt: r.data.attempt, amountZar: r.data.amountZar });
  }

  return (
    <main className="min-h-screen bg-dark-teal">
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
          <h1 className="favo-h3 text-porcelain">Unpaid orders</h1>
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

      <div className="flex flex-col gap-3 p-6">
        {rows && rows.length === 0 && <p className="favo-small text-cool-steel">No unpaid orders.</p>}
        {rows?.map((o) => (
          <section key={o.orderId} className="rounded-[4px] border border-cool-steel/30 p-4 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="favo-label text-porcelain" title={o.orderId}>Order {o.orderRef}</span>
              <span className="favo-small text-cool-steel">{o.ageMinutes} min</span>
              <span className="favo-h3 text-porcelain">{formatZar(o.valueZar)}</span>
            </div>

            {card?.orderId === o.orderId ? (
              <TenderPanel
                key={`${o.orderId}:${card.attempt}`}
                orderId={o.orderId}
                amountZar={card.amountZar}
                attempt={card.attempt}
                onPaid={() => { setCard(null); void load(); }}
                onUnresolved={() => { setCard(null); void load(); }}
              />
            ) : slipFor === o.orderId ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="favo-small text-cool-steel flex flex-col gap-1 flex-1 min-w-[200px]">
                  Reference on the machine&apos;s slip
                  <input
                    value={slip}
                    onChange={(e) => setSlip(e.target.value)}
                    maxLength={100}
                    autoFocus
                    className="rounded-[4px] border border-cool-steel/30 bg-transparent px-3 min-h-[44px] text-porcelain"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => settleWithSlip(o.orderId)}
                  disabled={busy !== null || slip.replace(/\s/g, "").length < 4}
                  className="favo-small rounded-[4px] border border-cool-steel/30 px-3 min-h-[44px] text-porcelain disabled:opacity-50"
                >
                  {busy?.orderId === o.orderId && busy.mode === "slip" ? "Settling…" : "Settle"}
                </button>
                <button
                  type="button"
                  onClick={() => { setSlipFor(null); setSlip(""); }}
                  className="favo-small rounded-[4px] px-3 min-h-[44px] text-cool-steel"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setSlipFor(o.orderId); setSlip(""); setMessage(null); }}
                  disabled={busy !== null}
                  className="favo-small rounded-[4px] border border-cool-steel/30 px-3 min-h-[44px] text-porcelain disabled:opacity-50"
                >
                  Settle with a slip reference
                </button>
                <button
                  type="button"
                  onClick={() => takeCard(o.orderId)}
                  disabled={busy !== null}
                  className="favo-small rounded-[4px] border border-cool-steel/30 px-3 min-h-[44px] text-porcelain disabled:opacity-50"
                >
                  {busy?.orderId === o.orderId && busy.mode === "card" ? "Checking…" : "Take card payment"}
                </button>
              </div>
            )}

            {message?.orderId === o.orderId && (
              <p role="alert" className="favo-small text-[var(--color-error)]">{message.text}</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
