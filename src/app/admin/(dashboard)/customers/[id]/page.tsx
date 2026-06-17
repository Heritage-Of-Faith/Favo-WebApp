// Customer detail page — owner: Mia (AT-78 A16 + AT-79 A17)
// Read-only — no mutation entry points (POPIA-friendly).
// Tabs (Orders · Loyalty · Wallet · Packs) handled client-side in CustomerBalanceTabs.
import { notFound } from "next/navigation";
import { getCustomerDetail } from "@/server/actions/customers";
import { formatZar, formatDate } from "@/lib/format";
import CustomerBalanceTabs from "@/components/admin/CustomerBalanceTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer" };

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

      {/* KPI strip — always visible regardless of active tab */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Loyalty points" value={String(c.loyaltyPoints)} />
        <Stat label="Wallet balance" value={formatZar(c.walletZar)} />
        <Stat label="Active packs" value={String(c.activePacks.length)} />
      </div>

      {/* Tabbed history — all data passed down; no additional fetching on tab switch */}
      <CustomerBalanceTabs
        loyaltyTxns={c.loyaltyTxns}
        walletTxns={c.walletTxns}
        activePacks={c.activePacks}
        expiredPacks={c.expiredPacks}
        recentOrders={c.recentOrders}
      />
    </div>
  );
}
