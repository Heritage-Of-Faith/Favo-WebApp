"use client";

// REQ-034: "the write-off is reversed and the payment attached". The import
// never does that — it cannot write payments.status. This button runs the
// tender chain's existing lookup (resolveTenderByLookup, §11.2 / §10.2.1
// writer 2): it asks Yoco about the order's sent attempts and records exactly
// what Yoco says. It never sends a payment (REQ-008).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveTenderByLookup } from "@/server/actions/tender";

export default function CheckWithYocoButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      const res = await resolveTenderByLookup(orderId);
      if (!res.ok) {
        toast.error(res.message);
      } else if (res.data.attempts.some((a) => a.status === "successful")) {
        toast.success("Yoco confirmed the payment. It is attached and the write-off is reversed.");
      } else {
        toast("Yoco did not confirm a payment for this order yet.");
      }
      router.refresh();
    } catch {
      toast.error("Couldn't reach the card system — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={check} disabled={busy}>
      {busy ? "Checking…" : "Check with Yoco"}
    </Button>
  );
}
