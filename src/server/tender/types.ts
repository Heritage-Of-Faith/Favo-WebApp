// AT-201 part 2a: the shapes the tender chain works on (PRD v7.0 §6.8, §11.2).
//
// The tender functions in ./tender.ts take their collaborators as arguments —
// a TenderStore (Postgres in production, ./drizzle-store.ts), a YocoWebPosPort
// (FakeYocoWebPosPort in every test; the live HTTP adapter is a later step), a
// clock, the configured device id, and a notifier for the Admin pushes. Nothing
// here is a server action: authentication and wiring are AT-201 part 2b.
//
// Money is integer cents throughout. Nothing multiplies or divides by 100.

import type { WebPosPayment, YocoWebPosPort } from "@/server/yoco/webpos-port";

export type PaymentStatus = "pending" | "successful" | "declined" | "unresolved";

export type TenderOrder = {
  id: string;
  state: string;
  /** Integer cents. The amount the machine is asked for. */
  totalZar: number;
  clientUuid: string;
};

export type TenderPayment = {
  id: string;
  orderId: string;
  attempt: number;
  clientReference: string;
  yocoPaymentId: string | null;
  webposDeviceId: string;
  amountZar: number;
  chargedAmountZar: number | null;
  tipZar: number;
  status: PaymentStatus;
  sentAt: Date | null;
  lastCheckedAt: Date | null;
  at: Date;
};

export type NewTenderPayment = {
  orderId: string;
  attempt: number;
  clientReference: string;
  webposDeviceId: string;
  amountZar: number;
  at: Date;
};

/** Every column the chain writes EXCEPT status. */
export type PaymentPatch = Partial<{
  yocoPaymentId: string;
  sentAt: Date | null;
  lastCheckedAt: Date;
  chargedAmountZar: number;
  tipZar: number;
}>;

export type TenderAudit = {
  entityKind: "payment" | "order";
  entityId: string;
  action: string;
  actorId?: string;
  actorRole?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
};

/** What one S4 lookup read, as recorded on its audit row (S4 step 3's memory). */
export type LookupRead = "successful" | "failed" | "pending" | "not_found" | "fetch_error";

export interface TenderTx {
  /** SELECT … FOR UPDATE on orders — every tender function takes this lock first. */
  lockOrder(orderId: string): Promise<TenderOrder | null>;
  /** Every payment attempt on the order, ORDER BY attempt ASC. */
  listPayments(orderId: string): Promise<TenderPayment[]>;
  /** SELECT … FOR UPDATE on one attempt. */
  lockPayment(orderId: string, attempt: number): Promise<TenderPayment | null>;
  insertPayment(row: NewTenderPayment): Promise<TenderPayment>;
  /** Writes anything but status. */
  updatePayment(id: string, patch: PaymentPatch): Promise<void>;
  /**
   * The only write of payments.status in the chain. Called from exactly two
   * functions — recordTenderResult and resolveTenderByLookup (§10.2.1).
   */
  setPaymentStatus(id: string, status: PaymentStatus, patch?: PaymentPatch): Promise<void>;
  audit(row: TenderAudit): Promise<void>;
  /** The newest `payment.lookup` audit row for this payment, if any. */
  lastLookupRead(paymentId: string): Promise<{ read: LookupRead; at: Date } | null>;
}

export interface TenderStore {
  transaction<T>(fn: (tx: TenderTx) => Promise<T>): Promise<T>;
}

/** The Admin pushes the chain owes (S4a, REQ-011). Called after the commit. */
export interface TenderNotifier {
  paymentUnresolved(info: { orderId: string; attempt: number; amountZar: number; cause: string }): Promise<void>;
  duplicateCharge(info: { orderId: string; yocoPaymentIds: string[]; amountZar: number }): Promise<void>;
}

export type TenderActor =
  | { kind: "staff"; staffId: string; role: string }
  | { kind: "system" };

export type TenderDeps = {
  store: TenderStore;
  port: YocoWebPosPort;
  now: () => Date;
  /** app_config.webpos_device_id (§10.4) — read ONCE, by beginTender only. */
  readDeviceId: () => Promise<string | null>;
  notify: TenderNotifier;
};

export type TenderErrorCode =
  | "VALIDATION"
  | "STALE_STATE"
  | "ALREADY_RESOLVED"
  | "TENDER_IN_PROGRESS"
  | "TERMINAL_UNREACHABLE"
  | "GATEWAY_UNAVAILABLE"
  | "PAYMENT_UNKNOWN"
  | "PAYMENT_DECLINED";

export type TenderFailure = {
  ok: false;
  code: TenderErrorCode;
  message: string;
  /** REQ-010: true only for GATEWAY_UNAVAILABLE — the one failure where a new attempt is safe to offer. */
  retryOffered?: boolean;
};

/**
 * What recordTenderResult may be told. `successful` and `failed` carry the
 * payment exactly as the server read it from Yoco through the port — never a
 * client-supplied claim (that would be a human assertion creating revenue,
 * which §10.2.1 removed).
 */
export type TenderResult =
  | { kind: "read"; payment: WebPosPayment }
  /** No determinate answer: the 180 s ceiling, or a send that timed out. */
  | { kind: "unresolved"; cause: "ceiling" | "send_timeout" }
  /** The send returned an error with no payment id: nothing was sent. */
  | { kind: "not_sent"; code: "GATEWAY_UNAVAILABLE" | "TERMINAL_UNREACHABLE" };

/** REQ-003 / S2: FAVO stops waiting 180 s after the send. */
export const TENDER_CEILING_MS = 180_000;
/** S4 step 3(b): two failed reads at least 60 s apart. */
export const SECOND_NEGATIVE_GAP_MS = 60_000;
/** S4 step 3(c): at least 120 s since the send. */
export const MIN_SINCE_SEND_FOR_DECLINE_MS = 120_000;
/** S2: the status fetch is retried at most twice. */
export const FETCH_RETRIES = 2;
