// Offline sync — apply a single outbox entry — task G20 (AT-61)
// Called by POST /api/sync/orders. Pure DB logic; no HTTP concerns here.
// Idempotency: keyed on outbox_log.client_uuid — duplicates return the stored result.
// LWW per order creation: an unknown/inactive menu item or a payment-amount
// mismatch (server total vs. client total) is rejected outright rather than
// silently accepted. (Deletion pass: this used to open a row in a dedicated
// conflict-tracking table for manager review; that tracking/resolution layer
// is gone — the outbox entry itself still records the receipt, just never
// gets applied.)
// Docs: docs/API.md · BUSINESS_RULES.md L01

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type DB } from "@/lib/db";
import {
  outboxLog,
  orders,
  orderItems,
  menuItems,
} from "@db/schema";
import { writeAudit } from "@/server/audit";
import { isFreeCupWeekday, weekdayLineDiscountZar } from "@/server/orders/free-coffee";
import { readTillMode } from "@/server/orders/till-mode-read";
import { isEventFree, type TillMode } from "@/lib/till-mode";
import { isPaidEventPosture } from "@/server/orders/payment-gate";
import { computeOrderTotalZar } from "@/server/orders/pricing";
import { shotSurchargeZar, type ShotPolicy } from "@/server/orders/shot-surcharge";
import { readShotPolicy, readCoffeeRecipeIds } from "@/server/orders/shot-policy";
import { revenueDay } from "@/lib/format";

// ─── Input schema ─────────────────────────────────────────────────────────────

export const outboxItemSchema = z.object({
  clientUuid: z.string().uuid("clientUuid must be a valid UUID"),
  staffId: z.string().min(1),
  customerId: z.string().optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().positive(),
        modifications: z.array(z.string()),
        // AT-202: the line's shot count. Absent (an entry queued before the
        // picker existed) = 1.
        shots: z.number().int().min(1).default(1),
      })
    )
    .min(1),
  paymentMode: z.enum(["yoco_deferred", "free"]),
  clientTotalZar: z.number().int().nonnegative(),
  clientTimestamp: z.string().datetime(),
});

export type OutboxItem = z.input<typeof outboxItemSchema>;

// ─── Result types ─────────────────────────────────────────────────────────────

export type ApplyOutboxResult =
  | { outcome: "applied"; orderId: string; serverTotalZar: number }
  | { outcome: "duplicate"; orderId: string | null; appliedAt: Date | null }
  | {
      outcome: "rejected";
      reason: "unknown_menu_item" | "amount_mismatch" | "shots_above_ceiling" | "shots_not_allowed" | "replay_too_old";
    };

// ─── The instant a replay's mode is read at (DEC-28) ─────────────────────────

/**
 * REQ-039 / T5 step 5: an outbox order more than 12 hours old at replay is
 * rejected (REPLAY_TOO_OLD) and surfaced on the admin exception list. Exactly
 * 12 hours is not "more than" and is applied.
 */
export const REPLAY_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** The audit action the admin exception list reads (src/server/actions/exceptions.ts). */
export const REPLAY_TOO_OLD_ACTION = "order.sync_rejected_too_old";

/** Age of an entry at receipt, in ms; null when the client time is absent or unreadable. */
function replayAgeMs(clientTimestamp: unknown, receivedAt: Date): number | null {
  if (typeof clientTimestamp !== "string") return null;
  const age = receivedAt.getTime() - new Date(clientTimestamp).getTime();
  return Number.isNaN(age) ? null : age;
}

/** REQ-039: more than 12 hours between the client's ring-up and the server's receipt. */
export function isReplayTooOld(clientTimestamp: unknown, receivedAt: Date): boolean {
  const age = replayAgeMs(clientTimestamp, receivedAt);
  return age !== null && age > REPLAY_MAX_AGE_MS;
}

/**
 * DEC-28 (owner, Mia, 11 Nov 2026): an offline order is priced under the mode
 * in force when it was RUNG — the entry's clientTimestamp — so a free event's
 * order replayed after the window ended stays free, and a paid one stays
 * owed. The server still decides what was in force at that instant from its
 * own sessions and windows; the till's own claim ('free') is never trusted. A
 * client time after the receipt, or unreadable, falls back to the receipt
 * time. (One more than 12 hours old never reaches here: applyOutboxItem
 * rejects it first, REQ-039; the age guard below stays as a backstop.) This instant
 * picks the mode and prices only: placed_at and the revenue day are always
 * the receipt (REQ-039).
 */
