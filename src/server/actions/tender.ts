"use server";

// AT-201 part 2b: the card-tender server actions (PRD v7.0 §11.2, T2 steps
// 3–5, S4). Barista or admin (§10.7: beginTender · sendToTerminal ·
// pollTenderResult · resolveTenderByLookup — barista ✔, admin ✔).
//
// There is NO recordTenderResult action. The chain records a result only from
// what the server itself read from Yoco, inside pollTenderResult and
// resolveTenderByLookup (§10.2.1: exactly two paths write status='successful';
// a client-supplied result would be a human assertion creating revenue).
//
// Every refusal comes back as { ok: false, code, message } with §6.0.1's codes.
// GATEWAY_UNAVAILABLE carries retryOffered: true — the one failure where a new
// attempt is safe to offer (REQ-010); PAYMENT_UNKNOWN never does.

import { z } from "zod";
import { authorize } from "@/server/auth/guard";
import { lookupTender, pollTender, sendTender, startTender, type OpenAttempt } from "@/server/tender/service";
import type { LookupOutcome } from "@/server/tender/tender";
import type { PaymentStatus, TenderActor } from "@/server/tender/types";

const POS_ROLES = ["barista", "admin"] as const;

export type TenderActionFailure = {
  ok: false;
  code: string;
  message: string;
  retryOffered?: boolean;
  openAttempt?: OpenAttempt;
};
export type TenderActionResult<T> = { ok: true; data: T } | TenderActionFailure;

const orderIdSchema = z.string().min(1);
const attemptSchema = z.number().int().min(1);
const INVALID = { ok: false as const, code: "VALIDATION", message: "Invalid tender input." };

async function actor(): Promise<{ ok: true; actor: TenderActor } | TenderActionFailure> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  return { ok: true, actor: { kind: "staff", staffId: auth.session.id, role: auth.session.role } };
}

/** T2 step 3. Allocates the attempt; writes the pending row before any send. */
export async function beginTender(
  orderId: string
): Promise<TenderActionResult<{ attempt: number; clientReference: string; amountZar: number }>> {
  const a = await actor();
  if (!a.ok) return a;
  if (!orderIdSchema.safeParse(orderId).success) return INVALID;
  const r = await startTender(a.actor, orderId);
  if (!r.ok) return r;
  return { ok: true, data: { attempt: r.attempt, clientReference: r.clientReference, amountZar: r.amountZar } };
}

/** T2 step 4. Sends once; a second call for the same attempt is VALIDATION, never a re-send. */
export async function sendToTerminal(
  orderId: string,
  attempt: number
): Promise<TenderActionResult<{ sentAt: string }>> {
  const a = await actor();
  if (!a.ok) return a;
  if (!orderIdSchema.safeParse(orderId).success || !attemptSchema.safeParse(attempt).success) return INVALID;
  const r = await sendTender(a.actor, orderId, attempt);
  if (!r.ok) return r;
  return { ok: true, data: { sentAt: r.sentAt.toISOString() } };
}

/** T2 step 5. One status fetch per call; the screen drives S2's schedule. */
export async function pollTenderResult(
  orderId: string,
  attempt: number
): Promise<TenderActionResult<{ status: PaymentStatus; fetchError: boolean }>> {
  const a = await actor();
  if (!a.ok) return a;
  if (!orderIdSchema.safeParse(orderId).success || !attemptSchema.safeParse(attempt).success) return INVALID;
  const r = await pollTender(a.actor, orderId, attempt);
  if (!r.ok) return r;
  return { ok: true, data: { status: r.status, fetchError: r.fetchError === true } };
}

/** S4's recovery from the settlement screen. Never sends a payment (REQ-008). */
export async function resolveTenderByLookup(
  orderId: string
): Promise<TenderActionResult<{ attempts: LookupOutcome[] }>> {
  const a = await actor();
  if (!a.ok) return a;
  if (!orderIdSchema.safeParse(orderId).success) return INVALID;
  const r = await lookupTender(a.actor, orderId);
  if (!r.ok) return r;
  return { ok: true, data: { attempts: r.attempts } };
}
