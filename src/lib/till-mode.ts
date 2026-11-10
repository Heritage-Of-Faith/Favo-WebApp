// The mode and event switches an order is rung under — pure, shared by the
// server (createOrder, deduction, offline replay) and the POS.
//
// PRD v7.0 §6.6, §6.0.8 (T7), L24, L25, L26, S7a, REQ-042, REQ-045, REQ-125.
//
// Which mode applies at an instant `at` on a revenue day:
//  1. An event in force: an opening session stored as mode='event' whose event
//     window is in force at `at` (REQ-042: starts_at ≤ at < ends_at). §6.6
//     precedence 2 — an explicit event beats the date-derived mode, so the
//     result is the event's own switches, never Weekday's or Sunday's.
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
  effectiveSessionMode, isWindowInForce,
  type EventSwitches, type MenuScope, type PaymentPosture, type SessionMode,
} from "@/lib/session-mode";

/** One opening_sessions row of the day, with its event window's switches if bound. */
export type TillSessionRow = {
  sessionDate: string;
  mode: SessionMode;
  window: (EventSwitches & { id: string; name: string; startsAt: string | Date; endsAt: string | Date }) | null;
};

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
  const inForce = rows
    .filter((r) => r.mode === "event" && r.window !== null && isWindowInForce(r.window, at))
    .sort((a, b) => new Date(a.window!.startsAt).getTime() - new Date(b.window!.startsAt).getTime())[0];
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
