"use server";

// Monthly P&L server actions — task G15
// generateMonthlyPnL: admin only. Creates a draft for the previous closed month.
// approveMonthlyPnL:  admin signs admin_sig; when signed, status auto-closes (L11).
// listMonthlyReports: admin read.
// DB CHECK: closed requires admin sig — enforced by migration 0011 (L11).
// Docs: FAVO_PRD_v3.md §04 §06 §07 · BUSINESS_RULES.md L11

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { monthlyReports } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { readPeriodFigures } from "@/server/cogs/period-cogs";
import type {
  ActionResult,
  MonthlyReport,
  MonthlyReportSig,
} from "@/lib/types";
import type { DB } from "@/lib/db";

const ADMIN_ROLES = ["admin"] as const;
const READER_ROLES = ["admin"] as const;

function rowToReport(r: {
  id: string;
  month: string;
  revenueZar: number;
  cogsZar: number | null;
  expensesZar: number;
  grossMarginZar: number | null;
  netZar: number | null;
  costState: MonthlyReport["costState"];
  cogsAbsentItems: string[];
  ordersWithoutCost: number;
  status: string;
  adminSig: unknown;
  generatedAt: Date;
  closedAt: Date | null;
}): MonthlyReport {
  return {
    id: r.id,
    month: r.month,
    revenueZar: r.revenueZar,
    cogsZar: r.cogsZar,
    expensesZar: r.expensesZar,
    grossMarginZar: r.grossMarginZar,
    netZar: r.netZar,
    costState: r.costState,
    cogsAbsentItems: r.cogsAbsentItems,
    ordersWithoutCost: r.ordersWithoutCost,
    status: r.status as MonthlyReport["status"],
    adminSig: (r.adminSig as MonthlyReportSig | null) ?? null,
    generatedAt: r.generatedAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  };
}

/** "2026-08-01" → "2026-08-31": the month's last revenue day. */
function lastDayOfMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
}

// ─── listMonthlyReports ───────────────────────────────────────────────────────

export async function listMonthlyReports(): Promise<
  ActionResult<{ reports: MonthlyReport[]; total: number }>
> {
  const auth = await authorize(...READER_ROLES);
  if (!auth.ok) return auth;

  const rows = await db
    .select()
    .from(monthlyReports)
    .orderBy(desc(monthlyReports.month));

  const reports = rows.map(rowToReport);
  return { ok: true, data: { reports, total: reports.length } };
}

// ─── generateMonthlyPnL ───────────────────────────────────────────────────────

/**
 * Generates a draft monthly P&L for the given month (YYYY-MM-DD, first of month).
 * Admin+ only. Rejects if a report already exists for that month.
 */
export async function generateMonthlyPnL(
  month: string
): Promise<ActionResult<{ reportId: string }>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  // Validate month format
  if (!/^\d{4}-\d{2}-01$/.test(month)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "month must be YYYY-MM-01 (first of month).",
    };
  }

  // Idempotency check
  const [existing] = await db
    .select({ id: monthlyReports.id })
    .from(monthlyReports)
    .where(eq(monthlyReports.month, month));

  if (existing) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `A report for ${month} already exists (id: ${existing.id}).`,
    };
  }

  const lastDay = lastDayOfMonth(month);

  // Revenue (orders.revenue_day), COGS (Σ order_cogs — never re-rounded, never
  // filtered: AT-189/AT-190, REQ-106/REQ-109) and expenses over the month's
  // revenue days, through the same reads and periodFigures arithmetic as the
  // dashboard, the CSV and the weekly report — so net subtracts expenses here
  // too (it used to hard-code expenses to 0 and disagree with weekly).
  const f = await readPeriodFigures(month, lastDay);
  const { revenueZar, cogsZar, expensesZar, grossMarginZar, netZar, costState } = f;
  const cogsAbsentItems = f.cogs.absentItemNames;
  const ordersWithoutCost = f.cogs.ordersWithoutCost;

  let reportId!: string;

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    const [report] = await tx
      .insert(monthlyReports)
      .values({
        month,
        revenueZar,
        cogsZar,
        expensesZar,
        grossMarginZar,
        netZar,
        costState,
        cogsAbsentItems,
        ordersWithoutCost,
        status: "draft",
      })
      .returning({ id: monthlyReports.id });

    reportId = report.id;

    await writeAudit(
      {
        entityKind: "monthly_report",
        entityId: reportId,
        action: "create",
        actorId: session.id,
        actorRole: session.role,
        before: null,
        after: { month, revenueZar, cogsZar, expensesZar, netZar, costState, cogsAbsentItems, ordersWithoutCost, status: "draft" },
      },
      txDb
    );
  });

  return { ok: true, data: { reportId } };
}

// ─── approveMonthlyPnL ────────────────────────────────────────────────────────

/**
 * Close a monthly report with the admin sign-off.
 *
 * RBAC (post role-simplification): only an admin may sign. Signing is
 * irreversible and closes the report immediately — the prior finance
 * co-signature was removed along with the finance role.
 */
export async function approveMonthlyPnL(reportId: string): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  const [report] = await db
    .select()
    .from(monthlyReports)
    .where(eq(monthlyReports.id, reportId));

  if (!report) {
    return { ok: false, code: "NOT_FOUND", message: "Report not found." };
  }
  if (report.status === "closed") {
    return { ok: false, code: "CONFLICT", message: "Report is already closed." };
  }
  if (report.adminSig !== null) {
    return { ok: false, code: "CONFLICT", message: "Report is already signed." };
  }

  const sig: MonthlyReportSig = {
    signerId: session.id,
    signerName: session.name,
    at: new Date().toISOString(),
  };

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    await tx
      .update(monthlyReports)
      .set({ adminSig: sig, status: "closed", closedAt: new Date() })
      .where(eq(monthlyReports.id, reportId));

    await writeAudit(
      {
        entityKind: "monthly_report",
        entityId: reportId,
        action: "sign_admin",
        actorId: session.id,
        actorRole: session.role,
        before: { status: report.status },
        after: { status: "closed", adminSig: sig, closed: true },
      },
      txDb
    );
  });

  return { ok: true, data: undefined };
}
