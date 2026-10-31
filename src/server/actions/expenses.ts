"use server";

// AT-205 — PRD §11.2 logExpense(category, amount_zar, incurred_at, note?).
// Admin only (role matrix L2686). Records an operating expense; until one is
// recorded the ministry rollup's ministry_cost reads UNAVAILABLE (REQ-114).
// Integer cents. Audited in the same transaction (L08/L12).
//
// REQ-112: a card processing fee is not an expense and must not be logged as
// one once the fee import ships (it is netted inside contribution). Nothing
// here can stop it — category 'other' accepts anything — so the guard belongs
// in the /admin/expenses copy or a later rule, not in this action.

import { z } from "zod";
import { db, type DB } from "@/lib/db";
import { expenses } from "@db/schema";
import { expenseCategory } from "@db/enums";
import { writeAudit } from "@/server/audit";
import { authorize } from "@/server/auth/guard";
import type { ActionResult } from "@/lib/types";

/** YYYY-MM-DD, a real calendar date. Read as midnight SAST (UTC+2, no DST). */
const sastDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "incurredAt must be YYYY-MM-DD")
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, "incurredAt is not a real date");

const logExpenseSchema = z.object({
  category: z.enum(expenseCategory.enumValues),
  // Integer cents, > 0. The upper bound is the integer column's, not a rule.
  amountZar: z.number().int("amountZar must be whole cents").positive("amountZar must be more than zero").max(2147483647),
  incurredAt: sastDate,
  note: z.string().max(500).optional().nullable(),
});

export type LogExpenseInput = z.input<typeof logExpenseSchema>;

export type LoggedExpense = {
  id: string;
  category: (typeof expenseCategory.enumValues)[number];
  amountZar: number;
  incurredAt: string;
  note: string | null;
};

export async function logExpense(input: LogExpenseInput): Promise<ActionResult<LoggedExpense>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  const parsed = logExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { category, amountZar, incurredAt } = parsed.data;
  const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;

  try {
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(expenses)
        .values({
          category,
          amountZar,
          incurredAt: new Date(`${incurredAt}T00:00:00+02:00`),
          loggedBy: session.id,
          note,
        })
        .returning();
      const out: LoggedExpense = {
        id: inserted!.id,
        category: inserted!.category,
        amountZar: inserted!.amountZar,
        incurredAt: inserted!.incurredAt.toISOString(),
        note: inserted!.note ?? null,
      };
      await writeAudit(
        {
          actorId: session.id,
          actorRole: session.role,
          action: "expense.logged",
          entityKind: "expense",
          entityId: out.id,
          after: { category: out.category, amountZar: out.amountZar, incurredAt: out.incurredAt, note: out.note },
        },
        tx as unknown as DB
      );
      return out;
    });
    return { ok: true, data: row };
  } catch {
    return { ok: false, code: "DB_ERROR", message: "Could not record the expense." };
  }
}
