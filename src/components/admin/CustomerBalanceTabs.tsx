"use client";

// CustomerBalanceTabs — owner: Mia (AT-79, A17)
// Tabbed view of a customer's Orders · Loyalty · Wallet · Packs.
// All data is passed as props from the server component — tab switching is instant, no fetching.
// Read-only: no mutation buttons or forms (L06, L16 are barista-only flows).

import { useState } from "react";
import { formatZar, formatDate } from "@/lib/format";
import type {
  LoyaltyTxnRow,
  WalletTxnRow,
  AdminPackRow,
  AdminOrderRow,
} from "@/server/actions/customers";

type Tab = "orders" | "loyalty" | "wallet" | "packs";

const TABS: { key: Tab; label: string }[] = [
  { key: "orders", label: "Orders" },
  { key: "loyalty", label: "Loyalty" },
  { key: "wallet", label: "Wallet" },
  { key: "packs", label: "Packs" },
];

const LOYALTY_KIND: Record<string, string> = {
  earn: "Earned",
  redeem: "Redeemed",
  adjustment: "Adjustment",
};

const WALLET_KIND: Record<string, string> = {
  topup: "Top-up",
  spend: "Spend",
  refund: "Refund",
  adjustment: "Adjustment",
};

const ORDER_STATE: Record<string, string> = {
  ordered: "Ordered",
  in_progress: "In progress",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

export interface CustomerBalanceTabsProps {
  loyaltyTxns: LoyaltyTxnRow[];
  walletTxns: WalletTxnRow[];
  activePacks: AdminPackRow[];
  expiredPacks: AdminPackRow[];
  recentOrders: AdminOrderRow[];
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-text-muted">{text}</p>;
}

export default function CustomerBalanceTabs({
  loyaltyTxns,
  walletTxns,
  activePacks,
  expiredPacks,
  recentOrders,
}: CustomerBalanceTabsProps) {
  const [active, setActive] = useState<Tab>("orders");

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div
        role="tablist"
        className="flex gap-1 border-b border-border-subtle"
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={active === key}
            onClick={() => setActive(key)}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors",
              active === key
                ? "border-b-2 border-text-strong text-text-strong -mb-px"
                : "text-text-muted hover:text-text-strong",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Orders */}
      {active === "orders" && (
        <div role="tabpanel" aria-label="Orders">
          {recentOrders.length === 0 ? (
            <EmptyState text="No orders yet." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-elevated">
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">Order ID</th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">State</th>
                    <th className="px-4 py-2.5 text-right font-medium text-text-muted">Total</th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((o) => (
                    <tr key={o.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
                        {o.id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-2.5 text-text-strong">
                        {ORDER_STATE[o.state] ?? o.state}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatZar(o.totalZar)}
                      </td>
                      <td className="px-4 py-2.5 text-text-muted">{formatDate(o.placedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Loyalty */}
      {active === "loyalty" && (
        <div role="tabpanel" aria-label="Loyalty">
          {loyaltyTxns.length === 0 ? (
            <EmptyState text="No loyalty transactions." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-elevated">
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">Type</th>
                    <th className="px-4 py-2.5 text-right font-medium text-text-muted">Points</th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {loyaltyTxns.map((t) => (
                    <tr key={t.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-2.5 text-text-strong">
                        {LOYALTY_KIND[t.kind] ?? t.kind}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {t.delta > 0 ? `+${t.delta}` : t.delta}
                      </td>
                      <td className="px-4 py-2.5 text-text-muted">{formatDate(t.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Wallet */}
      {active === "wallet" && (
        <div role="tabpanel" aria-label="Wallet">
          {walletTxns.length === 0 ? (
            <EmptyState text="No wallet transactions." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-elevated">
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">Type</th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">Description</th>
                    <th className="px-4 py-2.5 text-right font-medium text-text-muted">Amount</th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {walletTxns.map((t) => (
                    <tr key={t.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-2.5 text-xs uppercase tracking-wider text-text-muted">
                        {WALLET_KIND[t.kind] ?? t.kind}
                      </td>
                      <td className="px-4 py-2.5 text-text-strong">
                        {t.description ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {t.deltaZar >= 0 ? "+" : ""}
                        {formatZar(Math.abs(t.deltaZar))}
                      </td>
                      <td className="px-4 py-2.5 text-text-muted">{formatDate(t.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Packs */}
      {active === "packs" && (
        <div role="tabpanel" aria-label="Packs">
          {activePacks.length === 0 && expiredPacks.length === 0 ? (
            <EmptyState text="No coffee packs." />
          ) : (
            <div className="space-y-4">
              {activePacks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                    Active
                  </p>
                  {activePacks.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-md border border-border-subtle bg-elevated px-4 py-3 text-sm"
                    >
                      <span className="font-medium text-text-strong">{p.menuItemName}</span>
                      <span className="text-text-muted">
                        {p.qtyRemaining}/{p.qtyOriginal} · expires {formatDate(p.expiresAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {expiredPacks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                    Expired
                  </p>
                  {expiredPacks.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-md border border-border-subtle px-4 py-3 text-sm opacity-50"
                    >
                      <span className="font-medium text-text-strong">{p.menuItemName}</span>
                      <span className="text-text-muted">
                        {p.qtyRemaining}/{p.qtyOriginal} · expired {formatDate(p.expiresAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
