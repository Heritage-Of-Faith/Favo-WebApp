"use client";

// Expenses manager — task A10.
// List + filters (category, date range) + "New expense" dialog. Admin/owner can
// log; finance/manager can read (server enforces — the New button still calls
// the action which will reject for non-writers).

import { useState, useTransition } from "react";
import { listExpenses } from "@/server/actions/expenses";
import { formatZar, formatDate } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ExpenseForm from "@/components/admin/ExpenseForm";
import type { Expense, ExpenseCategory } from "@/lib/types";

const CATEGORIES: ExpenseCategory[] = ["rent", "utilities", "staff", "maintenance", "marketing", "other"];

export interface ExpensesManagerProps {
  initialExpenses: Expense[];
  canLog: boolean;
}

const selectStyle = {
  background: "var(--color-surface)",
  color: "var(--color-text-strong)",
  borderColor: "var(--color-border-subtle)",
} as const;

export default function ExpensesManager({ initialExpenses, canLog }: ExpensesManagerProps) {
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const res = await listExpenses({
        category: category || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      if (res.ok) setExpenses(res.data.expenses);
    });
  }

  const total = expenses.reduce((s, e) => s + e.amountZar, 0);

  return (
    <div className="space-y-4">
      {/* Filters + action */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="exp-cat" className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            Category
          </label>
          <select
            id="exp-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory | "")}
            className="h-10 rounded-[var(--radius-btn)] border px-2 favo-small capitalize focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]"
            style={selectStyle}
          >
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="exp-from" className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            From
          </label>
          <input id="exp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-[var(--radius-btn)] border px-2 favo-small focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]" style={selectStyle} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="exp-to" className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            To
          </label>
          <input id="exp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-[var(--radius-btn)] border px-2 favo-small focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]" style={selectStyle} />
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isPending}
          className="min-h-10 rounded-[var(--radius-btn)] border px-3 favo-small disabled:opacity-50"
          style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-strong)" }}
        >
          {isPending ? "Applying…" : "Apply"}
        </button>

        {canLog && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="ml-auto min-h-10 rounded-[var(--radius-btn)] px-4 favo-cta"
            style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)" }}
          >
            + New expense
          </button>
        )}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between">
        <span className="favo-label">{expenses.length} expense{expenses.length === 1 ? "" : "s"}</span>
        <span className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
          Total: {formatZar(total)}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[var(--radius-card)] border" style={{ borderColor: "var(--color-border-subtle)" }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Logged by</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
                  No expenses for this filter.
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{formatDate(e.incurredAt)}</TableCell>
                  <TableCell style={{ textTransform: "capitalize" }}>{e.category}</TableCell>
                  <TableCell style={{ color: "var(--color-text-muted)" }}>{e.loggedByName}</TableCell>
                  <TableCell className="text-right" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                    {formatZar(e.amountZar)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {showForm && <ExpenseForm onClose={() => setShowForm(false)} onSaved={refresh} />}
    </div>
  );
}
