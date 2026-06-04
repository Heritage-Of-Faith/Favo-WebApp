"use server";

// COGS (cost of goods sold) server actions — Phase 2 G13
// getCogsLive: admin/owner only. Returns today's revenue, COGS, expenses,
// gross margin, net, and a cost-estimate warning flag (R10 mitigation).
// Docs: docs/API.md · docs/FAVO_PRD_v3.md §04 §07 · BUSINESS_RULES.md L07

import type { ActionResult, CogsLive } from "@/lib/types";

// ─── Fixture data (removed once G13 real implementation lands) ───────────────

const FIXTURE_COGS_TODAY: CogsLive = {
  date: "2026-05-30",
  revenueZar: 125600, // R1 256,00 (33 drinks × avg R38)
  cogsZar: 42800, // R428,00 (~34% COGS ratio — expected in week 1 with estimates)
  expensesZar: 15000, // R150,00 utilities today
  grossMarginZar: 82800, // revenueZar - cogsZar
  netZar: 67800, // grossMarginZar - expensesZar
  profit: true,
  // All lots seeded with best-estimate costs (G8 R10 flag) — warning is on
  // until admin recosts via A8.
  costEstimatedWarning: true,
};

// 14 days of history for the sparkline tile in A7
const FIXTURE_HISTORY: CogsLive[] = Array.from({ length: 14 }, (_, i) => {
  const d = new Date("2026-05-30");
  d.setDate(d.getDate() - (13 - i));
  const revenue = 90000 + Math.floor(i * 3200 + (i % 3) * 5000);
  const cogs = Math.floor(revenue * 0.34);
  const expenses = 12000 + (i % 7 === 0 ? 15000 : 0);
  const gross = revenue - cogs;
  const net = gross - expenses;
  return {
    date: d.toISOString().slice(0, 10),
    revenueZar: revenue,
    cogsZar: cogs,
    expensesZar: expenses,
    grossMarginZar: gross,
    netZar: net,
    profit: net > 0,
    costEstimatedWarning: true,
  };
});

// ─── getCogsLive ──────────────────────────────────────────────────────────────

/**
 * Returns COGS summary for a given SAST date (defaults to today).
 * Admin / owner only.  Cache-Control: no-store.
 *
 * Real implementation wires to v_daily_revenue + v_daily_cogs + v_daily_expenses
 * SQL views created in migration 0003 (G13).
 *
 * TODO (P2 G13): replace fixture with real DB query via getCogsLive() in
 *   src/server/cogs/compute.ts.
 */
export async function getCogsLive(input?: {
  date?: string; // YYYY-MM-DD in Africa/Johannesburg; defaults to today
}): Promise<ActionResult<CogsLive>> {
  void input;
  // STUB — returns fixture data until G13 is merged.
  return { ok: true, data: FIXTURE_COGS_TODAY };
}

// ─── getCogsHistory ───────────────────────────────────────────────────────────

/**
 * Returns COGS snapshots for the last N SAST days (for sparkline tile in A7).
 * Admin / owner only.
 * TODO (P2 G13): real implementation.
 */
export async function getCogsHistory(input?: {
  days?: number; // default 14
}): Promise<ActionResult<{ history: CogsLive[] }>> {
  void input;
  // STUB — returns fixture history.
  return { ok: true, data: { history: FIXTURE_HISTORY } };
}
