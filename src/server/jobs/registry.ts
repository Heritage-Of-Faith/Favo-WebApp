// The scheduled-job register, as code (AT-169). PRD §9.6.2 is the register of
// record: a job absent from that table does not exist, and adding one here
// means adding a row there. Times are SAST.
//
// Wired today:   1 checkLowStock · 2 closeDaily (+ its 06:00 missing-close
//                alert) · 3 generateWeeklyPnL · 4 unconfirmed-payment
//                reconciliation (paid days + carry-over, DEC-27) · 5 the
//                `collected` sweep
// Deferred:      6 importYocoTransactions, 7 donor-fund dormancy — Sunday/fund
//                work, build-plan Day 11.

import { checkLowStock } from "@/server/crons/check-low-stock";
import { closeDaily, closedDays } from "@/server/crons/close-daily";
import { sweepCollected } from "@/server/crons/collected-sweep";
import { hasWeeklyReport, weekBounds } from "@/server/crons/generate-weekly-pnl";
import { runWeeklyPnLJob } from "@/server/crons/weekly-pnl-job";
import { reconcileUnconfirmedPayments, shouldRunUnconfirmedPayments } from "@/server/crons/unconfirmed-payments";
import { checkMissingCloses } from "./close-watch";
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
    // which cannot honour §10.6 for an order rung up at 23:57). Catch-up on
    // startup for every unclosed day, oldest first (AT-193). "Done" is the
    // day's close record, not a run row, so a failed close is caught up too;
    // closeDaily itself is idempotent per day.
    name: "closeDaily",
    cron: "5 0 * * *",
    missedRun: "catchUp",
    periodFor: (firedAt) => sastDate(completedDay(firedAt)),
    isDone: async (day) => (await closedDays([day])).has(day),
    run: (firedAt, late) => closeDaily(completedDay(firedAt), { wasCatchUp: late }),
  },
  {
    // §9.6.2 #2, "Who is told" — 06:00: one Admin push naming every revenue
    // day still unclosed, repeated each morning until closed (AT-193). Part of
    // job 2, not a register row of its own. Skipped when missed: tomorrow's
    // 06:00 reports the same days.
    name: "closeDailyWatch",
    cron: "0 6 * * *",
    missedRun: "skip",
    periodFor: sastDate,
    run: (firedAt) => checkMissingCloses(firedAt),
  },
  {
    // §9.6.2 #3 — Monday 06:00, for the completed Mon–Sun week. Catch-up on
    // startup; idempotent per week through weekly_reports.week_starting UNIQUE.
    // Done means the week's report exists, so a failed week is caught up at
    // the next startup rather than counting as attempted.
    name: "generateWeeklyPnL",
    cron: "0 6 * * 1",
    missedRun: "catchUp",
    periodFor: (firedAt) => weekBounds(completedWeek(firedAt)).weekStarting,
    isDone: (weekStarting) => hasWeeklyReport(weekStarting),
    // AT-206: the run also pushes REQ-123's "for week ending …" (Admin only
    // when late); see weekly-pnl-job.ts.
    run: (firedAt, late) => runWeeklyPnLJob(completedWeek(firedAt), late),
  },
  {
    // §9.6.2 #4 — every 15 min. Missed run: "Skip, and the ageing does not
    // reset" — every run ages from payments.at, so a gap delays the 30-minute
    // Admin push and never cancels it. Looks payments up through
    // resolveTenderByLookup only; never sends, never writes payments itself.
    // DEC-27 (Mia, 10 Nov 2026): acts only on a paid day — a Sunday, or an
    // event session with a paying posture — and on attempts carried over from
    // one until resolved. Any other firing is gated off and writes nothing,
    // not even a run row.
    name: "unconfirmedPayments",
    cron: "*/15 * * * *",
    missedRun: "skip",
    periodFor: sastMinute,
    runsAt: (firedAt) => shouldRunUnconfirmedPayments(firedAt),
    run: () => reconcileUnconfirmedPayments(),
  },
  {
    // §9.6.2 #5 — every 5 min, `ready` → `collected` 20 min after completed_at
    // (S7). Missed run: skip; ageing is from completed_at, so the next run
    // sweeps everything eligible (AT-194).
    name: "collectedSweep",
    cron: "*/5 * * * *",
    missedRun: "skip",
    periodFor: sastMinute,
    run: (firedAt) => sweepCollected(firedAt),
  },
];
