"use client";

// REQ-120: an open payout difference closes only when an Admin records what
// explains it, with a reason. No tip figure is asked for or kept (DEC-17).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmPayoutVariance } from "@/server/actions/reconciliation";

export default function ConfirmPayoutVarianceForm({ revenueDay, deviceId }: { revenueDay: string; deviceId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const res = await confirmPayoutVariance(revenueDay, deviceId, reason);
      if (res.ok) {
        toast.success("Recorded: the payout difference is explained.");
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
      <label className="sr-only" htmlFor={`confirm-payout-${deviceId}`}>
        What explains this payout difference
      </label>
      <input
        id={`confirm-payout-${deviceId}`}
        className="min-h-11 rounded border border-border-subtle bg-surface px-3 py-2 text-base"
        placeholder="What explains the difference"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" disabled={busy || !ready}>
        {busy ? "Saving…" : "Confirm difference"}
      </Button>
    </form>
  );
}
