// AT-187 · REQ-125 · L24 — cup and lid deduction follows the mode.
//
// L24: "Cup and lid deduction follows the mode. Excluded on weekday orders;
// included on Sunday orders; per the event's `consumes_cup_lid` switch on
// event orders." PRD §4 mode table: weekday is "Own mugs — no cup/lid cost".
// §10.5(2): deduction reads "the mode from the day's `opening_sessions` row".
//
// A cup or a lid is an inventory item of kind 'packaging'. Every packaging
// item that exists is one (seed: inv_item_cup_8oz, inv_item_cup_12oz,
// inv_item_lid) and no code path creates inventory items outside the seed.
//
// Event mode: `consumes_cup_lid` lives on event_windows, which is not built
// yet, so an event day deducts cup and lid exactly as before this change. When
// event_windows lands, read its switch here instead.
//
// The mode rule matches the L03 free cup's session check
// (free-coffee.ts isFreeCupWeekday): a day is a weekday only when it has at
// least one opening session and every one of them is mode='weekday'. No
// session, or a day mixing weekday with event/sunday, is not a weekday.
// Unlike the free cup this does not also test the calendar date (L24 follows
// the mode); today the session mode is set from the date, so the two agree.
// Known limit: the mode is read per day, not per order (orders carry no
// session link), so a mixed day deducts cups and lids for every order.

import { eq } from "drizzle-orm";
import { openingSessions } from "@db/schema";
import type { DB } from "@/lib/db";

/** The inventory kind that holds cups and lids. */
export const CUP_LID_KIND = "packaging";

export function isCupOrLid(kind: string | null | undefined): boolean {
  return kind === CUP_LID_KIND;
}

/** False only when the day's sessions are all mode='weekday' (L24). */
export function consumesCupAndLid(modes: readonly string[]): boolean {
  return !(modes.length > 0 && modes.every((m) => m === "weekday"));
}

/** Reads the day's opening_sessions modes and applies consumesCupAndLid. */
export async function dayConsumesCupAndLid(
  day: string,
  executor: Pick<DB, "select">
): Promise<boolean> {
  const rows = await executor
    .select({ mode: openingSessions.mode })
    .from(openingSessions)
    .where(eq(openingSessions.sessionDate, day));
  return consumesCupAndLid(rows.map((r) => r.mode));
}
