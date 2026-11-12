// §9.6.2 job 9 — the 09:00 Yoco import reminder (REQ-067; job 6's "Who is
// told"; DEC-29, Mia, 12 Nov 2026).
//
// REQ-067: "When 09:00 [passes] with no import · Then an Admin push names the
// day and repeats daily until resolved." The import itself is the Admin's
// upload of Yoco's own export at /admin/reports (§11.2 importYocoTransactions,
// src/server/reconciliation/import.ts). THIS JOB FETCHES NOTHING FROM YOCO —
// there is no automatic fetch (§6.8.3) — and it imports nothing: it reads, and
// pushes the Admin.
//
// Which days need an export — an AUTHOR DEFAULT awaiting owner confirmation
// (DEC-29), narrowing REQ-067's "a completed revenue day": one of the last
// IMPORT_WATCH_DAYS completed revenue days that was a paid day — a Sunday by
// its date, or a day with a session that takes payment (an event whose posture
// is `standard` or `override`, sessionTakesPayment) — AND that has card
// activity in FAVO: a successful payment, or an attempt actually sent to the
// machine (sent_at or a Yoco payment id), for one of its orders or a fund
// top-up taken that day. An attempt never sent holds no money and does not
// count. A `yoco_deferred` order with no such payment does not count either
// (its sale, if any, is on the standalone machine). "Imported" is a
// `yoco_import` audit row for the day (a refused upload does not count). Days
// before the scheduler first started are not its to watch, as for the 06:00
// close watch (./close-watch.ts).
//
// Once a day: the gate refuses a second run for the same morning (its run row
// is the record), and refuses when nothing is missing, so a quiet morning
// writes no run row. Missed run: skip — tomorrow's 09:00 names the same days.

import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventWindows, openingSessions, orders, payments } from "@db/schema";
import { defaultSessionMode } from "@/lib/session-mode";
import { sessionTakesPayment } from "@/server/deferred/mode";
import { latestImports } from "@/server/reconciliation/read";
import { daysToHaveClosed } from "./close-watch";
import { sastDate } from "./schedule";
import { auditJobStore } from "./store";
import { pushAdmins } from "./alert";

export const YOCO_IMPORT_WATCH_JOB = "yocoImportWatch";
/** How many completed revenue days back the reminder looks (author default, DEC-29). */
export const IMPORT_WATCH_DAYS = 14;

export type DaySession = { sessionDate: string; mode: string | null; eventPaymentPosture: string | null };
/** One payment attempt and the revenue day it belongs to. */
export type DayPayment = { day: string; status: string; sent: boolean };

export type ImportWatchDeps = {
  firstStartedAt(): Promise<Date | null>;
  hasRun(job: string, period: string): Promise<boolean>;
  /** Every payment attempt on `days` (an order's revenue day, or a top-up's SAST day). */
  paymentsOn(days: string[]): Promise<DayPayment[]>;
  /** Every session on `days`, with its event window's payment posture. */
  sessionsOn(days: string[]): Promise<DaySession[]>;
  /** Days among `days` with a successful yoco_import audit row. */
  importedDays(days: string[]): Promise<Set<string>>;
  push(payload: string, label: string): Promise<void>;
};

const SAST_DAY_START = (day: string) => new Date(`${day}T00:00:00+02:00`);
const NEXT_DAY = (day: string) => new Date(SAST_DAY_START(day).getTime() + 24 * 60 * 60 * 1000);

