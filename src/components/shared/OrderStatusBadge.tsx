import type { OrderState } from "@/lib/types";
import { cn } from "@/lib/cn";

export type Props = { state: OrderState };

const STATE_STYLES: Record<OrderState, string> = {
  ordered: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  collected: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-700",
};

const STATE_LABELS: Record<OrderState, string> = {
  ordered: "Ordered",
  in_progress: "In Progress",
  ready: "Ready",
  collected: "Collected",
  cancelled: "Cancelled",
};

export default function OrderStatusBadge({ state }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATE_STYLES[state]
      )}
    >
      {STATE_LABELS[state]}
    </span>
  );
}
