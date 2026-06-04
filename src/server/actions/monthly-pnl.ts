"use server";

// Monthly P&L server actions — Phase 2 G15
// generateMonthlyPnL: admin+ only.
// approveMonthlyPnL: admin signs admin_sig; finance signs finance_sig; owner can sign either.
// listMonthlyReports: admin + finance read.
// Docs: docs/FAVO_PRD_v3.md §04 §06 §07 · BUSINESS_RULES.md L11

import type { ActionResult, MonthlyReport } from "@/lib/types";

// ─── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE_REPORTS: MonthlyReport[] = [
  {
    id: "mr_2026_04",
    month: "2026-04-01",
    revenueZar: 3240000, // R32 400,00
    cogsZar: 1101600, // R11 016,00
    expensesZar: 450000, // R4 500,00
    grossMarginZar: 2138400,
    netZar: 1688400, // R16 884,00
    status: "closed",
    adminSig: {
      signerId: "staff_manager_mia",
      signerName: "Mia Manager",
      at: "2026-05-03T10:00:00+02:00",
    },
    financeSig: {
      signerId: "staff_owner_olivia",
      signerName: "Olivia Owner",
      at: "2026-05-03T14:00:00+02:00",
    },
    generatedAt: "2026-05-02T08:00:00+02:00",
    closedAt: "2026-05-03T14:00:00+02:00",
  },
  {
    id: "mr_2026_05",
    month: "2026-05-01",
    revenueZar: 2890000,
    cogsZar: 982600,
    expensesZar: 420000,
    grossMarginZar: 1907400,
    netZar: 1487400,
    status: "awaiting_signatures",
    adminSig: {
      signerId: "staff_manager_mia",
      signerName: "Mia Manager",
      at: "2026-06-01T09:30:00+02:00",
    },
    financeSig: null,
    generatedAt: "2026-06-01T08:00:00+02:00",
    closedAt: null,
  },
];

// ─── listMonthlyReports ───────────────────────────────────────────────────────

/**
 * Lists monthly P&L reports, most-recent first.
 * Admin + finance read.
 * TODO (P2 G15): replace fixture with real DB query.
 */
export async function listMonthlyReports(): Promise<
  ActionResult<{ reports: MonthlyReport[]; total: number }>
> {
  // STUB — returns fixture data until G15 is merged.
  return {
    ok: true,
    data: { reports: FIXTURE_REPORTS, total: FIXTURE_REPORTS.length },
  };
}

// ─── generateMonthlyPnL ───────────────────────────────────────────────────────

/**
 * Generates a draft monthly P&L for the given month (first of month).
 * Admin+ only. Cannot generate for the current open month.
 * TODO (P2 G15): real implementation.
 */
export async function generateMonthlyPnL(
  month: string // YYYY-MM-DD, first of month
): Promise<ActionResult<{ reportId: string }>> {
  void month;
  throw new Error("Not implemented — Phase 2 G15");
}

// ─── approveMonthlyPnL ────────────────────────────────────────────────────────

/**
 * Signs one side of the dual-approval. sigKind determines which signature slot.
 * RBAC: admin can only set admin_sig; finance can only set finance_sig;
 * owner can sign either side.
 * When both sigs are set status auto-closes.  writeAudit per sig (L11).
 * TODO (P2 G15): real implementation.
 */
export async function approveMonthlyPnL(
  reportId: string,
  sigKind: "admin" | "finance"
): Promise<ActionResult> {
  void reportId;
  void sigKind;
  throw new Error("Not implemented — Phase 2 G15");
}
