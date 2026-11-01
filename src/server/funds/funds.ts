// AT-203: the blessing fund's rules (PRD v7.0 §6.10, §11.2, L44–L47,
// REQ-160…177). Money OUT first, then money IN.
//
//   drawFromDonorFund   a tender, not a discount (L47). Locks the order, then
//                       the fund row (SELECT … FOR UPDATE), computes the balance
//                       from the ledger, writes ONE spend entry and
//                       orders.payment_mode='donor_fund'. Never touches payments.
//   compensateFundDraw  cancelOrder's compensating `adjustment` (REQ-168). The
//                       spend entry is never edited — the ledger is append-only.
//   createDonorFund     issues the FVO- code, records the non-refundability
//                       acknowledgement (L45), links the names; an unnamed fund
//                       pushes the Admin and never blocks (R22, REQ-176).
//   beginFundTender     the counter card top-up: T13 checked BEFORE anything
//                       reaches the machine (R23, REQ-175); a pending top_up
//                       entry and its payments row (fund_topup_id) through the
//                       UNCHANGED tender chain. The money counts only once that
//                       payment is `successful` (REQ-173) — and only the chain's
//                       two writers ever set that status (§10.2.1).
//   topUpDonorFund      the Admin's cash/EFT path. VALIDATION and nothing
//                       written without a method and a reference (REQ-161).
//   sweepDonorFund      the Admin moves a dormant balance to ministry income.
//                       Never a job (§12.3, REQ-177).
//
// There is NO path here by which a customer adds money: every function takes a
// staff actor, and the server actions authorise barista/admin first (L44).
// Refusals are RETURNED (not thrown) so their audit row commits — except where
// the PRD says a refusal "writes nothing" (REQ-161), which is honoured.

import { beginTender, isAttemptOpen } from "@/server/tender/tender";
import type { BeginTenderOk } from "@/server/tender/tender";
import type { PaymentStatus, TenderFailure } from "@/server/tender/types";
import { formatZar } from "@/lib/format";
import type {
  DonorFund,
  FundAudit,
  FundConfig,
  FundDeps,
  FundEntry,
  FundErrorCode,
  FundFailure,
  FundingMethod,
  FundTx,
} from "./types";

export type StaffActor = { kind: "staff"; staffId: string; role: string };

/** §6.10.3: 31 symbols — no 0/O, no 1/I/L. */
export const FUND_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const FUND_CODE_RE = /^FVO-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const CODE_TRIES = 25;
const DAY_MS = 86_400_000;

export const FUND_COPY = {
  FUND_NOT_LINKED: "This fund is for a set group — they're not on it",
  TENDER_IN_PROGRESS: "This order is at the card machine — finish or cancel the payment first",
  TOPUP_IN_PROGRESS: "A top-up on this fund is at the card machine — finish it first",
  ALREADY_RESOLVED: "Already paid — do not charge again",
} as const;

// ─── the ledger, read ─────────────────────────────────────────────────────────

/** A card top-up whose payment may still succeed: an attempt is pending, or sent and unresolved. */
export function isOpenTopup(e: FundEntry): boolean {
  return e.kind === "top_up" && e.fundingMethod === "card" && !isCardTopupSettled(e) && e.topupPayments.some(isAttemptOpen);
}

function isCardTopupSettled(e: FundEntry): boolean {
  return e.topupPayments.some((p) => p.status === "successful");
}

/**
 * §10.3: "A top_up entry contributes to the balance only while its payment is
 * successful — a pending or unresolved one is visible on the fund and worth
 * zero." A cash/EFT top-up has no payment; its proof is the Admin's reference.
 */
export function countsTowardBalance(e: FundEntry): boolean {
  if (e.kind !== "top_up") return true;
  if (e.fundingMethod !== "card") return true;
  return isCardTopupSettled(e);
}

/**
 * What an entry that counts is worth to the balance. A card top-up is worth
 * what the machine actually CHARGED (charged_amount_zar on its successful
 * payment, else the tendered amount) — never more than arrived (L44). A
 * mismatch is still flagged by the chain (amount_mismatch).
 */
