"use server";

// AT-203: the blessing-fund server actions (PRD v7.0 §10.7, §11.2). Every one
// authorises a STAFF session first — barista or admin, or admin alone — so no
// customer session can reach a fund: not its balance, not its ledger, not a
// top-up (L44, REQ-160). The matrix:
//
//   createDonorFund · beginFundTender (+ send / poll / lookup) ·
//   drawFromDonorFund · readFundBalance · fundOptionsForOrder   barista ✔ admin ✔
//   topUpDonorFund (cash / EFT) · sweepDonorFund ·
//   addFundName · removeFundName                                 admin only
//
// The card top-up runs the UNCHANGED tender chain on the fund-top-up store.
// There is no action that records a tender result: the chain records only
// what the server itself read from Yoco (§10.2.1).

import { z } from "zod";
import { authorize } from "@/server/auth/guard";
import * as rules from "@/server/funds/funds";
import { getFundDeps, getTopupTenderDeps } from "@/server/funds/runtime";
import { pollTenderResult, resolveTenderByLookup, sendToTerminal, type LookupOutcome } from "@/server/tender/tender";
import type { PaymentStatus } from "@/server/tender/types";
import type { FundBalanceView, FundOptions } from "@/server/funds/funds";

type Failure = { ok: false; code: string; message: string; retryOffered?: boolean };
type Result<T> = { ok: true; data: T } | Failure;

const POS_ROLES = ["barista", "admin"] as const;
const ADMIN_ROLES = ["admin"] as const;

/**
 * §6.10.3 / §17: there is no deferred top-up — the screen says a gift can
 * wait. Replaces the chain's order copy, which points at deferred mode.
 */
const NO_TERMINAL_FOR_TOPUP = "A gift can wait: the card terminal is not available right now.";

function topupCopy<T extends { ok: boolean; code?: string; message?: string }>(r: T): T {
  return !r.ok && r.code === "TERMINAL_UNREACHABLE" ? { ...r, message: NO_TERMINAL_FOR_TOPUP } : r;
}
const INVALID: Failure = { ok: false, code: "VALIDATION", message: "Invalid input." };

const id = z.string().min(1);
const attempt = z.number().int().min(1);
const cents = z.number().int().positive();

async function staffActor(roles: readonly ("barista" | "admin")[]): Promise<{ ok: true; actor: rules.StaffActor } | Failure> {
  const auth = await authorize(...roles);
  if (!auth.ok) return auth;
  return { ok: true, actor: { kind: "staff", staffId: auth.session.id, role: auth.session.role } };
}

function strip<T extends { ok: true }>(r: T): Omit<T, "ok"> {
  const { ok: _ok, ...data } = r;
  return data;
}

export async function createDonorFund(input: rules.CreateFundInput): Promise<Result<{ fundId: string; code: string; displayName: string | null }>> {
  const a = await staffActor(POS_ROLES);
  if (!a.ok) return a;
  const parsed = z
    .object({
      displayName: z.string().max(80).nullish(),
      forSpecificPeople: z.boolean(),
      customerIds: z.array(id).max(50),
      donorCustomerId: id.nullish(),
      nonRefundableAcknowledged: z.boolean(),
      amountZar: cents,
    })
    .safeParse(input);
  if (!parsed.success) return INVALID;
  const r = await rules.createDonorFund(getFundDeps(), a.actor, parsed.data);
  return r.ok ? { ok: true, data: strip(r) } : r;
}

export async function beginFundTender(fundId: string, amountZar: number): Promise<Result<{ fundTopupId: string; attempt: number; clientReference: string; amountZar: number }>> {
  const a = await staffActor(POS_ROLES);
  if (!a.ok) return a;
  if (!id.safeParse(fundId).success || !cents.safeParse(amountZar).success) return INVALID;
  const r = await rules.beginFundTender(getFundDeps(), a.actor, fundId, amountZar);
  if (!r.ok) return topupCopy(r);
  return { ok: true, data: { fundTopupId: r.fundTopupId, attempt: r.attempt, clientReference: r.clientReference, amountZar: r.amountZar } };
}

export async function sendFundTopup(fundTopupId: string, n: number): Promise<Result<{ sentAt: string }>> {
  const a = await staffActor(POS_ROLES);
  if (!a.ok) return a;
  if (!id.safeParse(fundTopupId).success || !attempt.safeParse(n).success) return INVALID;
  const r = await sendToTerminal(getTopupTenderDeps(), a.actor, fundTopupId, n);
  if (!r.ok) return topupCopy(r);
  return { ok: true, data: { sentAt: r.sentAt.toISOString() } };
}

