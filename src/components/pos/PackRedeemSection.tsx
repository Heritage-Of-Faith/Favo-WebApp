"use client";

/**
 * PackRedeemSection — AT-116 (pack redemption POS UI).
 *
 * Shown in the payment panel after an order is placed. Fetches the order's
 * line items and the customer's active packs, then shows a "Use pack" button
 * for each coffee line that has a matching pack available. Each redemption
 * calls redeemPack and fires onRedeemed with the order line's unit price
 * (so POSWorkspace can reduce amountDueZar).
 *
 * Rules: L16 — packs only cover coffee items, one redemption per line,
 * FIFO pack selection is done server-side.
 */

import { useEffect, useState, useCallback } from "react";
import { Package, Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { getCustomerActivePacks } from "@/server/actions/packs";
import { getOrderItems } from "@/server/actions/orders";
import { redeemPack } from "@/server/actions/packs";
import { formatZar } from "@/lib/format";

type OrderLine = {
  id: string;
  menuItemId: string;
  menuItemName: string;
  unitPriceZar: number;
};

type Props = {
  customerId: string;
  orderId: string;
  onRedeemed: (lineId: string, unitPriceZar: number) => void;
};

export default function PackRedeemSection({ customerId, orderId, onRedeemed }: Props) {
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [packMenuItemIds, setPackMenuItemIds] = useState<Set<string>>(new Set());
  const [redeemedLines, setRedeemedLines] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState<string | null>(null); // lineId being redeemed
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [itemsRes, packsRes] = await Promise.all([
        getOrderItems(orderId),
        getCustomerActivePacks(customerId),
      ]);
      if (cancelled) return;
      if (itemsRes.ok) setLines(itemsRes.data);
      if (packsRes.ok) setPackMenuItemIds(new Set(packsRes.data.map((p) => p.menuItemId)));
      setLoading(false);
    }
    load().catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [orderId, customerId]);

  const handleRedeem = useCallback(async (line: OrderLine) => {
    if (submitting) return;
    setSubmitting(line.id);
    const r = await redeemPack(customerId, orderId, line.id).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not redeem pack.",
    }));
    setSubmitting(null);
    if (r.ok) {
      toast.success(`Pack used for ${line.menuItemName} — ${formatZar(line.unitPriceZar)} off`);
      setRedeemedLines((prev) => new Set([...prev, line.id]));
      onRedeemed(line.id, line.unitPriceZar);
    } else {
      toast.error(r.message);
    }
  }, [submitting, customerId, orderId, onRedeemed]);

  // Redeemable lines: coffee category is verified server-side; here we filter
  // by whether the customer has an active pack for that menu item.
  const redeemableLines = lines.filter(
    (l) => packMenuItemIds.has(l.menuItemId) && !redeemedLines.has(l.id)
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1 favo-caption text-cool-steel">
        <Loader2 size={12} strokeWidth={2} className="animate-spin" />
        <span>Checking packs…</span>
      </div>
    );
  }

  if (redeemableLines.length === 0 && redeemedLines.size === 0) return null;

  return (
    <div className="flex flex-col gap-2 w-full">
      {redeemedLines.size > 0 && (
        <div className="flex items-center gap-1.5 favo-caption text-[var(--color-success)]">
          <CheckCircle size={12} strokeWidth={2.5} />
          <span>{redeemedLines.size} pack redemption{redeemedLines.size > 1 ? "s" : ""} applied</span>
        </div>
      )}
      {redeemableLines.map((line) => (
        <button
          key={line.id}
          type="button"
          disabled={submitting === line.id}
          onClick={() => handleRedeem(line)}
          className="flex w-full items-center justify-between gap-2 rounded-[4px] border border-cool-steel/30 px-3 py-2.5 min-h-[44px] favo-small text-cool-steel hover:bg-coffee-bean/8 transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
        >
          <div className="flex items-center gap-2">
            <Package size={13} strokeWidth={2.25} />
            <span>Use pack — {line.menuItemName}</span>
          </div>
          {submitting === line.id
            ? <Loader2 size={13} strokeWidth={2} className="animate-spin shrink-0" />
            : <span className="favo-caption text-cool-steel shrink-0">{formatZar(line.unitPriceZar)} off</span>
          }
        </button>
      ))}
    </div>
  );
}
