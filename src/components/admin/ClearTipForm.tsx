"use client";

// DEC-17 / REQ-120: an Admin clears a tip variance on T10 with a reason. The
// review is recorded first; only then is the payment's withheld fee and receipt
// written. The tip itself is never stored.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearTipVariance } from "@/server/actions/reconciliation";

export default function ClearTipForm({ paymentId, revenueDay }: { paymentId: string; revenueDay: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const res = await clearTipVariance(paymentId, revenueDay, reason);
      if (res.ok) {
        toast.success(res.data.written ? "Tip cleared. The payment's fee is now recorded." : "Tip cleared. The payment already held its fee.");
        setReason("");
        router.refresh();
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Couldn't record that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-1 flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`clear-tip-${paymentId}`}>
        What you checked about this tip
      </label>
      <input
        id={`clear-tip-${paymentId}`}
        className="min-h-11 rounded border border-border-subtle bg-surface px-3 py-2 text-base"
        placeholder="What you checked"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" disabled={busy || !ready}>
        {busy ? "Saving…" : "Clear tip"}
      </Button>
    </form>
  );
}