export function creditedZar(e: FundEntry): number {
  if (e.kind === "top_up" && e.fundingMethod === "card") {
    const paid = e.topupPayments.find((p) => p.status === "successful");
    return paid?.chargedAmountZar ?? e.amountZar;
  }
  return e.amountZar;
}

/** The balance is Σ entries that count (§6.10.5). Integer cents. */
export function fundBalanceZar(entries: FundEntry[]): number {
  return entries.filter(countsTowardBalance).reduce((sum, e) => sum + creditedZar(e), 0);
}

/** Card top-ups that are still open: not drawable, but they may become so. */
export function openTopupsZar(entries: FundEntry[]): number {
  return entries.filter(isOpenTopup).reduce((sum, e) => sum + e.amountZar, 0);
}

/** What the fund control shows of a card top-up: its latest attempt's status. */
export function topupStatus(e: FundEntry): PaymentStatus | null {
  if (e.kind !== "top_up" || e.fundingMethod !== "card") return null;
  if (isCardTopupSettled(e)) return "successful";
  return e.topupPayments[e.topupPayments.length - 1]?.status ?? null;
}

/**
 * §6.10.6 "oldest unspent gift first": the time of the oldest counted credit
 * not yet used up, spending each fund's credits first-in, first-out.
 */
export function oldestUnspentCreditAt(entries: FundEntry[]): Date | null {
  const counted = entries.filter(countsTowardBalance);
  const credits = counted.filter((e) => creditedZar(e) > 0).sort((a, b) => a.at.getTime() - b.at.getTime());
  const creditTotal = credits.reduce((s, e) => s + creditedZar(e), 0);
  const used = creditTotal - fundBalanceZar(entries);
  let running = 0;
  for (const c of credits) {
    running += creditedZar(c);
    if (running > used) return c.at;
  }
  return null;
}

/** The last time the fund moved: its creation, a draw, or a counted top-up. */
export function lastActivityAt(fund: Pick<DonorFund, "at">, entries: FundEntry[]): Date {
  let t = fund.at.getTime();
  for (const e of entries) {
    if ((e.kind === "spend" || (e.kind === "top_up" && countsTowardBalance(e))) && e.at.getTime() > t) t = e.at.getTime();
  }
  return new Date(t);
}

/** T14: dormant once `dormancyDays` have passed with no movement. */
export function isDormant(fund: Pick<DonorFund, "at">, entries: FundEntry[], now: Date, dormancyDays: number): boolean {
  return now.getTime() - lastActivityAt(fund, entries).getTime() >= dormancyDays * DAY_MS;
}

// ─── small helpers ────────────────────────────────────────────────────────────

function fail(code: FundErrorCode, message: string): FundFailure {
  return { ok: false, code, message };
}

