"use server";

// COGS server actions — task G13 (real implementations)
// getCogsLive:    queries v_daily_revenue + v_daily_cogs + v_daily_expenses.
// getCogsHistory: returns N past SAST days for the sparkline tile in A7.
// Both: admin/owner only. Cache-Control: no-store.
// Docs: FAVO_PRD_v3.md §04 §07 · BUSINESS_RULES.md L07

import { authorize } from "@/server/auth/guard";
import { getCogsLive as computeCogsLive, todaySast } from "@/server/cogs/compute";
import { readMarginByShot, type ShotMarginRow } from "@/server/cogs/period-cogs";
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

// ─── getMarginByShot ──────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * AT-208 · REQ-139: margin broken out by shot count over SAST revenue days
 * from..to inclusive (each defaults to today). Admin only.
 */
export async function getMarginByShot(input?: {
  from?: string;
  to?: string;
}): Promise<ActionResult<{ from: string; to: string; rows: ShotMarginRow[] }>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;

  const today = todaySast();
  const from = input?.from && DATE_RE.test(input.from) ? input.from : today;
  const to = input?.to && DATE_RE.test(input.to) ? input.to : today;
  const rows = await readMarginByShot(from, to);
  return { ok: true, data: { from, to, rows } };
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

  // clamp 1–180: the dashboard asks for 2 × its range (max 90d) to compare
  // a window with the equal-length window before it.
  const n = Math.min(Math.max(input?.days ?? 14, 1), 180);
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
