"use server";

// Expense server actions — Phase 2 G12
// logExpense: admin+ only. listExpenses: admin + finance read.
// All money is integer cents (amountZar).
// Docs: docs/API.md · docs/DATA_MODEL.md · docs/BUSINESS_RULES.md L08

import type { ActionResult, Expense, ExpenseCategory } from "@/lib/types";

// ─── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE_EXPENSES: Expense[] = [
  {
    id: "exp_001",
    category: "utilities",
    amountZar: 15000, // R150,00
    incurredAt: "2026-05-30T09:00:00+02:00",
    loggedBy: "staff_manager_mia",
    loggedByName: "Mia Manager",
  },
  {
    id: "exp_002",
    category: "maintenance",
    amountZar: 85000, // R850,00 — espresso machine service
    incurredAt: "2026-05-28T14:30:00+02:00",
    loggedBy: "staff_manager_mia",
    loggedByName: "Mia Manager",
  },
  {
    id: "exp_003",
    category: "marketing",
    amountZar: 35000, // R350,00
    incurredAt: "2026-05-25T10:00:00+02:00",
    loggedBy: "staff_owner_olivia",
    loggedByName: "Olivia Owner",
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogExpenseInput = {
  category: ExpenseCategory;
  amountZar: number; // integer cents
  incurredAt?: string; // ISO 8601; defaults to now() in Africa/Johannesburg
};

export type ListExpensesInput = {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  category?: ExpenseCategory;
};

// ─── listExpenses ─────────────────────────────────────────────────────────────

/**
 * Lists expenses, optionally filtered by date range and category.
 * Admin + finance can read; barista is 403.
 * TODO (P2 G12): replace fixture with real DB query; enforce RBAC.
 */
export async function listExpenses(
  input?: ListExpensesInput
): Promise<ActionResult<{ expenses: Expense[]; total: number }>> {
  void input;
  // STUB — returns fixture data until G12 is merged.
  return {
    ok: true,
    data: { expenses: FIXTURE_EXPENSES, total: FIXTURE_EXPENSES.length },
  };
}

// ─── logExpense ───────────────────────────────────────────────────────────────

/**
 * Logs a new expense. Admin+ only.
 * Validates amountZar is a positive integer (rejects floats).
 * writeAudit({ entityKind: 'expense', action: 'create' }).
 * Pings `cogs_changes` SSE channel so A7 refreshes within 5 s.
 * TODO (P2 G12): real implementation.
 */
export async function logExpense(
  input: LogExpenseInput
): Promise<ActionResult<{ expenseId: string }>> {
  void input;
  throw new Error("Not implemented — Phase 2 G12");
}