function isWholeCents(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

function actorFields(actor: StaffActor) {
  return { actorId: actor.staffId, actorRole: actor.role };
}

/** Thrown to roll a transaction back while carrying the refusal out of it. */
class Refusal<T> extends Error {
  constructor(readonly result: T, readonly reason: string) {
    super(reason);
  }
}

async function auditRefusal(
  deps: FundDeps,
  row: Omit<FundAudit, "actorId" | "actorRole">,
  actor: StaffActor
): Promise<void> {
  await deps.store.transaction((tx) => tx.audit({ ...row, ...actorFields(actor) } as FundAudit));
}

// ─── (1) drawFromDonorFund — money out ────────────────────────────────────────

export type DrawOk = {
  ok: true;
  fundId: string;
  entryId: string;
  amountZar: number;
  balanceAfterZar: number;
};

/**
 * §11.2: "Locks the fund row, computes the balance from the ledger, audits,
 * writes a spend entry and orders.payment_mode='donor_fund'. Never writes to
 * payments." All or nothing — no split tender (§6.10.5). Lock order: the
 * order row, then the fund row (cancelOrder takes them in the same order).
 */
export async function drawFromDonorFund(
  deps: FundDeps,
  actor: StaffActor,
  orderId: string,
  fundId: string
): Promise<DrawOk | FundFailure> {
  const now = deps.now();
  const config = await deps.readConfig();
  return deps.store.transaction(async (tx): Promise<DrawOk | FundFailure> => {
    const reject = async (code: FundErrorCode, message: string, reason: string, after?: Record<string, unknown>) => {
      await tx.audit({
        entityKind: "order",
        entityId: orderId,
        action: "fund.draw_rejected",
        ...actorFields(actor),
        reason,
        after: { code, fundId, ...after },
      });
      return fail(code, message);
    };

    const order = await tx.lockOrder(orderId);
    if (!order) return reject("VALIDATION", "Order not found.", "order_not_found");
    if (order.paymentMode === "donor_fund") {
      return reject("FUND_UNAVAILABLE", "This order is already paid from a blessing fund.", "already_fund_settled");
    }
    if (order.state !== "ordered") {
      return reject("FUND_UNAVAILABLE", `This order is ${order.state} — a fund can only pay an order that is waiting.`, "order_not_ordered", { state: order.state });
    }
    if (!Number.isInteger(order.totalZar) || order.totalZar < 0) {
      return reject("VALIDATION", "The order total is not whole cents.", "total_not_integer_cents");
    }
    if (order.totalZar === 0) {
      // §6.10.6: "No fund draw on an order with no net charge."
      return reject("FUND_UNAVAILABLE", "Nothing to pay — this order's net charge is R0.", "no_net_charge");
    }
    const attempts = await tx.orderAttempts(orderId);
    if (attempts.some((p) => p.status === "successful")) {
      return reject("ALREADY_RESOLVED", FUND_COPY.ALREADY_RESOLVED, "already_paid_by_card");
    }
    const open = attempts.find(isAttemptOpen);
    if (open) {
      return reject("TENDER_IN_PROGRESS", FUND_COPY.TENDER_IN_PROGRESS, "tender_in_progress", { openAttempt: open.attempt });
    }

    const fund = await tx.lockFund(fundId);
    if (!fund) return reject("VALIDATION", "Fund not found.", "fund_not_found");
    if (!fund.active) return reject("FUND_UNAVAILABLE", "This fund is closed.", "fund_inactive");
    if (!config) return reject("VALIDATION", "The fund settings (T13/T14) are not valid — ask an Admin.", "config_invalid");

    const [entries, members] = await Promise.all([tx.listEntries(fundId), tx.listMembers(fundId)]);
    if (isDormant(fund, entries, now, config.dormancyDays)) {
      return reject("FUND_UNAVAILABLE", "This fund is dormant — an Admin needs to look at it.", "fund_dormant");
    }
    if (members.length > 0 && !(order.customerId !== null && members.includes(order.customerId))) {
      return reject("FUND_NOT_LINKED", FUND_COPY.FUND_NOT_LINKED, "not_linked", { customerId: order.customerId });
    }
    const balance = fundBalanceZar(entries);
    if (balance < order.totalZar) {
      return reject(
        "FUND_INSUFFICIENT",
        `This fund holds ${formatZar(balance)} — not enough for ${formatZar(order.totalZar)}.`,
        "insufficient",
        { balanceZar: balance, totalZar: order.totalZar }
      );
    }

    const entry = await tx.insertEntry({
      fundId,
      kind: "spend",
      amountZar: -order.totalZar,
      orderId,
      fundingMethod: null,
      reference: null,
      clientUuid: null,
      recordedByStaffId: actor.staffId,
      reason: null,
      at: now,
    });
    await tx.setOrderFundSettled(orderId);
    const balanceAfterZar = balance - order.totalZar;
    await tx.audit({
      entityKind: "donor_fund",
      entityId: fundId,
      action: "fund.spend",
      ...actorFields(actor),
      before: { balanceZar: balance },
      after: { orderId, entryId: entry.id, amountZar: order.totalZar, balanceZar: balanceAfterZar, paymentMode: "donor_fund" },
    });
    return { ok: true, fundId, entryId: entry.id, amountZar: order.totalZar, balanceAfterZar };
  });
}

// ─── (2) compensateFundDraw — a cancelled fund-paid order ─────────────────────

/**
 * REQ-168: the compensating `adjustment` restoring the fund to its pre-draw
 * balance; the spend entry is never edited. Runs inside the caller's
 * transaction (cancelOrder's), with the order row already locked. Idempotent:
 * a second call finds the adjustment and writes nothing. Returns null when the
 * order was not fund-paid.
 */
export async function compensateFundDraw(
  tx: FundTx,
  actor: StaffActor,
  orderId: string,
  reason: string,
  now: Date
): Promise<FundEntry | null> {
  const spend = await tx.spendForOrder(orderId);
  if (!spend) return null;
  const existing = await tx.adjustmentForOrder(orderId);
  if (existing) return existing;
  await tx.lockFund(spend.fundId);
  const before = fundBalanceZar(await tx.listEntries(spend.fundId));
  const entry = await tx.insertEntry({
    fundId: spend.fundId,
    kind: "adjustment",
    amountZar: -spend.amountZar,
    orderId,
    fundingMethod: null,
    reference: null,
    clientUuid: null,
    recordedByStaffId: actor.staffId,
    reason: reason.trim() === "" ? "order cancelled" : reason,
    at: now,
  });
  await tx.audit({
    entityKind: "donor_fund",
    entityId: spend.fundId,
    action: "fund.draw_reversed",
    ...actorFields(actor),
    reason,
    before: { balanceZar: before },
    after: { orderId, spendEntryId: spend.id, entryId: entry.id, amountZar: entry.amountZar, balanceZar: before + entry.amountZar },
  });
  return entry;
}

// ─── (3) createDonorFund ──────────────────────────────────────────────────────

export type CreateFundInput = {
  /** Optional. Blank = an unnamed fund (found by code; R22's Admin push). */
  displayName?: string | null;
  /** §6.10.2's one question: "For specific people" (true) or "For anyone" (false). */
  forSpecificPeople: boolean;
  /** The linked names. Required for specific people; must be empty for anyone. */
  customerIds: string[];
  donorCustomerId?: string | null;
  /** L45: the donor was told the gift is non-refundable. Must be literally true. */
  nonRefundableAcknowledged: boolean;
  /** The gift about to be taken, integer cents — named in the R22 push. Not credited here. */
  amountZar: number;
};

export type CreateFundOk = { ok: true; fundId: string; code: string; displayName: string | null };

export async function createDonorFund(
  deps: FundDeps,
  actor: StaffActor,
  input: CreateFundInput
): Promise<CreateFundOk | FundFailure> {
  const now = deps.now();
  const displayName = input.displayName?.trim() ? input.displayName.trim() : null;
  const ids = input.customerIds ?? [];
  const config = await deps.readConfig();
  const invalid = (message: string) => fail("VALIDATION", message);
  if (input.nonRefundableAcknowledged !== true) {
    return invalid("Tell the donor the gift is non-refundable, and confirm they understood.");
  }
  if (!isWholeCents(input.amountZar)) return invalid("Enter the amount in whole cents, above R0.");
  if (!config) return invalid("The fund settings (T13/T14) are not valid — ask an Admin.");
  if (input.amountZar > config.ceilingZar) {
    return invalid(`A fund can hold at most ${formatZar(config.ceilingZar)}.`);
  }
  if (input.forSpecificPeople && ids.length === 0) return invalid("Choose the people this fund is for.");
  if (!input.forSpecificPeople && ids.length > 0) return invalid("A fund for anyone has no names linked.");
  if (new Set(ids).size !== ids.length) return invalid("A name is listed twice.");

  let out: CreateFundOk;
  try {
    out = await deps.store.transaction(async (tx) => {
      for (const id of [...ids, ...(input.donorCustomerId ? [input.donorCustomerId] : [])]) {
        if (!(await tx.customerExists(id))) throw new Refusal(invalid("A chosen person was not found."), "customer_not_found");
      }
      let code: string | null = null;
      for (let i = 0; i < CODE_TRIES && code === null; i++) {
        const candidate = deps.randomCode();
        if (FUND_CODE_RE.test(candidate) && !(await tx.codeTaken(candidate))) code = candidate;
      }
      if (code === null) throw new Refusal(invalid("Couldn't issue a fund code — try again."), "code_exhausted");

      const fund = await tx.insertFund({
        code,
        displayName,
        donorCustomerId: input.donorCustomerId ?? null,
        nonRefundableAckBy: actor.staffId,
        createdByStaffId: actor.staffId,
        at: now,
      });
      for (const id of ids) {
        const r = await tx.insertMember(fund.id, id, actor.staffId, now);
        if (r === "linked_elsewhere") {
          throw new Refusal(invalid("One of these people is already linked to another active fund."), "member_linked_elsewhere");
        }
      }
      await tx.audit({
        entityKind: "donor_fund",
        entityId: fund.id,
        action: "fund.created",
        ...actorFields(actor),
        after: {
          code,
          displayName,
          forSpecificPeople: input.forSpecificPeople,
          customerIds: ids,
          donorCustomerId: input.donorCustomerId ?? null,
          nonRefundableAckBy: actor.staffId,
          amountZar: input.amountZar,
        },
      });
      return { ok: true as const, fundId: fund.id, code, displayName };
    });
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    await auditRefusal(deps, { entityKind: "donor_fund", entityId: "new", action: "fund.create_rejected", reason: err.reason }, actor);
    return err.result as FundFailure;
  }
  if (out.displayName === null) {
    try {
      await deps.notify.unnamedFundCreated({ fundId: out.fundId, code: out.code, staffId: actor.staffId, amountZar: input.amountZar });
    } catch (err) {
      // R22's push never blocks the creation (REQ-176). Logged, not swallowed silently.
      console.error("[funds] unnamed-fund push failed", err);
    }
  }
  return out;
}

// ─── (4) beginFundTender — the counter card top-up ────────────────────────────

export type BeginFundTenderOk = Omit<BeginTenderOk, "ok"> & { ok: true; fundTopupId: string };

/**
 * §11.2: allocates the attempt, freezes the amount, writes a `pending` top_up
 * entry and a payments row keyed on fund_topup_id, minting its own
 * client_uuid (client_reference = client_uuid:attempt). Serialised per fund
 * (SELECT … FOR UPDATE): an open top-up refuses a second. T13 is checked
 * before anything reaches the machine (REQ-175): over it → VALIDATION, no
 * payment row, nothing sent. The chain's beginTender writes the payments row;
 * if it refuses (no machine configured), the whole thing rolls back — no
 * entry, no payment — and the refusal is audited.
 */
export async function beginFundTender(
  deps: FundDeps,
  actor: StaffActor,
  fundId: string,
  amountZar: number
): Promise<BeginFundTenderOk | FundFailure | TenderFailure> {
  const now = deps.now();
  const config = await deps.readConfig();
  try {
    return await deps.store.transaction(async (tx): Promise<BeginFundTenderOk | FundFailure> => {
      const reject = async (code: FundErrorCode, message: string, reason: string, after?: Record<string, unknown>) => {
        await tx.audit({
          entityKind: "donor_fund",
          entityId: fundId,
          action: "fund.topup_rejected",
          ...actorFields(actor),
          reason,
          after: { code, amountZar, ...after },
        });
        return fail(code, message);
      };
      if (!isWholeCents(amountZar)) return reject("VALIDATION", "Enter the amount in whole cents, above R0.", "amount_not_whole_cents");
      if (!config) return reject("VALIDATION", "The fund settings (T13/T14) are not valid — ask an Admin.", "config_invalid");

      const fund = await tx.lockFund(fundId);
      if (!fund) return reject("VALIDATION", "Fund not found.", "fund_not_found");
      if (!fund.active) return reject("FUND_UNAVAILABLE", "This fund is closed.", "fund_inactive");
      const entries = await tx.listEntries(fundId);
      if (entries.some(isOpenTopup)) return reject("TENDER_IN_PROGRESS", FUND_COPY.TOPUP_IN_PROGRESS, "topup_in_progress");
      const balance = fundBalanceZar(entries);
      const open = openTopupsZar(entries);
      if (balance + open + amountZar > config.ceilingZar) {
        // R23: the ceiling is checked before the machine, never after.
        return reject(
          "VALIDATION",
          `That would take the fund above ${formatZar(config.ceilingZar)} — it holds ${formatZar(balance)}.`,
          "over_ceiling",
          { balanceZar: balance, openTopupsZar: open, ceilingZar: config.ceilingZar }
        );
      }

      const entry = await tx.insertEntry({
        fundId,
        kind: "top_up",
        amountZar,
        orderId: null,
        fundingMethod: "card",
        reference: null,
        clientUuid: deps.newClientUuid(),
        recordedByStaffId: actor.staffId,
        reason: null,
        at: now,
      });
      await tx.audit({
        entityKind: "donor_fund",
        entityId: fundId,
        action: "fund.topup_begun",
        ...actorFields(actor),
        after: { entryId: entry.id, amountZar, fundingMethod: "card", clientUuid: entry.clientUuid, status: "pending" },
      });
      const begun = await beginTender({ ...deps.tender, store: tx.topupTenderStore(), now: () => now }, actor, entry.id);
      if (!begun.ok) throw new Refusal(begun, `tender_refused:${begun.code}`);
      return { ...begun, fundTopupId: entry.id };
    });
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    await auditRefusal(
      deps,
      { entityKind: "donor_fund", entityId: fundId, action: "fund.topup_rejected", reason: err.reason, after: { amountZar } },
      actor
    );
    return err.result as TenderFailure;
  }
}

// ─── (5) topUpDonorFund — the Admin's cash / EFT path ─────────────────────────

export type TopUpInput = {
  fundId: string;
  amountZar: number;
  fundingMethod: FundingMethod | null | undefined;
  reference: string | null | undefined;
  reason: string | null | undefined;
};

export type TopUpOk = { ok: true; entryId: string; balanceZar: number };

/**
 * REQ-161: without a funding_method and reference, or for an amount carrying
 * the fund above T13, returns VALIDATION and WRITES NOTHING (not even an audit
 * row — the PRD's literal "writes nothing"). A card gift is not recorded here:
 * it goes through beginFundTender, where Yoco proves it.
 */
export async function topUpDonorFund(deps: FundDeps, actor: StaffActor, input: TopUpInput): Promise<TopUpOk | FundFailure> {
  const now = deps.now();
  const reference = input.reference?.trim() ?? "";
  const reason = input.reason?.trim() ?? "";
  if (input.fundingMethod !== "cash" && input.fundingMethod !== "eft") {
    return fail("VALIDATION", "Choose how the gift arrived: cash or EFT. A card gift is taken at the counter.");
  }
  if (reference === "") return fail("VALIDATION", "A top-up needs a reference — the receipt or bank reference.");
  if (reason === "") return fail("VALIDATION", "Give a reason for the record.");
  if (!isWholeCents(input.amountZar)) return fail("VALIDATION", "Enter the amount in whole cents, above R0.");
  const config = await deps.readConfig();
  if (!config) return fail("VALIDATION", "The fund settings (T13/T14) are not valid.");

  try {
    return await deps.store.transaction(async (tx): Promise<TopUpOk> => {
      const fund = await tx.lockFund(input.fundId);
      if (!fund) throw new Refusal(fail("VALIDATION", "Fund not found."), "fund_not_found");
      if (!fund.active) throw new Refusal(fail("FUND_UNAVAILABLE", "This fund is closed."), "fund_inactive");
      const entries = await tx.listEntries(input.fundId);
      const balance = fundBalanceZar(entries);
      if (balance + openTopupsZar(entries) + input.amountZar > config.ceilingZar) {
        throw new Refusal(
          fail("VALIDATION", `That would take the fund above ${formatZar(config.ceilingZar)} — it holds ${formatZar(balance)}.`),
          "over_ceiling"
        );
      }
      const entry = await tx.insertEntry({
        fundId: input.fundId,
        kind: "top_up",
        amountZar: input.amountZar,
        orderId: null,
        fundingMethod: input.fundingMethod as FundingMethod,
        reference,
        clientUuid: null,
        recordedByStaffId: actor.staffId,
        reason,
        at: now,
      });
      await tx.audit({
        entityKind: "donor_fund",
        entityId: input.fundId,
        action: "fund.topup_recorded",
        ...actorFields(actor),
        reason,
        before: { balanceZar: balance },
        after: { entryId: entry.id, amountZar: input.amountZar, fundingMethod: input.fundingMethod, reference, balanceZar: balance + input.amountZar },
      });
      return { ok: true, entryId: entry.id, balanceZar: balance + input.amountZar };
    });
  } catch (err) {
    if (err instanceof Refusal) return err.result as FundFailure; // rolled back: nothing written
    throw err;
  }
}

// ─── (6) sweepDonorFund — Admin only, never a job ─────────────────────────────

export type SweepOk = { ok: true; entryId: string; sweptZar: number };

/**
 * §6.10.4: "the sweep proposes; an Admin confirms." Moves a DORMANT balance
 * (T14) to ministry income as one `sweep` entry, audited with a reason.
 */
export async function sweepDonorFund(deps: FundDeps, actor: StaffActor, fundId: string, reason: string): Promise<SweepOk | FundFailure> {
  const now = deps.now();
  const why = reason?.trim() ?? "";
  const config = await deps.readConfig();
  return deps.store.transaction(async (tx): Promise<SweepOk | FundFailure> => {
    const reject = async (code: FundErrorCode, message: string, r: string) => {
      await tx.audit({ entityKind: "donor_fund", entityId: fundId, action: "fund.sweep_rejected", ...actorFields(actor), reason: r });
      return fail(code, message);
    };
    if (why === "") return reject("VALIDATION", "Give a reason for the sweep.", "no_reason");
    if (!config) return reject("VALIDATION", "The fund settings (T13/T14) are not valid.", "config_invalid");
    const fund = await tx.lockFund(fundId);
    if (!fund) return reject("VALIDATION", "Fund not found.", "fund_not_found");
    const entries = await tx.listEntries(fundId);
    const balance = fundBalanceZar(entries);
    if (balance <= 0) return reject("VALIDATION", "Nothing to sweep — the fund is empty.", "empty");
    if (!isDormant(fund, entries, now, config.dormancyDays)) {
      return reject("VALIDATION", `Only a fund with no movement for ${config.dormancyDays} days can be swept.`, "not_dormant");
    }
    const entry = await tx.insertEntry({
      fundId,
      kind: "sweep",
      amountZar: -balance,
      orderId: null,
      fundingMethod: null,
      reference: null,
      clientUuid: null,
      recordedByStaffId: actor.staffId,
      reason: why,
      at: now,
    });
    await tx.audit({
      entityKind: "donor_fund",
      entityId: fundId,
      action: "fund.swept",
      ...actorFields(actor),
      reason: why,
      before: { balanceZar: balance },
      after: { entryId: entry.id, sweptZar: balance, to: "ministry_income", balanceZar: 0 },
    });
    return { ok: true, entryId: entry.id, sweptZar: balance };
  });
}

// ─── (7) addFundName / removeFundName — Admin only ────────────────────────────

export async function addFundName(deps: FundDeps, actor: StaffActor, fundId: string, customerId: string): Promise<{ ok: true } | FundFailure> {
  const now = deps.now();
  return deps.store.transaction(async (tx) => {
    const reject = async (message: string, reason: string) => {
      await tx.audit({ entityKind: "donor_fund", entityId: fundId, action: "fund.name_rejected", ...actorFields(actor), reason, after: { customerId } });
      return fail("VALIDATION", message);
    };
    const fund = await tx.lockFund(fundId);
    if (!fund) return reject("Fund not found.", "fund_not_found");
    if (!fund.active) return reject("This fund is closed.", "fund_inactive");
    if (!(await tx.customerExists(customerId))) return reject("Person not found.", "customer_not_found");
    const r = await tx.insertMember(fundId, customerId, actor.staffId, now);
    if (r === "duplicate") return reject("Already linked to this fund.", "duplicate");
    if (r === "linked_elsewhere") return reject("Already linked to another active fund — unlink them there first.", "linked_elsewhere");
    await tx.audit({ entityKind: "donor_fund", entityId: fundId, action: "fund.name_added", ...actorFields(actor), after: { customerId } });
    return { ok: true as const };
  });
}

export async function removeFundName(deps: FundDeps, actor: StaffActor, fundId: string, customerId: string): Promise<{ ok: true } | FundFailure> {
  return deps.store.transaction(async (tx) => {
    const fund = await tx.lockFund(fundId);
    const removed = fund ? await tx.deleteMember(fundId, customerId) : false;
    if (!removed) {
      await tx.audit({ entityKind: "donor_fund", entityId: fundId, action: "fund.name_rejected", ...actorFields(actor), reason: "not_linked", after: { customerId } });
      return fail("VALIDATION", "That person is not linked to this fund.");
    }
    await tx.audit({ entityKind: "donor_fund", entityId: fundId, action: "fund.name_removed", ...actorFields(actor), before: { customerId } });
    return { ok: true as const };
  });
}

// ─── (8) reads for the counter: balance only, never the ledger ────────────────

export type FundBalanceView = {
  fundId: string;
  code: string;
  displayName: string | null;
  balanceZar: number;
  /** REQ-173: open card top-ups show their status and contribute nothing. */
  pendingTopups: { amountZar: number; status: PaymentStatus | null }[];
};

/** §6.10.5: a barista can read a fund's BALANCE — not its ledger, draws or names. */
export async function readFundBalance(deps: FundDeps, fundId: string): Promise<FundBalanceView | null> {
  return deps.store.transaction(async (tx) => {
    const fund = await tx.lockFund(fundId);
    if (!fund) return null;
    const entries = await tx.listEntries(fundId);
    return {
      fundId,
      code: fund.code,
      displayName: fund.displayName,
      balanceZar: fundBalanceZar(entries),
      pendingTopups: entries.filter(isOpenTopup).map((e) => ({ amountZar: e.amountZar, status: topupStatus(e) })),
    };
  });
}

export type FundChip = { fundId: string; code: string; displayName: string | null; balanceZar: number };

export type FundOptions = {
  /** REQ-164/169: the bound person's linked fund — lit when it can cover the order. */
  linked: (FundChip & { canCover: boolean; lit: boolean }) | null;
  /** REQ-170: ONE open-fund chip — the oldest unspent gift among funds that can cover. */
  open: (FundChip & { behind: number }) | null;
  /** The override list (a second tap): every open fund that can cover, in draw order. */
  openList: FundChip[];
};

/**
 * What the footer can offer for an order (§6.10.6). An order owing nothing
 * offers no fund at all (L48). Open funds are funds with no names linked; a
 * fund that cannot cover the order is never offered (no split tender).
 */
export async function fundOptions(deps: FundDeps, input: { customerId: string | null; netZar: number }): Promise<FundOptions> {
  const none: FundOptions = { linked: null, open: null, openList: [] };
  if (!Number.isInteger(input.netZar) || input.netZar <= 0) return none;
  const config: FundConfig | null = await deps.readConfig();
  if (!config) return none;
  const now = deps.now();
  return deps.store.transaction(async (tx) => {
    const funds = await tx.listActiveFunds();
    const linkedId = input.customerId ? await tx.linkedFundOf(input.customerId) : null;
    let linked: FundOptions["linked"] = null;
    const candidates: { chip: FundChip; oldest: number; createdAt: number }[] = [];
    for (const f of funds) {
      const isLinked = f.id === linkedId;
      if (!isLinked && f.memberCount > 0) continue;
      const entries = await tx.listEntries(f.id);
      const balance = fundBalanceZar(entries);
      const chip: FundChip = { fundId: f.id, code: f.code, displayName: f.displayName, balanceZar: balance };
      const usable = !isDormant(f, entries, now, config.dormancyDays) && balance >= input.netZar;
      if (isLinked) {
        linked = { ...chip, canCover: usable, lit: usable };
        continue;
      }
      if (!usable) continue;
      candidates.push({ chip, oldest: (oldestUnspentCreditAt(entries) ?? f.at).getTime(), createdAt: f.at.getTime() });
    }
    candidates.sort((a, b) => a.oldest - b.oldest || a.createdAt - b.createdAt || a.chip.fundId.localeCompare(b.chip.fundId));
    const openList = candidates.map((c) => c.chip);
    return { linked, open: openList[0] ? { ...openList[0], behind: openList.length - 1 } : null, openList };
  });
}
