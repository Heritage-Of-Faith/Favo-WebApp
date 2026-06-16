// Customer detail page — owner: Mia (AT-78, A16)
// Read-only — no mutation entry points (POPIA-friendly).
import { notFound } from "next/navigation";
import { getCustomerDetail } from "@/server/actions/customers";
import { formatZar, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-text-muted">{text}</p>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-elevated px-4 py-3">
      <p className="text-xs text-text-muted mb-0.5">{label}</p>
      <p className="text-lg font-semibold text-text-strong tabular-nums">{value}</p>
    </div>
  );
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await getCustomerDetail(id);

  if (!res.ok) {
    if (res.code === "NOT_FOUND") notFound();
    return (
      <p className="text-sm text-text-muted">Failed to load customer.</p>
    );
  }

  const c = res.data;
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

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-center gap-3">
        <a
          href="/admin/customers"
          className="text-xs font-medium uppercase tracking-wider text-text-muted hover:text-text-strong"
        >
          ← Customers
        </a>
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-text-strong">{c.name}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {c.email ?? "No email"} · {c.phone ?? "No phone"} · Joined{" "}
          {formatDate(c.createdAt)}
        </p>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Loyalty points" value={String(c.loyaltyPoints)} />
        <Stat label="Wallet balance" value={formatZar(c.walletZar)} />
        <Stat label="Active packs" value={String(c.activePacks.length)} />
      </div>

      {/* Loyalty transactions */}
      <Section title="Loyalty history">
        {c.loyaltyTxns.length === 0 ? (
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
                {c.loyaltyTxns.map((t) => (
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
      </Section>

      {/* Wallet transactions */}
      <Section title="Wallet transactions">
        {c.walletTxns.length === 0 ? (
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
                {c.walletTxns.map((t) => (
                  <tr key={t.id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-2.5 text-text-muted text-xs uppercase tracking-wider">
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
      </Section>

      {/* Active packs */}
      <Section title="Active packs">
        {c.activePacks.length === 0 ? (
          <EmptyState text="No active packs." />
        ) : (
          <div className="space-y-2">
            {c.activePacks.map((p) => (
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
      </Section>

      {/* Expired packs — collapsible */}
      {c.expiredPacks.length > 0 && (
        <Section title="Expired packs">
          <details>
            <summary className="cursor-pointer text-sm text-text-muted hover:text-text-strong">
              Show {c.expiredPacks.length} expired pack
              {c.expiredPacks.length !== 1 ? "s" : ""}
            </summary>
            <div className="mt-2 space-y-2">
              {c.expiredPacks.map((p) => (
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
          </details>
        </Section>
      )}

      {/* Recent orders */}
      <Section title="Recent orders">
        {c.recentOrders.length === 0 ? (
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
                {c.recentOrders.map((o) => (
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
                    <td className="px-4 py-2.5 text-text-muted">
                      {formatDate(o.placedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
