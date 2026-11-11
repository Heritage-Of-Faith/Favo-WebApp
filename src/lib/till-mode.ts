// The mode and event switches an order is rung under — pure, shared by the
// server (createOrder, deduction, offline replay) and the POS.
//
// PRD v7.0 §6.6, §6.0.8 (T7), L24, L25, L26, S7a, REQ-042, REQ-045, REQ-125.
//
// Which mode applies at an instant `at` on a revenue day:
//  1. An event in force: an opening session stored as mode='event' whose event
//     applies at `at` — from the session's opening, but at the earliest 30
//     minutes before the window starts, up to ends_at (DEC-28 (a); REQ-042). §6.6 precedence 2 —
//     an explicit event beats the date-derived mode, so the result is the
//     event's own switches, never Weekday's or Sunday's. Two events at once:
//     the newest window wins (DEC-28 (c)).
//  2. Otherwise every session of the day read as it behaves at `at`
//     (effectiveSessionMode): a stored event whose window is not in force reads
//     as the date default. So a Wednesday holding a weekday morning session and
//     a Discipleship 101 evening session is plain weekday at 09:00 and the
//     event at 19:00 — the day is no longer one mode (§6.11.1, COL-8).
//
// Not built here, and refused at open (session-mode.ts eventSwitchesInTill):
// payment_posture='override' (DEC-03 event prices) and menu_scope='custom'
// (no column holds the subset). If either ever reaches the till it fails
// closed: an override reads as standard prices, a custom scope sells nothing.

import { isCoffeeCategory } from "@/server/orders/discount";
import {
  EVENT_EARLY_BIND_MINUTES, effectiveSessionMode, isWindowInForce, newestWindowFirst, sastInstant,
  type EventSwitches, type MenuScope, type PaymentPosture, type SessionMode,
} from "@/lib/session-mode";

/** One opening_sessions row of the day, with its event window's switches if bound. */
export type TillSessionRow = {
  sessionDate: string;
  mode: SessionMode;
  /** opening_sessions.opens_at, SAST "HH:mm" — DEC-28 (a): a bound event applies from here. */
  opensAt?: string | null;
  window: (EventSwitches & {
    id: string; name: string; startsAt: string | Date; endsAt: string | Date;
    /** event_windows.created_at — DEC-28 (c): the newest window wins an overlap. */
    createdAt?: string | Date | null;
  }) | null;
};

/**
 * DEC-28 (a) (owner, Mia, 11 Nov 2026) / §4.2 "a session's default is computed
 * against that session's own window … an evening session opened at 17:45 for
 * an 18:00 service still finds it": a session stored as mode='event' and bound
 * to a window behaves as that event from its own opening — but never earlier
 * than EVENT_EARLY_BIND_MINUTES (30) before the window starts — up to (not
 * including) ends_at (REQ-042 unchanged). So a 07:00–20:00 Wednesday session
 * bound to an 18:00 paid event keeps its morning free cups and rings the
 * event from 17:30 (second review, B2). A row with no known opening falls
 * back to the window alone.
 */
export function eventAppliesAt(row: TillSessionRow, at: Date): boolean {
  if (row.mode !== "event" || row.window === null) return false;
  if (isWindowInForce(row.window, at)) return true;
  if (!row.opensAt) return false;
  let opened: number;
  try {
    opened = sastInstant(row.sessionDate, row.opensAt).getTime();
  } catch {
    return false; // an unreadable opening never widens an event
  }
  const earliest = Math.max(
    opened,
    new Date(row.window.startsAt).getTime() - EVENT_EARLY_BIND_MINUTES * 60 * 1000
  );
  const t = at.getTime();
  return earliest <= t && t < new Date(row.window.endsAt).getTime();
}

/** The event in force: its window id, name, span and six switches. */
export type TillEvent = EventSwitches & { windowId: string; name: string; startsAt: string; endsAt: string };

export type TillMode = {
  /** The modes in force at the instant — ["event"] while an event is in force. */
  modes: SessionMode[];
  event: TillEvent | null;
};

/** What the POS needs to draw the till for an event (no money, no ids beyond the name). */
export type TillEventView = { name: string; paymentPosture: PaymentPosture; menuScope: MenuScope };

export function resolveTillMode(rows: readonly TillSessionRow[], at: Date): TillMode {
  // DEC-28 (a): in force from the session's opening; (c): newest window wins.
  const inForce = rows
    .filter((r) => eventAppliesAt(r, at))
    .sort((a, b) => newestWindowFirst(a.window!, b.window!))[0];
  if (inForce && inForce.window) {
    const w = inForce.window;
    return {
      modes: ["event"],
      event: {
        windowId: w.id, name: w.name,
        startsAt: new Date(w.startsAt).toISOString(), endsAt: new Date(w.endsAt).toISOString(),
        menuScope: w.menuScope, paymentPosture: w.paymentPosture, consumesCupLid: w.consumesCupLid,
        audience: w.audience, extraShotSurcharge: w.extraShotSurcharge, voucherKinds: [...w.voucherKinds],
      },
    };
  }
  const modes = rows
    .map((r) => effectiveSessionMode(r, r.window, at))
    .filter((m): m is SessionMode => m !== null);
  return { modes, event: null };
}

/** L25 / REQ-045: a free-posture event — nobody pays, nothing goes to the machine. */
export function isEventFree(event: Pick<EventSwitches, "paymentPosture"> | null | undefined): boolean {
  return event?.paymentPosture === "free";
}

/**
 * §6.6 menu scope. `full` sells every item; `coffee_only` the coffee-category
 * items (the same category test as the weekday menu and the free cup, T06);
 * `custom` sells nothing until a subset can be stored. No event → no limit.
 */
export function menuScopeAllows(
  event: Pick<EventSwitches, "menuScope"> | null | undefined,
  category: string | null | undefined
): boolean {
  if (!event) return true;
  switch (event.menuScope) {
    case "full": return true;
    case "coffee_only": return isCoffeeCategory(category);
    default: return false;
  }
}

/** §6.0.8: MODE_FORBIDDEN's named reason — "Not on the Discipleship 101 menu" (PRD literal). */
export function offMenuScopeMessage(eventName: string): string {
  return `Not on the ${eventName} menu`;
}

/** L24 / L26: cups and lids follow the event's own switch; otherwise the mode. */
export function tillConsumesCupAndLid(till: TillMode): boolean {
  if (till.event) return till.event.consumesCupLid;
  return !(till.modes.length > 0 && till.modes.every((m) => m === "weekday"));
}

/**
 * §6.6 / L31 / T09: the extra-shot surcharge at an event is charged only when
 * its switch says so, and is inert under payment_posture='free'.
 */
export function eventSurchargeInForce(event: Pick<EventSwitches, "extraShotSurcharge" | "paymentPosture">): boolean {
  return event.extraShotSurcharge && event.paymentPosture !== "free";
}

export function tillEventView(event: TillEvent | null): TillEventView | null {
  return event ? { name: event.name, paymentPosture: event.paymentPosture, menuScope: event.menuScope } : null;
}
