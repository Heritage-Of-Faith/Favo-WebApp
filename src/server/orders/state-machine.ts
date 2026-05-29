import type { OrderState } from "@/lib/types";

// Valid state transitions — docs/API.md → transitionOrder
const TRANSITIONS: Record<OrderState, OrderState[]> = {
  ordered: ["in_progress", "cancelled"],
  in_progress: ["ready"],
  ready: ["collected"],
  collected: [],
  cancelled: [],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: OrderState, to: OrderState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
}
