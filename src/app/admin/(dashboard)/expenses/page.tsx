// REQ-114 · PRD §11.2, §17.2 — /admin/expenses: record an operating expense
// (logExpense) and list the period's. Admin only (§10.7: logExpense admin ✔
// only): proxy.ts and the (dashboard) layout gate the route; listExpenses and
// logExpense authorize "admin" themselves, and logExpense audits every write.
//
// REQ-112: a card processing fee is not an expense — it is already netted in
// contribution — so the page says so beside the form.
//
// The §17.2 empty-state line ("…reads COGS only until one is") contradicts
// REQ-114, under which ministry_cost reads UNAVAILABLE until an expense is
// recorded; this page states what the rollup actually does.

import ExpenseForm from "@/components/admin/ExpenseForm";
import { listExpenses } from "@/server/actions/expenses";
import { formatZar, revenueDay } from "@/lib/format";
import { isCalendarDay, periodContaining } from "@/lib/ministry-period";

export const metadata = { title: "Expenses" };
export const dynamic = "force-dynamic";

const cardStyle = { borderColor: "var(--color-border-subtle)" };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const today = revenueDay();
  const date = sp.date && isCalendarDay(sp.date) ? sp.date : today;
  const { from, to } = periodContaining("month", date);
  const res = await listExpenses(from, to);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="admin-page-title">Expenses</h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Rent, utilities, wages and other operating costs. They enter the ministry rollup&apos;s cost.
          Card processing fees are not expenses — they are already taken off contribution.
        </p>
      </header>

      <section className="space-y-3 rounded-[var(--radius-card)] border p-4" style={cardStyle} aria-labelledby="exp-new">
        <h2 id="exp-new" className="admin-section-title" style={{ color: "var(--color-text-strong)" }}>
          Record an expense
        </h2>
        <ExpenseForm defaultDate={today} />
      </section>

      <section className="space-y-3" aria-labelledby="exp-list">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="exp-list" className="admin-section-title" style={{ color: "var(--color-text-strong)" }}>
            {from} to {to}
          </h2>
          <form method="get" className="flex items-end gap-2" aria-label="Month">
            <label className="flex flex-col gap-1 favo-small">
              Month containing
              <input type="date" name="date" defaultValue={date} className="h-11 rounded-[var(--radius-btn)] border px-2 text-base bg-[color:var(--color-surface)]" />
            </label>
            <button type="submit" className="h-11 rounded-[var(--radius-btn)] border px-4 favo-small transition-colors hover:bg-[color:var(--color-porcelain-soft)]">
              Show
            </button>
          </form>
        </div>

        {!res.ok ? (
          <p className="favo-small" role="alert" style={{ color: "var(--color-error)" }}>{res.message}</p>
        ) : res.data.expenses.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border p-6 text-center favo-small" style={{ ...cardStyle, color: "var(--color-text-muted)" }}>
            {res.data.anyEverLogged
              ? "No expenses recorded this month"
              : "No expenses recorded — the ministry rollup's cost reads UNAVAILABLE until one is"}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={cardStyle}>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b favo-caption" style={{ ...cardStyle, color: "var(--color-text-muted)" }}>
                  <th className="px-3 py-2">Incurred</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {res.data.expenses.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 favo-small align-top" style={cardStyle}>
                    <td className="px-3 py-2">{e.incurredDay}</td>
                    <td className="px-3 py-2">{e.category}</td>
                    <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{formatZar(e.amountZar)}</td>
                    <td className="px-3 py-2">{e.note ?? ""}</td>
                    <td className="px-3 py-2">{e.loggedByName ?? "unattributed"}</td>
                  </tr>
                ))}
                <tr className="favo-small" style={cardStyle}>
                  <th scope="row" colSpan={2} className="px-3 py-2" style={{ color: "var(--color-text-strong)" }}>Total</th>
                  <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{formatZar(res.data.totalZar)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