export function replayModeInstant(clientTimestamp: string | undefined, receivedAt: Date): Date {
  if (!clientTimestamp) return receivedAt;
  const rung = new Date(clientTimestamp);
  const age = receivedAt.getTime() - rung.getTime();
  if (Number.isNaN(age) || age < 0 || age > REPLAY_MAX_AGE_MS) return receivedAt;
  return rung;
}

/** The modes under which people pay: Sunday, or a paid-posture event (DEC-28 b). */
function isPaidTill(till: TillMode): boolean {
  if (till.event) return isPaidEventPosture(till.event.paymentPosture);
  return till.modes.includes("sunday");
}

function isFreeTill(till: TillMode, at: Date): boolean {
  return isFreeCupWeekday(till.modes, at) || isEventFree(till.event);
}

/**
 * The instant, and the mode, a replay is priced, stamped and deducted under.
 * DEC-28: the ring-up time when replayModeInstant accepts it. SAFE DEFAULT
 * (the owner has not ruled on this direction): the client's clock may never
 * turn a paid order free — if the mode at the client's time is free (weekday
 * or a free event) but the mode at receipt is a paid one (Sunday, or a
 * standard/override event in force), the receipt time is used. Paid at the
 * client's time stays paid whatever the receipt reads.
 */
async function replayTill(clientTimestamp: string | undefined, receivedAt: Date): Promise<{ modeAt: Date; till: TillMode }> {
  const candidate = replayModeInstant(clientTimestamp, receivedAt);
  const atCandidate = await readTillMode(db, revenueDay(candidate), candidate);
  if (candidate === receivedAt || !isFreeTill(atCandidate, candidate)) return { modeAt: candidate, till: atCandidate };
  const atReceipt = await readTillMode(db, revenueDay(receivedAt), receivedAt);
  return isPaidTill(atReceipt) ? { modeAt: receivedAt, till: atReceipt } : { modeAt: candidate, till: atCandidate };
}

// ─── applyOutboxItem ──────────────────────────────────────────────────────────

