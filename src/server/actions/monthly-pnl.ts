"use server";

// Monthly P&L server actions — task G15
// generateMonthlyPnL: admin+ only. Creates a draft for the previous closed month.
// approveMonthlyPnL:  admin signs admin_sig; finance signs finance_sig;
//                     owner can sign either side.
//                     When both sigs are set, status auto-closes (L11).
// listMonthlyReports: admin + finance read.
// DB CHECK: closed requires both sigs — enforced by migration 0006 (L11).
// Docs: FAVO_PRD_v3.md §04 §06 §07 · BUSINESS_RULES.md L11

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { monthlyReports, orders, expenses } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type {
  ActionResult,
  MonthlyReport,
  MonthlyReportSig,
} from "@/lib/types";
import type { DB } from "@/lib/db";

const ADMIN_ROLES = ["admin", "owner"] as const;
const READER_ROLES = ["admin", "finance", "owner"] as const;

// SAST offset for month boundary computation
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** Parse a YYYY-MM-DD month string into UTC start/end Date objects. */
function monthBounds(month: string): { start: Date; end: Date } {
  // month = "YYYY-MM-01" (first of month in SAST)
  const [year, mon] = month.split("-").map(Number);
  // SAST midnight of the first day
  const startSast = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
  // End = first day of next month SAST midnight
  const endSast = new Date(Date.UTC(year, mon, 1, 0, 0, 0, 0));
  return {
    start: new Date(startSast.getTime() - SAST_OFFSET_MS),
    end: new Date(endSast.getTime() - SAST_OFFSET_MS),
  };
}

function rowToReport(r: {
  id: string;
  month: string;
  revenueZar: number;
  cogsZar: number;
  expensesZar: number;
  grossMarginZar: number;
  netZar: number;
  status: string;
  adminSig: unknown;
  financeSig: unknown;
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
    status: r.status as MonthlyReport["status"],
    adminSig: (r.adminSig as MonthlyReportSig | null) ?? null,
    financeSig: (r.financeSig as MonthlyReportSig | null) ?? null,
    generatedAt: r.generatedAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  };
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

  const { start, end } = monthBounds(month);

  // ── Revenue ────────────────────────────────────────────────────────────────
  const [revRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${orders.totalZar}), 0)::int` })
    .from(orders)
    .where(
      and(
        sql`${orders.state} IN ('in_progress', 'ready', 'collected')`,
        gte(orders.placedAt, start),
        lt(orders.placedAt, end)
      )
    );
  const revenueZar = revRow?.total ?? 0;

  // ── COGS ───────────────────────────────────────────────────────────────────
  const [cogsRow] = await db.execute<{ total: string | null }>(sql`
    SELECT ROUND(COALESCE(SUM(-sm.delta::numeric * il.unit_cost_zar), 0))::bigint AS total
    FROM stock_movements sm
    JOIN inventory_lots il ON sm.inventory_lot_id = il.id
    WHERE sm.kind = 'deduction'
      AND il.unit_cost_zar IS NOT NULL
      AND sm.at >= ${start.toISOString()}::timestamptz AND sm.at < ${end.toISOString()}::timestamptz
  `);
  const cogsZar = parseInt(cogsRow?.total ?? "0", 10) || 0;

  // ── Expenses ───────────────────────────────────────────────────────────────
  const [expRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${expenses.amountZar}), 0)::int` })
    .from(expenses)
    .where(and(gte(expenses.incurredAt, start), lt(expenses.incurredAt, end)));
  const expensesZar = expRow?.total ?? 0;

  const grossMarginZar = revenueZar - cogsZar;
  const netZar = grossMarginZar - expensesZar;

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
        after: { month, revenueZar, cogsZar, expensesZar, netZar, status: "draft" },
      },
      txDb
    );
  });

  return { ok: true, data: { reportId } };
}

// ─── approveMonthlyPnL ────────────────────────────────────────────────────────

/**
 * Signs one side of the dual approval.
 *
 * RBAC per L11:
 *   sigKind='admin'   → only admin or owner can sign
 *   sigKind='finance' → only finance or owner can sign
 *
 * When both sigs are present the status transitions to 'closed' automatically.
 * The DB CHECK in migration 0006 enforces this at the DB level too.
 */
export async function approveMonthlyPnL(
  reportId: string,
  sigKind: "admin" | "finance"
): Promise<ActionResult> {
  // Resolve who can sign which side
  const allowedRoles =
    sigKind === "admin"
      ? (["admin", "owner"] as const)
      : (["finance", "owner"] as const);

  const auth = await authorize(...allowedRoles);
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

  // Check the sig slot isn't already set
  const existingSig =
    sigKind === "admin" ? report.adminSig : report.financeSig;
  if (existingSig !== null) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `${sigKind} signature already present.`,
    };
  }

  const sig: MonthlyReportSig = {
    signerId: session.id,
    signerName: session.name,
    at: new Date().toISOString(),
  };

  // Determine new status
  const otherSig =
    sigKind === "admin" ? report.financeSig : report.adminSig;
  const bothSigned = otherSig !== null;
  const newStatus = bothSigned ? "closed" : "awaiting_signatures";

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    const statusValue = newStatus as "draft" | "awaiting_signatures" | "closed";
    const updates =
      sigKind === "admin"
        ? {
            adminSig: sig,
            status: statusValue,
            closedAt: bothSigned ? new Date() : null,
          }
        : {
            financeSig: sig,
            status: statusValue,
            closedAt: bothSigned ? new Date() : null,
          };

    await tx
      .update(monthlyReports)
      .set(updates)
      .where(eq(monthlyReports.id, reportId));

    await writeAudit(
      {
        entityKind: "monthly_report",
        entityId: reportId,
        action: `sign_${sigKind}`,
        actorId: session.id,
        actorRole: session.role,
        before: { status: report.status },
        after: {
          status: newStatus,
          [`${sigKind}Sig`]: sig,
          closed: bothSigned,
        },
      },
      txDb
    );
  });

  return { ok: true, data: undefined };
}
