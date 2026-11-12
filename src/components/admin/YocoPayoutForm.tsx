"use client";

// REQ-120: the Admin types Yoco's payout for the day and one card machine.
// FAVO checks it against Σ (charged − fee) over that machine's settled card
// payments and keeps the figure on an audit row — never as a payment.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recordYocoPayout } from "@/server/actions/reconciliation";

export default function YocoPayoutForm({ revenueDay, defaultDeviceId }: { revenueDay: string; defaultDeviceId: string | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [device, setDevice] = useState(defaultDeviceId ?? "");
  const [busy, setBusy] = useState(false);
  const ready = amount.trim() !== "" && device.trim() !== "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const res = await recordYocoPayout(revenueDay, device, amount);
      if (res.ok) {
        toast.success("Payout recorded.");
        setAmount("");
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
      <label className="sr-only" htmlFor="payout-amount">Yoco payout in rands</label>
      <input
        id="payout-amount"
        inputMode="decimal"
        className="min-h-11 w-36 rounded border border-border-subtle bg-surface px-3 py-2 text-base"
        placeholder="R 0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <label className="sr-only" htmlFor="payout-device">Card machine (device id)</label>
      <input
        id="payout-device"
        className="min-h-11 rounded border border-border-subtle bg-surface px-3 py-2 text-base"
        placeholder="Device id"
        value={device}
        onChange={(e) => setDevice(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" disabled={busy || !ready}>
        {busy ? "Checking…" : "Check payout"}
      </Button>
    </form>
  );
}
