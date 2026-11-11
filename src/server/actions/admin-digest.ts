"use server";

// DEC-23 (Mia, 9 Nov 2026): job 7 (fund dormancy) and the §9.6.3 daily digest
// are Admin-screen banners and cards, read when the page renders. No timer, no
// task table, no write of any kind: every function here only SELECTs. Admin
// only — the digest names fund balances and the close (§10.7).

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appConfig, dailyCloses, openingSessions, voucherRedemptions } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { revenueDay } from "@/lib/format";
import { fundAlertsView, type FundAlertsView } from "@/server/funds/funds";
import { getFundDeps } from "@/server/funds/runtime";
import { latestImports } from "@/server/reconciliation/read";
import {
  DEFAULT_VOUCHER_EXPECTED_MAX,
  VOUCHER_EXPECTED_MAX_KEY,
  liabilityAboveLine,
  voucherDigest,
  type AdminDigest,
} from "@/server/alerts/daily-digest";
import type { ActionResult } from "@/lib/types";

const TENANT = "hofmi";
const DAY_MS = 86_400_000;

/** /admin/funds and /admin: funds at or past T14 − 30 days, and the total live balance. */
export async function getFundAlerts(): Promise<ActionResult<FundAlertsView>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  return { ok: true, data: await fundAlertsView(getFundDeps()) };
}

/** T11. Absent → the PRD default (25); present but not a whole number ≥ 0 → null (unavailable). */
async function readVoucherExpectedMax(): Promise<number | null> {
  const [row] = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(and(eq(appConfig.tenantId, TENANT), eq(appConfig.key, VOUCHER_EXPECTED_MAX_KEY)));
  if (!row) return DEFAULT_VOUCHER_EXPECTED_MAX;
  const v = row.value;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** The Admin home's daily digest card, for yesterday's revenue day (SAST). */
export async function getAdminDigest(): Promise<ActionResult<{ digest: AdminDigest; funds: FundAlertsView }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  // SAST has no daylight saving, so 24 h back is always the previous revenue day.
  const day = revenueDay(new Date(Date.now() - DAY_MS));

  const [sessions, expectedMax, funds, [last], imports] = await Promise.all([
    db
      .select({
        opensAt: openingSessions.opensAt,
        recorded: openingSessions.voucherRedemptionsRecorded,
        slipsCounted: openingSessions.voucherSlipsCounted,
        liveZar: sql<number>`COALESCE(SUM(${voucherRedemptions.discountZar}), 0)::int`,
      })
      .from(openingSessions)
      .leftJoin(
        voucherRedemptions,
        and(eq(voucherRedemptions.sessionId, openingSessions.id), isNull(voucherRedemptions.reversedAt))
      )
      .where(eq(openingSessions.sessionDate, day))
      .groupBy(openingSessions.id)
      .orderBy(openingSessions.opensAt),
    readVoucherExpectedMax(),
    fundAlertsView(getFundDeps()),
    db
      .select({
        revenueDay: sql<string>`${dailyCloses.revenueDay}::text`,
        reconciliationStatus: dailyCloses.reconciliationStatus,
        blockedReason: dailyCloses.blockedReason,
        writtenOffCount: dailyCloses.writtenOffCount,
        writtenOffZar: dailyCloses.writtenOffZar,
        wasCatchUp: dailyCloses.wasCatchUp,
      })
      .from(dailyCloses)
      .orderBy(desc(dailyCloses.revenueDay))
      .limit(1),
    latestImports(db, [day]),
  ]);
  const imp = imports.get(day) ?? null;

  const lastClose = last ?? null;
  return {
    ok: true,
    data: {
      digest: {
        day,
        vouchers: voucherDigest(
          sessions.map((s) => ({ ...s, liveZar: Number(s.liveZar) })),
          expectedMax
        ),
        fundLiabilityZar: funds.liabilityZar,
        fundLiabilityAboveLine: liabilityAboveLine(funds.liabilityZar),
        activeFundCount: funds.activeFundCount,
        lastClose,
        // Only a completed day can be closed, so the newest close is at most yesterday.
        yesterdayUnclosed: lastClose?.revenueDay !== day,
        yocoImport: imp && { unmatchedRows: imp.unmatchedRows, totalRows: imp.totalRows, toCheck: imp.exceptions.length },
      },
      funds,
    },
  };
}
