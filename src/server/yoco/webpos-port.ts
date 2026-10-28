// AT-201: the port between FAVO and Yoco's Web POS API (PRD v7.0 §6.8.2).
//
// Server-side only — the Yoco secret key never reaches the browser (P7,
// REQ-071). This file declares the contract; the HTTP adapter that implements
// it against Yoco is a later step, and tests use FakeYocoWebPosPort.
//
// Rules the shape encodes:
//   - Amounts are integer cents on both sides. Yoco's Web POS amounts are
//     already cents: nothing here multiplies or divides by 100.
//   - Yoco's payment resource reports exactly `pending | successful | failed`
//     (§6.0.1: "FAVO does not invent a fourth status"). Mapping `failed` to
//     FAVO's `payments.status='declined'` is the caller's job.
//   - A send has four outcomes and they are never conflated (REQ-010):
//       sent                → Yoco returned a payment id; persist it at once (REQ-029)
//       gateway_unavailable → an error WITH NO payment id; nothing was sent,
//                             so a retry is safe and may be offered (REQ-010's gateway code)
//       device_error        → the terminal is off / asleep / off the wifi (TERMINAL_UNREACHABLE)
//       timeout             → no answer; a payment may exist FAVO holds no id
//                             for. PAYMENT_UNKNOWN — never re-sent; recover by
//                             client_reference
//   - A fetch error is never a status (§6.8.4). It is its own variant.
//   - The payment carries only the fields §10.3.3 stores. No PAN, masked or
//     otherwise, no cardholder name, no raw response body (REQ-031, §9.10.2).

/** What Yoco's Web POS payment resource reports. */
export type WebPosPaymentStatus = "pending" | "successful" | "failed";

export type WebPosSendInput = {
  /** app_config.webpos_device_id, read once at beginTender (REQ-065). */
  deviceId: string;
  /** Integer cents, equal to orders.total_zar. No factor. */
  amountZar: number;
  /** `client_uuid:attempt` (P3, REQ-027), written before the send. */
  clientReference: string;
};

export type WebPosSendResult =
  | { kind: "sent"; yocoPaymentId: string }
  | { kind: "gateway_unavailable"; httpStatus?: number }
  | { kind: "device_error" }
  | { kind: "timeout" };

export type WebPosPayment = {
  yocoPaymentId: string;
  clientReference: string;
  status: WebPosPaymentStatus;
  /** What the machine actually charged, integer cents. NULL until known. */
  chargedAmountZar: number | null;
  /** Integer cents. FAVO suppresses tips; a non-zero value is a variance. */
  tipZar: number;
};

export type WebPosFetchResult =
  | { kind: "found"; payment: WebPosPayment }
  | { kind: "not_found" }
  | { kind: "fetch_error" };

/** Every payment Yoco holds on one client_reference. Two successful = a double charge. */
export type WebPosLookupResult =
  | { kind: "found"; payments: WebPosPayment[] }
  | { kind: "fetch_error" };

export type WebPosDeviceResult =
  | { kind: "online"; model: string; serialNumber: string }
  | { kind: "device_error" }
  | { kind: "fetch_error" };

export interface YocoWebPosPort {
  /** Look the device up: every 60 s while a session is open, and before each send. */
  lookupDevice(deviceId: string): Promise<WebPosDeviceResult>;
  /** Send one tender attempt to the terminal. Called once per attempt, never twice. */
  sendPayment(input: WebPosSendInput): Promise<WebPosSendResult>;
  /** Fetch a payment's status resource by Yoco's id. */
  fetchPayment(yocoPaymentId: string): Promise<WebPosFetchResult>;
  /** Recovery when FAVO holds no id (a timed-out send): look up by client_reference. */
  findPaymentsByClientReference(clientReference: string): Promise<WebPosLookupResult>;
}
