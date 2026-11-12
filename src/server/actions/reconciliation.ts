"use server";

// T10 / §11.2 importYocoTransactions — the Admin's upload of Yoco's own
// transaction export at /admin/reports (PRD v7.0 §6.8.3: "uploaded by an Admin
// at /admin/reports. There is no automatic fetch"), and T10's exception list.
//
// Admin only (§10.7). The file's text is parsed in memory and never stored;
// what is kept is the import's summary on its audit_log row. No customer data
// is read or returned. Nothing here writes payments.status;
// confirmNoYocoPayment and recordYocoPayout write only an audit row, and
// clearTipVariance writes an audit row and then the withheld fee/receipt.

import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/server/auth/guard";
import { revenueDay as sastDay } from "@/lib/format";
import { importYocoTransactions, type ImportSummary } from "@/server/reconciliation/import";
import {
  createDrizzleImportStore,
  createDrizzleTipClearStore,
  settledCardPaymentsOfDay,
} from "@/server/reconciliation/drizzle-store";
import { openUnresolvedWriteOffs, readPayoutLines, readT10Config, readT10View } from "@/server/reconciliation/read";
import { clearTipVariance as clearTip } from "@/server/reconciliation/tip-clear";
import {
  YOCO_PAYOUT_ACTION,
  YOCO_PAYOUT_ENTITY,
  YOCO_PAYOUT_VARIANCE_CONFIRMED_ACTION,
  YOCO_PAYOUT_VARIANCE_CONFIRM_REFUSED_ACTION,
  payoutCheck,
  payoutEntityId,
  type PayoutCheck,
  type PayoutRecord,
} from "@/server/reconciliation/payout";
import {
  MIN_CONFIRM_REASON_LENGTH,
  T10_CONFIRMED_NO_PAYMENT_ACTION,
  T10_CONFIRM_REFUSED_ACTION,
  type T10View,
} from "@/server/reconciliation/t10-view";
import { writeAudit } from "@/server/audit";
import { MAX_EXPORT_BYTES, parseCents } from "@/server/reconciliation/yoco-export";
import type { ActionResult } from "@/lib/types";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_DEVICE_ID_LENGTH = 100;

/** Upload one revenue day's Yoco export. Only a completed revenue day (§9.6.2 job 6). */
export async function uploadYocoExport(revenueDay: string, csvText: string): Promise<ActionResult<ImportSummary>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  if (!daySchema.safeParse(revenueDay).success) {
    return { ok: false, code: "INVALID_INPUT", message: "Pick the revenue day the export is for." };
  }
  if (revenueDay >= sastDay(new Date())) {
    return { ok: false, code: "INVALID_INPUT", message: "Only a completed revenue day can be imported — today is not over yet." };
  }
  if (typeof csvText !== "string" || csvText.trim() === "") {
    return { ok: false, code: "INVALID_INPUT", message: "The file is empty." };
  }
  if (new TextEncoder().encode(csvText).length > MAX_EXPORT_BYTES) {
    return { ok: false, code: "INVALID_INPUT", message: `The file is larger than ${MAX_EXPORT_BYTES / 1024} KB.` };
  }
  const r = await importYocoTransactions(createDrizzleImportStore(db), {
    revenueDay,
    csvText,
    uploadedByStaffId: auth.session.id,
    now: new Date(),
  });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  return { ok: true, data: r.summary };
}

/**
 * REQ-034: an Admin confirms Yoco holds no payment for an `unresolved_at_close`
 * write-off — the only way such an item closes (a CSV's missing row never
 * closes it). Needs a reason of at least 3 characters. Writes one audit row
 * (t10_confirmed_no_payment, actor = the Admin) and nothing else: no order or
 * payment changes. Refused for an order that is not an open item on that day,
 * and the refusal is audited.
 */
