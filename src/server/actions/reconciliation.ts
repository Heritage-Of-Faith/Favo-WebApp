"use server";

// T10 / §11.2 importYocoTransactions — the Admin's upload of Yoco's own
// transaction export at /admin/reports (PRD v7.0 §6.8.3: "uploaded by an Admin
// at /admin/reports. There is no automatic fetch"), and T10's exception list.
//
// Admin only (§10.7). The file's text is parsed in memory and never stored;
// what is kept is the import's summary on its audit_log row. No customer data
// is read or returned. Nothing here writes payments.status, and
// confirmNoYocoPayment writes only an audit row.

import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/server/auth/guard";
import { revenueDay as sastDay } from "@/lib/format";
import { importYocoTransactions, type ImportSummary } from "@/server/reconciliation/import";
import { createDrizzleImportStore } from "@/server/reconciliation/drizzle-store";
import { openUnresolvedWriteOffs, readT10View } from "@/server/reconciliation/read";
import {
  MIN_CONFIRM_REASON_LENGTH,
  T10_CONFIRMED_NO_PAYMENT_ACTION,
  T10_CONFIRM_REFUSED_ACTION,
  type T10View,
} from "@/server/reconciliation/t10-view";
import { writeAudit } from "@/server/audit";
import { MAX_EXPORT_BYTES } from "@/server/reconciliation/yoco-export";
import type { ActionResult } from "@/lib/types";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

/** T10 for one revenue day, plus every open `unresolved_at_close` write-off (REQ-034). */
export async function getT10(revenueDay: string): Promise<ActionResult<T10View>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  if (!daySchema.safeParse(revenueDay).success) {
    return { ok: false, code: "INVALID_INPUT", message: "A revenue day is YYYY-MM-DD." };
  }
  return { ok: true, data: await readT10View(db, revenueDay) };
}
