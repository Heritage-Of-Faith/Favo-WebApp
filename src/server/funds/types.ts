// AT-203: the shapes the blessing-fund rules work on (PRD v7.0 §6.10, §10.3,
// §11.2, L44–L47).
//
// Like the tender chain (src/server/tender/), the rules in ./funds.ts take
// their collaborators as arguments — a FundStore (Postgres in production,
// ./drizzle-store.ts; in memory in the unit tests), a clock, the T13/T14
// config, a code generator and a notifier. Nothing here authenticates: the
// server actions in src/server/actions/funds.ts do, and pass the actor.
//
// Money is integer cents throughout, signed on the ledger: a top_up is > 0, a
// spend or sweep < 0, an adjustment ≠ 0. There is no balance column — the
// balance is the sum of the entries that count (§6.10.5).

import type { PaymentStatus, TenderAudit, TenderDeps, TenderStore } from "@/server/tender/types";

export type FundEntryKind = "top_up" | "spend" | "sweep" | "adjustment";
export type FundingMethod = "card" | "cash" | "eft";

export type DonorFund = {
  id: string;
  code: string;
  /** NULL = an unnamed fund (found by its code; R22's Admin push at creation). */
  displayName: string | null;
  active: boolean;
  createdByStaffId: string;
  at: Date;
};

export type FundEntry = {
  id: string;
  fundId: string;
  kind: FundEntryKind;
  /** Signed integer cents. */
  amountZar: number;
  orderId: string | null;
  fundingMethod: FundingMethod | null;
  reference: string | null;
  /** Card top-ups only: the root of payments.client_reference (§6.10.3 step 5). */
  clientUuid: string | null;
  recordedByStaffId: string;
  reason: string | null;
  at: Date;
  /**
   * Card top-ups only: every payment attempt, ORDER BY attempt. Empty
   * otherwise. chargedAmountZar is what the machine actually charged — the
   * amount the fund is credited (L44: never more than arrived).
   */
  topupPayments: { status: PaymentStatus; sentAt: Date | null; yocoPaymentId: string | null; chargedAmountZar?: number | null }[];
};

export type NewFundEntry = Omit<FundEntry, "id" | "topupPayments">;

export type FundOrder = {
  id: string;
  state: string;
  /** Integer cents: the order's net charge. */
  totalZar: number;
  paymentMode: string | null;
  customerId: string | null;
};

export type NewDonorFund = {
  code: string;
  displayName: string | null;
  donorCustomerId: string | null;
  nonRefundableAckBy: string;
  createdByStaffId: string;
  at: Date;
};

export type FundAudit = TenderAudit | (Omit<TenderAudit, "entityKind"> & { entityKind: "donor_fund" });

export interface FundTx {
  /** SELECT … FOR UPDATE on orders. Always taken BEFORE lockFund. */
  lockOrder(orderId: string): Promise<FundOrder | null>;
  /** The order's card attempts, ORDER BY attempt. */
  orderAttempts(orderId: string): Promise<{ status: PaymentStatus; sentAt: Date | null; yocoPaymentId: string | null; attempt: number }[]>;
  /** SELECT … FOR UPDATE on donor_funds — the balance-locking idiom (§6.10.5). */
  lockFund(fundId: string): Promise<DonorFund | null>;
  /** Every entry on the fund, ORDER BY at, id. */
  listEntries(fundId: string): Promise<FundEntry[]>;
  /** The customer ids linked to the fund. Empty = barista discretion (§6.10.2). */
  listMembers(fundId: string): Promise<string[]>;
  /** Active funds, oldest first, with how many names each has linked. */
  listActiveFunds(): Promise<(DonorFund & { memberCount: number })[]>;
  /** The customer's active linked fund, if any (at most one, REQ-172). */
  linkedFundOf(customerId: string): Promise<string | null>;
  insertEntry(row: NewFundEntry): Promise<FundEntry>;
  /** The order's spend entry, if it was settled from a fund. */
  spendForOrder(orderId: string): Promise<FundEntry | null>;
  /** The order's compensating adjustment, if a cancel already wrote one. */
  adjustmentForOrder(orderId: string): Promise<FundEntry | null>;
  setOrderFundSettled(orderId: string): Promise<void>;
  codeTaken(code: string): Promise<boolean>;
  insertFund(row: NewDonorFund): Promise<DonorFund>;
  customerExists(customerId: string): Promise<boolean>;
  /**
   * Link a name. `linked_elsewhere` is the DB's partial unique index refusing a
   * second active fund for one customer (REQ-172) — not an application check.
   */
  insertMember(fundId: string, customerId: string, addedByStaffId: string, at: Date): Promise<"ok" | "duplicate" | "linked_elsewhere">;
  deleteMember(fundId: string, customerId: string): Promise<boolean>;
  /**
   * The tender chain's store for a card top-up, bound to THIS transaction (a
   * savepoint per chain transaction): its "order" is the top_up entry.
   */
  topupTenderStore(): TenderStore;
  audit(row: FundAudit): Promise<void>;
}

export interface FundStore {
  transaction<T>(fn: (tx: FundTx) => Promise<T>): Promise<T>;
}

export type FundConfig = {
  /** T13, config.donor_fund_ceiling_zar — integer cents. */
  ceilingZar: number;
  /** T14, config.donor_fund_dormancy_days. */
  dormancyDays: number;
};

export interface FundNotifier {
  /** R22 / REQ-176: the immediate Admin push on an unnamed fund. Called after the commit. */
  unnamedFundCreated(info: { fundId: string; code: string; staffId: string; amountZar: number }): Promise<void>;
}

export type FundDeps = {
  store: FundStore;
  now: () => Date;
  /** null = a stored value is not a valid T13/T14 (refuse rather than guess). */
  readConfig: () => Promise<FundConfig | null>;
  /** One candidate code, `FVO-` + 4 symbols. Checked for uniqueness by the caller. */
  randomCode: () => string;
  newClientUuid: () => string;
  notify: FundNotifier;
  /** The tender chain's collaborators for a card top-up (port, device id, S4a pushes). */
  tender: Omit<TenderDeps, "store" | "now">;
};

export type FundErrorCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "FUND_INSUFFICIENT"
  | "FUND_NOT_LINKED"
  | "FUND_UNAVAILABLE"
  | "TENDER_IN_PROGRESS"
  | "ALREADY_RESOLVED"
  | "TERMINAL_UNREACHABLE";

export type FundFailure = { ok: false; code: FundErrorCode; message: string };

/** T13 and T14 defaults (§10.4): R2,000 and 180 days. */
export const DEFAULT_FUND_CONFIG: FundConfig = { ceilingZar: 200_000, dormancyDays: 180 };