export async function confirmNoYocoPayment(
  orderId: string,
  revenueDay: string,
  reason: string
): Promise<ActionResult<{ orderId: string }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const why = typeof reason === "string" ? reason.trim() : "";
  if (typeof orderId !== "string" || orderId === "" || !daySchema.safeParse(revenueDay).success) {
    return { ok: false, code: "INVALID_INPUT", message: "Pick the written-off order and its revenue day." };
  }
  if (why.length < MIN_CONFIRM_REASON_LENGTH) {
    return { ok: false, code: "INVALID_INPUT", message: "Say how you confirmed it (at least 3 characters)." };
  }
  const actor = { actorId: auth.session.id, actorRole: auth.session.role };
  const items = await openUnresolvedWriteOffs(db);
  const item = items.find((w) => w.orderId === orderId && w.revenueDay === revenueDay);
  if (!item || item.confirmedNoPayment) {
    await writeAudit({
      entityKind: "order",
      entityId: orderId,
      action: T10_CONFIRM_REFUSED_ACTION,
      ...actor,
      reason: item ? "already_confirmed" : "not_an_open_unresolved_write_off",
      after: { revenueDay },
    });
    return { ok: false, code: "NOT_FOUND", message: "That order is not an open write-off on that day." };
  }
  await writeAudit({
    entityKind: "order",
    entityId: orderId,
    action: T10_CONFIRMED_NO_PAYMENT_ACTION,
    ...actor,
    reason: why,
    after: { revenueDay, totalZar: item.totalZar, yocoPaymentIds: item.yocoPaymentIds },
  });
  return { ok: true, data: { orderId } };
}

/**
 * DEC-17 / REQ-120: an Admin clears a tip variance on T10. The Admin's review
 * is recorded first (audit t10_tip_cleared, actor = the Admin, a reason of at
 * least 3 characters); only then are the payment's withheld fee_zar /
 * receipt_no written, only where NULL. Never payments.status; the tip is never
 * stored. A refusal is audited (t10_tip_clear_refused).
 */
export async function clearTipVariance(
  paymentId: string,
  revenueDay: string,
  reason: string
): Promise<ActionResult<{ paymentId: string; written: boolean }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const why = typeof reason === "string" ? reason.trim() : "";
  if (typeof paymentId !== "string" || paymentId === "" || !daySchema.safeParse(revenueDay).success) {
    return { ok: false, code: "INVALID_INPUT", message: "Pick the tip row and its revenue day." };
  }
  if (why.length < MIN_CONFIRM_REASON_LENGTH) {
    return { ok: false, code: "INVALID_INPUT", message: "Say what you checked (at least 3 characters)." };
  }
  // The day's import is read inside the clear's own transaction, after the
  // payment row is locked (./tip-clear.ts), never before it.
  return clearTip(createDrizzleTipClearStore(db), {
    paymentId,
    revenueDay,
    reason: why,
    actor: { actorId: auth.session.id, actorRole: auth.session.role },
  });
}

/**
 * REQ-120: the Admin enters Yoco's payout for a completed revenue day and one
 * device (blank → the configured webpos_device_id). FAVO checks it against
 * Σ (charged − fee) over that day's settled card payments on that device and
 * records the payout on an audit row (entity 'yoco_payout', id = day:device) —
 * never as a payment. Rands are read as text into integer cents; no float.
 */
