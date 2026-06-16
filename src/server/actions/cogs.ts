"use server";

// COGS server actions — task G13 (real implementations)
// getCogsLive:    queries v_daily_revenue + v_daily_cogs + v_daily_expenses.
// getCogsHistory: returns N past SAST days for the sparkline tile in A7.
// Both: admin/owner only. Cache-Control: no-store.
// Docs: FAVO_PRD_v3.md §04 §07 · BUSINESS_RULES.md L07

import { authorize } from "@/server/auth/guard";
import { getCogsLive as computeCogsLive, todaySast } from "@/server/cogs/compute";
import type { ActionResult, CogsLive } from "@/lib/types";

const ADMIN_ROLES = ["admin"] as const;

// ─── getCogsLive ──────────────────────────────────────────────────────────────

/**
 * Returns the COGS summary for a given SAST date (defaults to today).
 * Admin / owner only.
 */
export async function getCogsLive(input?: {
  date?: string; // YYYY-MM-DD in Africa/Johannesburg; defaults to today
}): Promise<ActionResult<CogsLive>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;

  const date = input?.date ?? todaySast();
  const data = await computeCogsLive(date);
  return { ok: true, data };
}

// ─── getCogsHistory ───────────────────────────────────────────────────────────

/**
 * Returns COGS snapshots for the last N SAST days (for sparkline tile in A7).
 * Runs N sequential queries against the view — acceptable for N ≤ 30.
 * Admin / owner only.
 */
export async function getCogsHistory(input?: {
  days?: number; // default 14
}): Promise<ActionResult<{ history: CogsLive[] }>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;

  const n = Math.min(Math.max(input?.days ?? 14, 1), 90); // clamp 1–90
  const today = todaySast();
  const todayDate = new Date(today + "T00:00:00+02:00");

  const history: CogsLive[] = await Promise.all(
    Array.from({ length: n }, (_, i) => {
      const d = new Date(todayDate.getTime() - (n - 1 - i) * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      return computeCogsLive(dateStr);
    })
  );

  return { ok: true, data: { history } };
}
