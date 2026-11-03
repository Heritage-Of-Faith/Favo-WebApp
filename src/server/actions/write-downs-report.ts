"use server";

// AT-209 — the /admin/write-downs read (§7.3.1, REQ-059, REQ-124). Admin only
// (§11.3 matrix: "/admin/write-downs" — admin ✔ only). Reads; writes nothing.

import { db } from "@/lib/db";
import { authorize } from "@/server/auth/guard";
import { revenueDay } from "@/lib/format";
import { listUnapprovedWriteOffDays } from "@/server/close/write-offs";
import {
  isCalendarDay,
  readActiveStaff,
  readWriteDowns,
  summarisePerBarista,
  weekContaining,
  type BaristaWriteDowns,
  type WriteDownRow,
} from "@/server/write-downs/summary";
import type { ActionResult } from "@/lib/types";

export type WriteDownsReport = {
  from: string;
  to: string;
  perBarista: BaristaWriteDowns[];
  rows: WriteDownRow[];
};

/**
 * Comps, write-offs and abandoned orders for the revenue days [from, to],
 * listed and summarised per barista. Defaults to the Monday–Sunday week
 * containing today (SAST).
 */
export async function getWriteDownsReport(
  input: { from?: string; to?: string } = {}
): Promise<ActionResult<WriteDownsReport>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const week = weekContaining(revenueDay());
  const from = input.from || week.from;
  const to = input.to || week.to;
  if (!isCalendarDay(from) || !isCalendarDay(to)) {
    return { ok: false, code: "INVALID_INPUT", message: "Dates are real calendar days, YYYY-MM-DD." };
  }
  if (from > to) {
    return { ok: false, code: "INVALID_INPUT", message: "The start date is after the end date." };
  }

  // §6.0.5: "Until cleared, the day's write-offs report as `unapproved`" — the
  // approval queue's own reader decides which days those are.
  const unapproved = new Set((await listUnapprovedWriteOffDays(db)).map((d) => d.revenueDay));
  const rows = await readWriteDowns(db, from, to, unapproved);
  const staff = await readActiveStaff(db);
  return { ok: true, data: { from, to, perBarista: summarisePerBarista(rows, staff), rows } };
}
