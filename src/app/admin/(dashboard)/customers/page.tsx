// Customer admin list — owner: Mia (AT-78, A16)
// Search by name or email. Read-only — no mutation entry points (POPIA).
import CustomerTable from "@/components/admin/CustomerTable";

export const metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-strong">Customers</h1>
        <p className="mt-1 text-sm text-text-muted">
          Read-only customer directory. Click a name to see their full profile.
        </p>
      </header>
      <CustomerTable initialQuery={q ?? ""} />
    </div>
  );
}
