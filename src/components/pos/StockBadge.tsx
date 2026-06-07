"use client";

/**
 * StockBadge — task M9.
 * Thin wrapper over the shared N8 StatusBadge mapping a POS stock state to
 * the right variant. Renders nothing when stock is "ok" (no visual noise).
 */

import StatusBadge from "@/components/shared/StatusBadge";
import type { StockState } from "@/hooks/useStockStatus";

export type Props = { state: StockState };

export default function StockBadge({ state }: Props) {
  if (state === "ok") return null;
  return <StatusBadge variant={state} dot={false} />;
}