export async function recordYocoPayout(
  revenueDay: string,
  deviceId: string,
  amountRands: string
): Promise<ActionResult<PayoutCheck>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  if (!daySchema.safeParse(revenueDay).success) {
    return { ok: false, code: "INVALID_INPUT", message: "Pick the revenue day the payout is for." };
  }
  if (revenueDay >= sastDay(new Date())) {
    return { ok: false, code: "INVALID_INPUT", message: "Only a completed revenue day can be checked — today is not over yet." };
  }
  const amount = parseCents(typeof amountRands === "string" ? amountRands : "");
  if (!amount.ok) {
    return { ok: false, code: "INVALID_INPUT", message: "Type the payout in rands, e.g. 340.73." };
  }
  let device = typeof deviceId === "string" ? deviceId.trim() : "";
  if (device === "") device = (await readT10Config(db)).webposDeviceId ?? "";
  if (device === "" || device.length > MAX_DEVICE_ID_LENGTH) {
    return { ok: false, code: "INVALID_INPUT", message: "No card machine is configured. Type the device id." };
  }
  const check = payoutCheck(amount.cents, await settledCardPaymentsOfDay(db, revenueDay), device);
  const record: PayoutRecord = {
    version: 1,
    revenueDay,
    deviceId: device,
    payoutZar: amount.cents,
    enteredByStaffId: auth.session.id,
    checkAtEntry: check,
  };
  await writeAudit({
    entityKind: YOCO_PAYOUT_ENTITY,
    entityId: payoutEntityId(revenueDay, device),
    action: YOCO_PAYOUT_ACTION,
    actorId: auth.session.id,
    actorRole: auth.session.role,
    after: record,
  });
  return { ok: true, data: check };
}

/**
 * REQ-120: an Admin closes a payout variance with an explanation (reason of at
 * least 3 characters). Writes one audit row (yoco_payout_variance_confirmed,
 * actor = the Admin) carrying the figures it confirms — payout, charges less
 * fees, difference — and never a tip figure (DEC-17). The line is closed only
 * by that row, and only while the figures stay the same. Refusals are audited.
 */
export async function confirmPayoutVariance(
  revenueDay: string,
  deviceId: string,
  reason: string
): Promise<ActionResult<{ deviceId: string }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const why = typeof reason === "string" ? reason.trim() : "";
  const device = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!daySchema.safeParse(revenueDay).success || device === "" || device.length > MAX_DEVICE_ID_LENGTH) {
    return { ok: false, code: "INVALID_INPUT", message: "Pick the payout line: its day and card machine." };
  }
  if (why.length < MIN_CONFIRM_REASON_LENGTH) {
    return { ok: false, code: "INVALID_INPUT", message: "Say what explains the difference (at least 3 characters)." };
  }
  const actor = { actorId: auth.session.id, actorRole: auth.session.role };
  const entityId = payoutEntityId(revenueDay, device);
  const { lines } = await readPayoutLines(db, revenueDay);
  const line = lines.find((l) => l.check.deviceId === device);
  const refusal = !line ? "no_payout_entered" : line.check.state !== "variance" ? "not_a_variance" : !line.open ? "already_confirmed" : null;
  if (refusal !== null || !line || line.check.state !== "variance") {
    await writeAudit({
      entityKind: YOCO_PAYOUT_ENTITY,
      entityId,
      action: YOCO_PAYOUT_VARIANCE_CONFIRM_REFUSED_ACTION,
      ...actor,
      reason: refusal ?? "not_a_variance",
      after: { revenueDay, deviceId: device },
    });
    return { ok: false, code: "NOT_FOUND", message: "There is no open payout difference for that day and card machine." };
  }
  const { payoutZar, expectedZar, differenceZar } = line.check;
  await writeAudit({
    entityKind: YOCO_PAYOUT_ENTITY,
    entityId,
    action: YOCO_PAYOUT_VARIANCE_CONFIRMED_ACTION,
    ...actor,
    reason: why,
    after: { revenueDay, deviceId: device, payoutZar, expectedZar, differenceZar },
  });
  return { ok: true, data: { deviceId: device } };
}

/** T10 for one revenue day, plus every open `unresolved_at_close` write-off (REQ-034). */
export async function getT10(revenueDay: string): Promise<ActionResult<T10View>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  if (!daySchema.safeParse(revenueDay).success) {
    return { ok: false, code: "INVALID_INPUT", message: "A revenue day is YYYY-MM-DD." };
  }
  return { ok: true, data: await readT10View(db, revenueDay) };
}
