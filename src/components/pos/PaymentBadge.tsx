import { CheckCircle } from "lucide-react";
import type { PaymentStatus } from "@/lib/types";

export type PaymentBadgeKind = "free" | "paid" | "pending";

/** Free = net R0; Paid only when the payments row is successful (or confirmed in person); else Pending. */
export function paymentBadgeKind(totalZar: number, paymentStatus: PaymentStatus | null, paidLocally = false): PaymentBadgeKind {
  if (totalZar === 0) return "free";
  if (paymentStatus === "successful" || paidLocally) return "paid";
  return "pending";
}

export default function PaymentBadge({ kind }: { kind: PaymentBadgeKind }) {
  if (kind === "paid") {
    return (
      <span data-testid="payment-badge" data-kind="paid" className="favo-caption rounded-[999px] px-2 py-0.5 flex items-center gap-1"
        style={{ background: "color-mix(in srgb, var(--color-success) 16%, transparent)", color: "var(--color-success)" }}>
        <CheckCircle size={10} strokeWidth={2.5} /> Paid
      </span>
    );
  }
  if (kind === "free") {
    return (
      <span data-testid="payment-badge" data-kind="free" className="favo-caption rounded-[999px] px-2 py-0.5 bg-cool-steel/15 text-cool-steel">
        Free
      </span>
    );
  }
  return (
    <span data-testid="payment-badge" data-kind="pending" className="favo-caption rounded-[999px] px-2 py-0.5"
      style={{ background: "color-mix(in srgb, var(--color-warning) 16%, transparent)", color: "var(--color-warning)" }}>
      Pending
    </span>
  );
}
