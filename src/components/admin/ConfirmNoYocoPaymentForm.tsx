"use client";

// REQ-034: an `unresolved_at_close` write-off closes on T10 only when an Admin
// confirms, with a reason, that Yoco holds no payment for it. Never closed by a
// missing row in an uploaded file.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmNoYocoPayment } from "@/server/actions/reconciliation";

export default function ConfirmNoYocoPaymentForm({ orderId, revenueDay }: { orderId: string; revenueDay: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const res = await confirmNoYocoPayment(orderId, revenueDay, reason);
      if (res.ok) {
        toast.success("Recorded: Yoco holds no payment for this order.");
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
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`confirm-${orderId}`}>
        How you confirmed Yoco has no payment
      </label>
      <input
        id={`confirm-${orderId}`}
        className="min-h-11 rounded border border-border-subtle bg-surface px-3 py-2 text-base"
        placeholder="How you checked (e.g. Yoco portal, no sale)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" disabled={busy || !ready}>
        {busy ? "Saving…" : "Confirm no payment"}
      </Button>
    </form>
  );
}
