"use client";

// REQ-114 · PRD §11.2 — the /admin/expenses entry form for logExpense
// (category, amount_zar, incurred_at, note?). Admin only: the page, the
// (dashboard) layout and logExpense itself authorise "admin"; logExpense
// writes its audit row in the same transaction. Money is integer cents end to
// end: parseZar turns the typed rands into cents. Validation errors stay on
// the field with the value preserved (§17.2).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logExpense } from "@/server/actions/expenses";
import { formatZar, parseZar } from "@/lib/format";

/** expenses.amount_zar is a Postgres integer (logExpense's own upper bound). */
export const MAX_EXPENSE_CENTS = 2147483647;

const CATEGORIES = ["rent", "utilities", "staff", "maintenance", "marketing", "other"] as const;
type Category = (typeof CATEGORIES)[number];

/** No answer is not "nothing was saved": it may have committed. No blind retry. */
export const EXPENSE_UNCONFIRMED = "We couldn't confirm whether this expense was saved. Check the list below before recording it again.";

const field = "h-11 rounded-[var(--radius-btn)] border px-2 text-base bg-[color:var(--color-surface)]";

export default function ExpenseForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>("rent");
  const [amount, setAmount] = useState("");
  const [incurredAt, setIncurredAt] = useState(defaultDate);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    const amountZar = parseZar(amount);
    if (amountZar === null || amountZar <= 0) {
      setError("Enter an amount in rand, more than zero (e.g. 2500 or 2500,00).");
      return;
    }
    // The column holds integer cents up to 2 147 483 647; say so before the server does.
    if (amountZar > MAX_EXPENSE_CENTS) {
      setError(`That amount is too large for one expense — the most is ${formatZar(MAX_EXPENSE_CENTS)}. Check the figure, or split it.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await logExpense({ category, amountZar, incurredAt, note: note.trim() || null });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setAmount("");
      setNote("");
      setSaved(`Recorded: ${category} on ${incurredAt}.`);
      router.refresh();
    } catch {
      setError(EXPENSE_UNCONFIRMED);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3" aria-label="Record an expense">
      <label className="flex flex-col gap-1 favo-small">
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={field}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 favo-small">
        Amount (R)
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={error !== null}
          className={field}
          required
        />
      </label>
      <label className="flex flex-col gap-1 favo-small">
        Incurred on
        <input type="date" value={incurredAt} onChange={(e) => setIncurredAt(e.target.value)} className={field} required />
      </label>
      <label className="flex flex-1 flex-col gap-1 favo-small" style={{ minWidth: 200 }}>
        Note (optional)
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={field} />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="h-11 rounded-[var(--radius-btn)] border px-4 favo-small transition-colors hover:bg-[color:var(--color-porcelain-soft)] disabled:opacity-60"
      >
        {submitting ? "Recording…" : "Record expense"}
      </button>
      {error && (
        <p className="w-full favo-small" role="alert" style={{ color: "var(--color-error)" }}>{error}</p>
      )}
      {saved && (
        <p className="w-full favo-small" role="status" style={{ color: "var(--color-text-muted)" }}>{saved}</p>
      )}
    </form>
  );
}
