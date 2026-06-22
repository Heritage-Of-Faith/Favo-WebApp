// OrderHistoryList — owner: Nikao (task N13, AT-65)
// Presentational + server-safe. Renders the customer's recent orders read-only.
// Money via formatZar; times in SAST via formatDate (L05 read-only surface).

import type { CSSProperties } from "react";
import { formatZar, formatDate } from "@/lib/format";
import type { CustomerOrder } from "@/lib/customer/contract";
import type { OrderState } from "@/lib/types";

export interface OrderHistoryListProps {
  orders: CustomerOrder[];
}

/** Friendly, customer-facing labels for each order state. */
const STATE_LABEL: Record<string, string> = {
  ordered: "Ordered",
  in_progress: "Being made",
  ready: "Ready for collection",
  collected: "Collected",
  completed: "Completed",
  cancelled: "Cancelled",
};

function stateLabel(state: OrderState): string {
  return STATE_LABEL[state] ?? String(state);
}

const sectionLabel: CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontWeight: 300,
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--color-cool-steel)",
  margin: "0 0 12px",
};

export default function OrderHistoryList({ orders }: OrderHistoryListProps) {
  if (orders.length === 0) {
    return (
      <section aria-label="Order history">
        <p style={sectionLabel}>Recent orders</p>
        <div
          style={{
            backgroundColor: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(247,246,242,0.12)",
            borderRadius: 2,
            padding: 24,
          }}
        >
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 400,
              fontSize: 15,
              lineHeight: 1.7,
              color: "var(--color-porcelain)",
              opacity: 0.75,
              margin: 0,
            }}
          >
            Your first order is on us — say hi at the counter!
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Order history">
      <p style={sectionLabel}>Recent orders</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {orders.map((order) => {
          const itemSummary = order.items
            .map((i) => `${i.quantity}× ${i.menuItemName}`)
            .join(", ");
          return (
            <li
              key={order.id}
              style={{
                backgroundColor: "rgba(28,5,1,0.05)",
                border: "1px solid rgba(28,5,1,0.12)",
                borderRadius: 2,
                padding: "16px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <span
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 700,
                    fontSize: 13,
                    color: "var(--color-porcelain)",
                  }}
                >
                  {formatDate(order.placedAt)}
                </span>
                <span
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 700,
                    fontSize: 15,
                    color: "var(--color-porcelain)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatZar(order.totalZar)}
                </span>
              </div>
              {itemSummary && (
                <span
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 400,
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: "var(--color-porcelain)",
                    opacity: 0.7,
                  }}
                >
                  {itemSummary}
                </span>
              )}
              <span
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 400,
                  fontSize: 11,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--color-cool-steel)",
                }}
              >
                {stateLabel(order.state)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
