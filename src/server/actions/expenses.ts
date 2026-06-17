"use server";

// Expense server actions — task G12
// logExpense: admin+ only. Money validated as integer cents.
// listExpenses: admin + finance read. Barista 403.
// Docs: docs/API.md · docs/DATA_MODEL.md · docs/BUSINESS_RULES.md L08

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { expenses, staff } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult, Expense, ExpenseCategory } from "@/lib/types";
import type { DB } from "@/lib/db";

const ADMIN_ROLES = ["admin"] as const;
const WRITER_ROLES = ["admin"] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogExpenseInput = {
  category: ExpenseCategory;
  /** Cost in integer cents (e.g. R150,00 → 15000). Rejects floats. */
  amountZar: number;
  /** ISO 8601 date-time; defaults to now() in Africa/Johannesburg. */
  incurredAt?: string;
};

export type ListExpensesInput = {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  category?: ExpenseCategory;
};

// ─── listExpenses ─────────────────────────────────────────────────────────────

/**
 * Lists expenses filtered by date range and/or category, most-recent first.
 * Manager / admin / finance / owner read.
 */
export async function listExpenses(
  input?: ListExpensesInput
): Promise<ActionResult<{ expenses: Expense[]; total: number }>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;

  const rows = await db
    .select({
      id: expenses.id,
      category: expenses.category,
      amountZar: expenses.amountZar,
      incurredAt: expenses.incurredAt,
      loggedBy: expenses.loggedBy,
      staffName: staff.name,
    })
    .from(expenses)
    .innerJoin(staff, eq(expenses.loggedBy, staff.id))
    .where(
      and(
        input?.from
          ? gte(expenses.incurredAt, new Date(input.from))
          : undefined,
        input?.to
          ? lte(expenses.incurredAt, new Date(input.to + "T23:59:59Z"))
          : undefined,
        input?.category ? eq(expenses.category, input.category) : undefined
      )
    )
    .orderBy(desc(expenses.incurredAt));

  const result: Expense[] = rows.map((r) => ({
    id: r.id,
    category: r.category as ExpenseCategory,
    amountZar: r.amountZar,
    incurredAt: r.incurredAt.toISOString(),
    loggedBy: r.loggedBy,
    loggedByName: r.staffName,
  }));

  return { ok: true, data: { expenses: result, total: result.length } };
}

// ─── logExpense ───────────────────────────────────────────────────────────────

/**
 * Logs a new expense. Admin / owner only.
 * - amountZar must be a positive integer (rejects floats).
 * - incurredAt defaults to now() in Africa/Johannesburg.
 * - writeAudit (L08).
 * - pg_notify('cogs_changes') so A7 dashboard refreshes within 5 s.
 */
export async function logExpense(
  input: LogExpenseInput
): Promise<ActionResult<{ expenseId: string }>> {
  const auth = await authorize(...WRITER_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  // Validate money: integer, positive
  if (!Number.isInteger(input.amountZar) || input.amountZar <= 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "amountZar must be a positive integer (cents).",
    };
  }

  const incurredAt = input.incurredAt ? new Date(input.incurredAt) : new Date();

  let expenseId!: string;

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    const [inserted] = await tx
      .insert(expenses)
      .values({
        category: input.category,
        amountZar: input.amountZar,
        incurredAt,
        loggedBy: session.id,
      })
      .returning({ id: expenses.id });

    expenseId = inserted.id;

    await writeAudit(
      {
        entityKind: "expense",
        entityId: expenseId,
        action: "create",
        actorId: session.id,
        actorRole: session.role,
        before: null,
        after: { category: input.category, amountZar: input.amountZar },
      },
      txDb
    );
  });

  // Notify COGS dashboard to refresh (non-fatal)
  db.execute(
    sql`SELECT pg_notify('cogs_changes', ${JSON.stringify({ expenseId })})`
  ).catch(() => {});

  return { ok: true, data: { expenseId } };
}
