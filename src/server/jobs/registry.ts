// The scheduled-job register, as code (AT-169). PRD §9.6.2 is the register of
// record: a job absent from that table does not exist, and adding one here
// means adding a row there. Times are SAST.
//
// Wired today:   1 checkLowStock · 2 closeDaily · 3 generateWeeklyPnL
// Not yet:       5 the `collected` sweep (AT-194)
// Deferred:      4 unconfirmed-payment reconciliation, 6 importYocoTransactions,
//                7 donor-fund dormancy — Sunday/fund work, build-plan Day 11.

import { checkLowStock } from "@/server/crons/check-low-stock";
import { closeDaily } from "@/server/crons/close-daily";
import { generateWeeklyPnL, weekBounds } from "@/server/crons/generate-weekly-pnl";
import { sastDate, sastMiddayDaysBack, sastMinute } from "./schedule";
import type { JobDefinition } from "./scheduler";

/** A moment inside the revenue day that a 00:05 firing closes: the day before. */
const completedDay = (firedAt: Date) => sastMiddayDaysBack(firedAt, 1);
/** A moment inside the week a Monday 06:00 firing reports on: the week before. */
const completedWeek = (firedAt: Date) => sastMiddayDaysBack(firedAt, 7);

export const JOBS: JobDefinition[] = [
  {
    // §9.6.2 #1 — every 15 min. Missed run: skip; the next run sees the same
    // stock and alerts then. A catch-up would only re-send the same alert.
    name: "checkLowStock",
    cron: "*/15 * * * *",
    missedRun: "skip",
    periodFor: sastMinute,
    run: () => checkLowStock(),
  },
  {
    // §9.6.2 #2 — 00:05, closing the *completed* revenue day (not 23:55/23:59,
    // which cannot honour §10.6 for an order rung up at 23:57).
    // Catch-up and idempotence need a durable close record and belong to
    // AT-193; until then a missed 00:05 is skipped and visible in audit_log.
    name: "closeDaily",
    cron: "5 0 * * *",
    missedRun: "skip",
    periodFor: (firedAt) => sastDate(completedDay(firedAt)),
    run: (firedAt) => closeDaily(completedDay(firedAt)),
  },
  {
    // §9.6.2 #3 — Monday 06:00, for the completed Mon–Sun week. Catch-up on
    // startup; idempotent per week through weekly_reports.week_starting UNIQUE.
    name: "generateWeeklyPnL",
    cron: "0 6 * * 1",
    missedRun: "catchUp",
    periodFor: (firedAt) => weekBounds(completedWeek(firedAt)).weekStarting,
    run: (firedAt) => generateWeeklyPnL(completedWeek(firedAt)),
  },
];