const defaultDeps: ImportWatchDeps = {
  firstStartedAt: () => auditJobStore.firstStartedAt(),
  hasRun: (job, period) => auditJobStore.hasRun(job, period),
  async paymentsOn(days) {
    if (days.length === 0) return [];
    const cols = { status: payments.status, sentAt: payments.sentAt, yocoPaymentId: payments.yocoPaymentId };
    const sent = (r: { sentAt: Date | null; yocoPaymentId: string | null }) => r.sentAt !== null || r.yocoPaymentId !== null;
    const ofOrders = await db
      .select({ ...cols, day: orders.revenueDay })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(inArray(orders.revenueDay, days));
    // A fund top-up has no order: it belongs to the SAST day it was taken (as in T10).
    const topups = await db
      .select({ ...cols, at: payments.at })
      .from(payments)
      .where(and(
        isNotNull(payments.fundTopupId),
        gte(payments.at, SAST_DAY_START(days[0])),
        lt(payments.at, NEXT_DAY(days[days.length - 1])),
      ));
    const wanted = new Set(days);
    return [
      ...ofOrders.map((r) => ({ day: String(r.day), status: r.status, sent: sent(r) })),
      ...topups.map((r) => ({ day: sastDate(r.at), status: r.status, sent: sent(r) })).filter((r) => wanted.has(r.day)),
    ];
  },
  async sessionsOn(days) {
    if (days.length === 0) return [];
    return db
      .select({ sessionDate: openingSessions.sessionDate, mode: openingSessions.mode, eventPaymentPosture: eventWindows.paymentPosture })
      .from(openingSessions)
      .leftJoin(eventWindows, eq(openingSessions.eventWindowId, eventWindows.id))
      .where(inArray(openingSessions.sessionDate, days));
  },
  importedDays: async (days) => new Set((await latestImports(db, days)).keys()),
  push: pushAdmins,
};

/**
 * Days with card activity: a successful payment, or an attempt actually sent
 * to the machine. A never-sent attempt holds no money, so it never asks for an
 * export.
 */
export function cardActivityDays(rows: DayPayment[]): Set<string> {
  return new Set(rows.filter((r) => r.status === "successful" || r.sent).map((r) => r.day));
}

/** A paid day: a Sunday by its date, or any of its sessions takes payment. */
function isPaidDay(day: string, sessions: DaySession[]): boolean {
  if (defaultSessionMode(day) === "sunday") return true;
  return sessions.some((s) => s.sessionDate === day && sessionTakesPayment(s));
}

/** The pure decision: paid days with card activity and no import, oldest first. */
export function daysMissingImport(input: {
  days: string[];
  cardActivityDays: Set<string>;
  sessions: DaySession[];
  importedDays: Set<string>;
}): string[] {
  return input.days.filter(
    (d) => input.cardActivityDays.has(d) && !input.importedDays.has(d) && isPaidDay(d, input.sessions),
  );
}

// Author wording (DEC-29): the PRD gives no copy for this push.
export function buildMissingImportPayload(missing: string[]): string {
  const list = missing.length <= 3 ? missing.join(", ") : `${missing.slice(0, 3).join(", ")} and ${missing.length - 3} more`;
  return JSON.stringify({
    title: `Yoco export not uploaded — ${missing.length === 1 ? missing[0] : `${missing.length} days`}`,
    body: `Yoco export for ${list} has not been uploaded. Upload it at Admin › Reports.`,
    data: { missing, url: "/admin/reports" },
  });
}

async function findMissing(now: Date, deps: ImportWatchDeps): Promise<{ checked: number; missing: string[] }> {
  const firstStart = await deps.firstStartedAt();
  if (!firstStart) return { checked: 0, missing: [] };
  const days = daysToHaveClosed(firstStart, now).slice(-IMPORT_WATCH_DAYS);
  if (days.length === 0) return { checked: 0, missing: [] };
  const [paid, sessions, importedDays] = await Promise.all([
    deps.paymentsOn(days),
    deps.sessionsOn(days),
    deps.importedDays(days),
  ]);
  return { checked: days.length, missing: daysMissingImport({ days, cardActivityDays: cardActivityDays(paid), sessions, importedDays }) };
}

/** The scheduler gate: once per morning, and only when a day is missing its import. */
export async function shouldRunImportWatch(firedAt: Date, deps: ImportWatchDeps = defaultDeps): Promise<boolean> {
  if (await deps.hasRun(YOCO_IMPORT_WATCH_JOB, sastDate(firedAt))) return false;
  return (await findMissing(firedAt, deps)).missing.length > 0;
}

/** Push the Admins once, naming every paid day still missing its Yoco export. */
export async function checkMissingImports(
  now: Date = new Date(),
  deps: ImportWatchDeps = defaultDeps,
): Promise<{ checked: number; missing: string[] }> {
  const r = await findMissing(now, deps);
  if (r.missing.length > 0) await deps.push(buildMissingImportPayload(r.missing), YOCO_IMPORT_WATCH_JOB);
  return r;
}
