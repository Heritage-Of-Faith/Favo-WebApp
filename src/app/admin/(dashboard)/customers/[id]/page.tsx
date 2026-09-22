// Customer detail page — owner: Mia (AT-78 A16 + AT-79 A17)
// Read-only — no mutation entry points (POPIA-friendly).
import { notFound } from "next/navigation";
import { getCustomerDetail } from "@/server/actions/customers";
import { formatDate } from "@/lib/format";
import CustomerOrdersTable from "@/components/admin/CustomerOrdersTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer" };

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

      <CustomerOrdersTable recentOrders={c.recentOrders} />
    </div>
  );
}