export async function applyOutboxItem(item: OutboxItem): Promise<ApplyOutboxResult> {
  // REQ-039: the server's receipt time decides the revenue day; DEC-28: the
  // ring-up time (bounded, see replayTill) decides the mode.
  const receivedAt = new Date();
  // ── Idempotency check ──────────────────────────────────────────────────────
  const [existing] = await db
    .select()
    .from(outboxLog)
    .where(eq(outboxLog.clientUuid, item.clientUuid));

  if (existing) {
    // REQ-039: a uuid already rejected as too old stays rejected on every
    // re-replay — decided from the stored receipt, no second audit row.
    const stored = existing.payload as { clientTimestamp?: unknown } | null | undefined;
    if (!existing.appliedAt && existing.receivedAt && isReplayTooOld(stored?.clientTimestamp, existing.receivedAt)) {
      return { outcome: "rejected", reason: "replay_too_old" };
    }
    // Already processed — return stored result without re-applying.
    const existingOrderId = await findOrderForOutboxEntry(existing.id);
    return { outcome: "duplicate", orderId: existingOrderId, appliedAt: existing.appliedAt };
  }

  // ── REQ-039 / T5 step 5: more than 12 hours old → REPLAY_TOO_OLD ──────────
  // Rejected, never silently accepted: no order, no order_items, no stock
  // movement. The receipt (appliedAt stays null, so the uuid is consumed) and
  // the audit row the admin exception list reads commit together.
  if (isReplayTooOld(item.clientTimestamp, receivedAt)) {
    const ageMs = replayAgeMs(item.clientTimestamp, receivedAt)!;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(outboxLog)
        .values({
          clientUuid: item.clientUuid,
          customerId: item.customerId,
          staffId: item.staffId,
          payload: item as unknown as Record<string, unknown>,
          receivedAt,
        })
        .returning({ id: outboxLog.id });
      await writeAudit(
        {
          actorId: item.staffId,
          actorRole: "barista",
          action: REPLAY_TOO_OLD_ACTION,
          entityKind: "outbox_log",
          entityId: row?.id ?? item.clientUuid,
          reason: "REPLAY_TOO_OLD",
          // No customer id: the exception list shows only what the till rang.
          after: {
            clientUuid: item.clientUuid,
            staffId: item.staffId,
            clientTimestamp: item.clientTimestamp,
            receivedAt: receivedAt.toISOString(),
            ageMs,
            clientTotalZar: item.clientTotalZar,
            paymentMode: item.paymentMode,
            items: item.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, shots: i.shots ?? 1 })),
          },
        },
        tx as unknown as DB
      );
    });
    return { outcome: "rejected", reason: "replay_too_old" };
  }

  // ── Write to outbox_log (before applying — so we record receipt even on failure) ─
  const [logEntry] = await db
    .insert(outboxLog)
    .values({
      clientUuid: item.clientUuid,
      customerId: item.customerId,
      staffId: item.staffId,
      payload: item as unknown as Record<string, unknown>,
    })
    .returning({ id: outboxLog.id });

  if (!logEntry) {
    return { outcome: "rejected", reason: "unknown_menu_item" };
  }

  // ── Resolve menu items and compute server-side total ───────────────────────
  const menuRows = await db
    .select({ id: menuItems.id, name: menuItems.name, currentPriceZar: menuItems.currentPriceZar, active: menuItems.active, recipeId: menuItems.recipeId })
    .from(menuItems)
    .where(inArray(menuItems.id, item.items.map((i) => i.menuItemId)));

  const menuById = new Map(menuRows.map((m) => [m.id, m]));

  // Verify all items exist and are active. Rejected outright — the outbox_log
  // row already recorded the receipt (appliedAt stays null).
  for (const reqItem of item.items) {
    const mi = menuById.get(reqItem.menuItemId);
    if (!mi || !mi.active) {
      return { outcome: "rejected", reason: "unknown_menu_item" };
    }
  }

  // DEC-28: the instant and mode this replay is priced, stamped and deducted
  // under — read once, when first needed (the shot ceiling, or the free test).
  let replay: Promise<{ modeAt: Date; till: TillMode }> | null = null;
  const getReplay = () => (replay ??= replayTill(item.clientTimestamp, receivedAt));

  // ── AT-202: shots — the same ceiling and surcharge createOrder applies ────
  // CHANGED (DEC-28): the mode is the one in force when the order was rung
  // (modeAt — the client's time, bounded by replayModeInstant), so the price
  // the till showed is the price checked. (A Sunday entry replayed more than
  // 12 hours later was already rejected above, REQ-039.) A line above the
  // ceiling is refused — never silently re-priced without the surcharge.
  // A 1-shot line cannot be affected, so the policy is read only
  // when a line carries more.
  const shotsOf = (i: OutboxItem["items"][number]) => i.shots ?? 1;
  let shotPolicy: ShotPolicy | null = null;
  const multiShot = item.items.filter((i) => shotsOf(i) > 1);
  if (multiShot.length > 0) {
    // L48: no coffee in the recipe, no extra shots (as createOrder refuses).
    const recipeOf = (id: string) => menuById.get(id)!.recipeId;
    const coffee = await readCoffeeRecipeIds(
      db,
      multiShot.map((i) => recipeOf(i.menuItemId)).filter((r): r is string => typeof r === "string")
    );
    if (multiShot.some((i) => { const r = recipeOf(i.menuItemId); return !(r && coffee.has(r)); })) {
      return { outcome: "rejected", reason: "shots_not_allowed" };
    }
    const { modeAt: shotsAt } = await getReplay();
    shotPolicy = await readShotPolicy(db, revenueDay(shotsAt), shotsAt);
    const policy = shotPolicy;
    if (item.items.some((i) => shotsOf(i) > policy.maxShots)) {
      return { outcome: "rejected", reason: "shots_above_ceiling" };
    }
  }
  const surchargeFor = (shots: number) =>
    shotPolicy ? shotSurchargeZar(shots, shotPolicy.extraShotZar, shotPolicy.surchargeInForce) : 0;

  const lines = item.items.map((i) => ({
    unitPriceZar: menuById.get(i.menuItemId)!.currentPriceZar,
    quantity: i.quantity,
    modifications: [],
    surchargeZar: surchargeFor(shotsOf(i)),
  }));
  const serverTotalZar = computeOrderTotalZar(lines);

  // ── Payment amount validation (LWW — server total is authoritative) ────────
  if (serverTotalZar !== item.clientTotalZar) {
    return { outcome: "rejected", reason: "amount_mismatch" };
  }

  // ── AT-212 / S7a: 'free' wins over deferred ────────────────────────────────
  // On the server's receipt day in weekday mode (mode='weekday' AND Mon–Fri
  // SAST, L03) nobody pays (L19): the order is written 'free' whatever the
  // client queued, every line zeroed by discount_zar (DEC-18), total R0 — so
  // the close never writes it off as a phantom loss (S3a).
  // The mode in force when the order was rung (DEC-28: modeAt, see
  // replayTill; src/lib/till-mode.ts): a Wednesday's evening event
  // does not make the morning's replays paid. S7a: 'free' also on a
  // free-posture event in force (L25) — the same zeroing, the same R0.
  const { modeAt, till } = await getReplay();
  const weekdayFree = isFreeTill(till, modeAt);
  const lineDiscountZar = (idx: number) => (weekdayFree ? weekdayLineDiscountZar(lines[idx]) : 0);
  const orderTotalZar = weekdayFree ? 0 : serverTotalZar;
  // The till's 'free' is never trusted: only the server's own weekday read
  // (or its own R0 total, REQ-153) makes an order free. A 'free' entry replayed
  // on any other day (an outage crossing into Saturday/Sunday, a paid event,
  // no session) is written as the paying mode — owed, at the server total,
  // and swept at the close (S3a) — so the money can never vanish.
  const paymentMode = weekdayFree || orderTotalZar === 0 ? "free" : "yoco_deferred";

  // ── Create the order ───────────────────────────────────────────────────────
  const orderId = crypto.randomUUID();

  await db.insert(orders).values({
    id: orderId,
    staffId: item.staffId,
    customerId: item.customerId ?? null,
    // L28: the target was bound at ring-up by attaching (or not) a customer;
    // the outbox payload carries that choice as customerId (PRD T1 step 2:
    // offline, the target is `none`). Matches the §10.3 CHECK.
    notificationTarget: item.customerId ? "customer" : "none",
    state: "ordered",
    totalZar: orderTotalZar,
    paymentMode,
    // REQ-039 / T5 step 4: the server's receipt time decides the revenue day
    // and placed_at, never the client's clock. The client-time instant only
    // picked the mode and prices, and is recorded in the sync_applied row.
    revenueDay: revenueDay(receivedAt),
    placedAt: receivedAt,
    // DEC-28 (d): the event the order was rung under, else NULL.
    eventWindowId: till.event?.windowId ?? null,
  });

  await db.insert(orderItems).values(
    item.items.map((i, idx) => ({
      orderId,
      menuItemId: i.menuItemId,
      quantity: i.quantity,
      unitPriceZar: menuById.get(i.menuItemId)!.currentPriceZar,
      modifications: i.modifications.map((id) => ({ id })),
      shots: shotsOf(i),
      // §6.6: the extra-shot surcharge is inert where nobody pays.
      surchargeZar: weekdayFree ? 0 : lines[idx].surchargeZar,
      ...(weekdayFree ? { discountZar: lineDiscountZar(idx) } : {}),
    }))
  );

  // Mark outbox entry as applied
  await db
    .update(outboxLog)
    .set({ appliedAt: new Date() })
    .where(eq(outboxLog.id, logEntry.id));

  await writeAudit({
    actorId: item.staffId,
    actorRole: "barista",
    action: "order.sync_applied",
    entityKind: "order",
    entityId: orderId,
    after: {
      clientUuid: item.clientUuid, paymentMode, totalZar: orderTotalZar,
      // DEC-28: what the mode was read at, always recorded.
      clientTimestamp: item.clientTimestamp, modeAt: modeAt.toISOString(),
      eventWindowId: till.event?.windowId ?? null,
    },
  });

  return { outcome: "applied", orderId, serverTotalZar: orderTotalZar };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function findOrderForOutboxEntry(outboxId: string): Promise<string | null> {
  // The outbox_log doesn't directly store the orderId, but we can find it
  // via the client_uuid in the order payload if needed. For the idempotent
  // response, we return null if we can't quickly find it.
  void outboxId;
  return null;
}
