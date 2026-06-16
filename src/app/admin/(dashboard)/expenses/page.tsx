// Expenses — task A10.
// Log and review operating expenses. Admin/owner log; finance/manager read.
// Docs: API.md, DATA_MODEL.md (expenses).
import { getSession } from "@/lib/auth/session";
import { listExpenses } from "@/server/actions/expenses";
import ExpensesManager from "@/components/admin/ExpensesManager";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const session = await getSession();
  const canLog = session?.role === "admin";
  const res = await listExpenses();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="favo-h2" style={{ color: "var(--color-text-strong)" }}>
          Expenses
        </h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Operating expenses feed the COGS dashboard&apos;s net figure.
        </p>
      </header>

      {res.ok ? (
        <ExpensesManager initialExpenses={res.data.expenses} canLog={canLog} />
      ) : (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
      )}
    </div>
  );
}