export async function pollFundTopup(fundTopupId: string, n: number): Promise<Result<{ status: PaymentStatus; fetchError: boolean }>> {
  const a = await staffActor(POS_ROLES);
  if (!a.ok) return a;
  if (!id.safeParse(fundTopupId).success || !attempt.safeParse(n).success) return INVALID;
  const r = await pollTenderResult(getTopupTenderDeps(), a.actor, fundTopupId, n);
  return r.ok ? { ok: true, data: { status: r.status, fetchError: r.fetchError === true } } : topupCopy(r);
}

/** S4's recovery for a top-up. Never sends a payment (REQ-008) — never by sending again (§6.10.3). */
export async function resolveFundTopupByLookup(fundTopupId: string): Promise<Result<{ attempts: LookupOutcome[] }>> {
  const a = await staffActor(POS_ROLES);
  if (!a.ok) return a;
  if (!id.safeParse(fundTopupId).success) return INVALID;
  const r = await resolveTenderByLookup(getTopupTenderDeps(), a.actor, fundTopupId);
  return r.ok ? { ok: true, data: { attempts: r.attempts } } : r;
}

export async function drawFromDonorFund(orderId: string, fundId: string): Promise<Result<{ fundId: string; amountZar: number; balanceAfterZar: number }>> {
  const a = await staffActor(POS_ROLES);
  if (!a.ok) return a;
  if (!id.safeParse(orderId).success || !id.safeParse(fundId).success) return INVALID;
  const r = await rules.drawFromDonorFund(getFundDeps(), a.actor, orderId, fundId);
  return r.ok ? { ok: true, data: { fundId: r.fundId, amountZar: r.amountZar, balanceAfterZar: r.balanceAfterZar } } : r;
}

/** The fund control: balance only (§6.10.5) — never the ledger, the draws or the names. */
export async function readFundBalance(fundId: string): Promise<Result<FundBalanceView>> {
  const a = await staffActor(POS_ROLES);
  if (!a.ok) return a;
  if (!id.safeParse(fundId).success) return INVALID;
  const view = await rules.readFundBalance(getFundDeps(), fundId);
  return view ? { ok: true, data: view } : { ok: false, code: "VALIDATION", message: "Fund not found." };
}

/** What the footer can offer for an order being rung (§6.10.6, REQ-164/169/170). */
export async function fundOptionsForOrder(input: { customerId: string | null; netZar: number }): Promise<Result<FundOptions>> {
  const a = await staffActor(POS_ROLES);
  if (!a.ok) return a;
  const parsed = z.object({ customerId: id.nullable(), netZar: z.number().int().min(0) }).safeParse(input);
  if (!parsed.success) return INVALID;
  return { ok: true, data: await rules.fundOptions(getFundDeps(), parsed.data) };
}

export async function topUpDonorFund(input: rules.TopUpInput): Promise<Result<{ entryId: string; balanceZar: number }>> {
  const a = await staffActor(ADMIN_ROLES);
  if (!a.ok) return a;
  const r = await rules.topUpDonorFund(getFundDeps(), a.actor, input);
  return r.ok ? { ok: true, data: strip(r) } : r;
}

export async function sweepDonorFund(fundId: string, reason: string): Promise<Result<{ entryId: string; sweptZar: number }>> {
  const a = await staffActor(ADMIN_ROLES);
  if (!a.ok) return a;
  if (!id.safeParse(fundId).success || typeof reason !== "string") return INVALID;
  const r = await rules.sweepDonorFund(getFundDeps(), a.actor, fundId, reason);
  return r.ok ? { ok: true, data: strip(r) } : r;
}

export async function addFundName(fundId: string, customerId: string): Promise<Result<undefined>> {
  const a = await staffActor(ADMIN_ROLES);
  if (!a.ok) return a;
  if (!id.safeParse(fundId).success || !id.safeParse(customerId).success) return INVALID;
  const r = await rules.addFundName(getFundDeps(), a.actor, fundId, customerId);
  return r.ok ? { ok: true, data: undefined } : r;
}

export async function removeFundName(fundId: string, customerId: string): Promise<Result<undefined>> {
  const a = await staffActor(ADMIN_ROLES);
  if (!a.ok) return a;
  if (!id.safeParse(fundId).success || !id.safeParse(customerId).success) return INVALID;
  const r = await rules.removeFundName(getFundDeps(), a.actor, fundId, customerId);
  return r.ok ? { ok: true, data: undefined } : r;
}
