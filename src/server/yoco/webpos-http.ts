// AT-201: the live HTTP adapter for YocoWebPosPort (PRD v7.0 §6.8.2, §9.10.2).
//
// OFF BY DEFAULT. src/server/tender/runtime.ts selects it only when
// YOCO_WEBPOS_LIVE=1 AND YOCO_SECRET_KEY are both set; otherwise FAVO keeps
// running on unlinkedWebPosPort. It is proven at gate zero (§6.8.2's R1.00
// test), never against live Yoco from a test.
//
// What the PRD fixes, and this file encodes:
//   - Server-side only. The secret key is read from YOCO_SECRET_KEY at call
//     time, inside this module, and goes nowhere but the request header: never
//     exported, logged, thrown or returned (P7, §9.10.2, REQ-071).
//   - L40 / REQ-031: this adapter is the ONLY place that touches Yoco's raw
//     response. Every response goes through a strict allow-list mapper that
//     returns only the fields §10.3.3 stores. The masked PAN, the cardholder
//     name, `redirect_url` and every other field are dropped here. Nothing
//     from a response body is logged or put into an error.
//   - REQ-002 / §9 dependency table: send 10 s; a status fetch 5 s. The "×2"
//     is the tender chain's FETCH_RETRIES (src/server/tender/types.ts) — this
//     adapter makes ONE request per call and never retries, so the two do not
//     multiply.
//   - REQ-010 / §6.8.4 / DEC-25: a send refused with a 4xx and no payment id
//     is `gateway_unavailable` (retry safe). A 5xx with no id, a redirect, a
//     send that times out, or fails at the
//     network, or answers in a way that does not establish "nothing was
//     created", is `timeout` (PAYMENT_UNKNOWN, never re-sent). Never conflated.
//   - §6.8.4: a fetch error is never a status. Anything unreadable is
//     `fetch_error`, never `pending` or `failed`.
//   - Status is exactly `pending | successful | failed` (§6.0.1). A fourth
//     value is unreadable, not guessed.
//   - Amounts are integer cents both ways; nothing multiplies or divides by 100.
//   - findPaymentsByClientReference returns EVERY payment on the reference, so
//     two successful payments (a double charge) stay visible (§6.8.4, REQ-011).

import type {
  WebPosDeviceResult,
  WebPosFetchResult,
  WebPosLookupResult,
  WebPosPayment,
  WebPosPaymentStatus,
  WebPosSendInput,
  WebPosSendResult,
  YocoWebPosPort,
} from "./webpos-port";

// ─── UNVERIFIED: confirm against Yoco docs and the R1.00 test (FACT-1) ────────
//
// The PRD records that the Web POS API has four calls (create device, look the
// device up, send a payment, fetch a payment by id) and these field names:
// `client_reference`, `status` (`pending | failed | successful`), `model`,
// `serial_number`, `redirect_url`. It does NOT record the base URL, the
// endpoint paths, the auth header, the device-state field, the payment-id
// field, the amount field names, the HTTP status a device error comes back
// with, or how to list payments by client_reference. Every one of those is
// below, and every one is a placeholder until Nikao confirms it against Yoco's
// API reference and the gate-zero R1.00 test. NONE of them is confirmed.
export const YOCO_API_ASSUMPTIONS = {
  /** UNVERIFIED. The host of the retired Yoco Online client; the Web POS host is not recorded. */
  baseUrl: "https://payments.yoco.com/api",
  /** UNVERIFIED. Header name and scheme the secret key is sent with (the retired Online client used Bearer). */
  authHeader: "Authorization",
  authScheme: "Bearer",
  paths: {
    /** UNVERIFIED. GET — look a device up by id. */
    device: (deviceId: string) => `/webpos/devices/${encodeURIComponent(deviceId)}`,
    /** UNVERIFIED. POST — send a payment to a device. */
    sendPayment: (deviceId: string) => `/webpos/devices/${encodeURIComponent(deviceId)}/payments`,
    /** UNVERIFIED. GET — fetch a payment by Yoco's id. */
    payment: (yocoPaymentId: string) => `/webpos/payments/${encodeURIComponent(yocoPaymentId)}`,
    /** UNVERIFIED. GET — every payment on one client_reference. Not FEE-1's `GET /v1/payments/`, which the PRD forbids building on. */
    paymentsByClientReference: (clientReference: string) =>
      `/webpos/payments?client_reference=${encodeURIComponent(clientReference)}`,
  },
  request: {
    /** UNVERIFIED. Field carrying the integer-cents amount on a send. */
    amountField: "amount",
    /** UNVERIFIED. Whether a currency is sent, and its field name. */
    currencyField: "currency",
    currency: "ZAR",
    // `client_reference` is the PRD's name (§6.8.0, §10.3.3) — not an assumption.
  },
  response: {
    /** UNVERIFIED. Field holding Yoco's payment id on a payment resource. */
    paymentIdField: "id",
    /**
     * UNVERIFIED. Field holding what the machine actually CHARGED, integer
     * cents — read only on `successful`. If Yoco's field is the amount ASKED,
     * §6.8.4's "recorded at the charged amount" is not met; confirm at gate zero.
     */
    chargedAmountField: "amount",
    /** UNVERIFIED. Field on a list response holding the array of payments. */
    listField: "data",
    /** UNVERIFIED. Field on a device resource reporting its state. */
    deviceStateField: "status",
    /** UNVERIFIED. Values of that field meaning "online and ready to take a tap". */
    deviceOnlineValues: ["online"] as readonly string[],
    // `status` on a payment, `client_reference`, `model` and `serial_number`
    // are the PRD's names — not assumptions.
  },
  /**
   * UNVERIFIED. HTTP statuses on a SEND meaning "the terminal is off / asleep /
   * off the wifi; nothing was created" (§6.8.4 says it is "rejected with a
   * device error and no payment id" but not how). Empty until the R1.00 test's
   * step 6 observes it: until then such a rejection reads as
   * gateway_unavailable if it is a 4xx ("nothing was sent"), and as
   * PAYMENT_UNKNOWN if it is a 5xx (DEC-25). Only 4xx values belong here.
   */
  sendDeviceErrorHttpStatuses: [] as readonly number[],
} as const;

/** REQ-002: the send call. */
export const SEND_TIMEOUT_MS = 10_000;
/** REQ-002: one payment status fetch (the tender chain retries it, FETCH_RETRIES). The device lookup is a fetch too. */
export const FETCH_TIMEOUT_MS = 5_000;

const PAYMENT_STATUSES: readonly WebPosPaymentStatus[] = ["pending", "successful", "failed"];

export type CreateYocoWebPosPortOptions = {
  /** Injected for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Defaults to YOCO_API_ASSUMPTIONS.baseUrl. */
  baseUrl?: string;
};

type Answer =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "timeout" }
  | { kind: "network_error" }
  | { kind: "no_key" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * The allow-list mapper (§9.10.2, REQ-031). Builds a NEW object from exactly
 * the four fields WebPosPayment declares; nothing else in `raw` is copied.
 * Returns null when the resource cannot be read — never a guessed status.
 */
export function mapPayment(raw: unknown): WebPosPayment | null {
  if (!isRecord(raw)) return null;
  const R = YOCO_API_ASSUMPTIONS.response;
  const id = raw[R.paymentIdField];
  const clientReference = raw["client_reference"];
  const status = raw["status"];
  if (!nonEmptyString(id) || !nonEmptyString(clientReference)) return null;
  if (typeof status !== "string" || !(PAYMENT_STATUSES as readonly string[]).includes(status)) return null;
  const charged = raw[R.chargedAmountField];
  let chargedAmountZar: number | null = null;
  if (status === "successful" && charged !== undefined && charged !== null) {
    // Integer cents or unreadable. Never rounded, never scaled.
    if (typeof charged !== "number" || !Number.isInteger(charged)) return null;
    chargedAmountZar = charged;
  }
  return {
    yocoPaymentId: id,
    clientReference,
    status: status as WebPosPaymentStatus,
    chargedAmountZar,
  };
}

/** The device allow-list: a state, a model and a serial number, and nothing else. */
function mapDevice(raw: unknown): WebPosDeviceResult | null {
  if (!isRecord(raw)) return null;
  const R = YOCO_API_ASSUMPTIONS.response;
  const state = raw[R.deviceStateField];
  if (typeof state !== "string") return null;
  if (!R.deviceOnlineValues.includes(state)) return { kind: "device_error" };
  const model = raw["model"];
  const serialNumber = raw["serial_number"];
  // Online but no terminal model/serial: no machine FAVO can see (FACT-1).
  if (!nonEmptyString(model) || !nonEmptyString(serialNumber)) return { kind: "device_error" };
  return { kind: "online", model, serialNumber };
}

export function createYocoWebPosPort(opts: CreateYocoWebPosPortOptions = {}): YocoWebPosPort {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = (opts.baseUrl ?? YOCO_API_ASSUMPTIONS.baseUrl).replace(/\/+$/, "");

  /**
   * One request, one timeout covering the headers AND the body. The key is
   * read here, at call time, and lives only in the header object below.
   * Nothing is logged; no error carries the request or the response.
   */
  async function call(method: "GET" | "POST", path: string, timeoutMs: number, body?: unknown): Promise<Answer> {
    const key = process.env.YOCO_SECRET_KEY;
    if (!key) return { kind: "no_key" };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          [YOCO_API_ASSUMPTIONS.authHeader]: `${YOCO_API_ASSUMPTIONS.authScheme} ${key}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        cache: "no-store",
        // Never follow a redirect: the key and the payment body go to the
        // configured host only. A redirect rejects, which reads as a network
        // failure — on a send, PAYMENT_UNKNOWN; on a read, fetch_error.
        redirect: "error",
      });
      let parsed: unknown = undefined;
      try {
        const text = await res.text();
        parsed = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        if (timedOut) return { kind: "timeout" };
        parsed = undefined; // an unreadable body is treated as no body
      }
      if (timedOut) return { kind: "timeout" };
      return { kind: "response", status: res.status, body: parsed };
    } catch {
      return timedOut ? { kind: "timeout" } : { kind: "network_error" };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async lookupDevice(deviceId: string): Promise<WebPosDeviceResult> {
      const a = await call("GET", YOCO_API_ASSUMPTIONS.paths.device(deviceId), FETCH_TIMEOUT_MS);
      if (a.kind !== "response") return { kind: "fetch_error" };
      // No such device on Yoco's side: nothing linked to send to.
      if (a.status === 404) return { kind: "device_error" };
      if (a.status < 200 || a.status >= 300) return { kind: "fetch_error" };
      return mapDevice(a.body) ?? { kind: "fetch_error" };
    },

    async sendPayment(input: WebPosSendInput): Promise<WebPosSendResult> {
      if (!Number.isInteger(input.amountZar) || input.amountZar <= 0) {
        // Integer cents only, and L42: a net-R0 order never reaches a send.
        // Refused before any request: nothing was sent.
        return { kind: "gateway_unavailable" };
      }
      const Q = YOCO_API_ASSUMPTIONS.request;
      const a = await call("POST", YOCO_API_ASSUMPTIONS.paths.sendPayment(input.deviceId), SEND_TIMEOUT_MS, {
        [Q.amountField]: input.amountZar,
        [Q.currencyField]: Q.currency,
        client_reference: input.clientReference,
      });
      // No key: no request was made, so nothing was sent.
      if (a.kind === "no_key") return { kind: "gateway_unavailable" };
      // Timed out, or failed at the network: a payment may exist. PAYMENT_UNKNOWN.
      if (a.kind !== "response") return { kind: "timeout" };

      const id = isRecord(a.body) ? a.body[YOCO_API_ASSUMPTIONS.response.paymentIdField] : undefined;
      if (a.status >= 200 && a.status < 300) {
        // Accepted with an id: persist it at once (REQ-029). Accepted WITHOUT a
        // readable id: something may have been created — unknown, not "not sent".
        return nonEmptyString(id) ? { kind: "sent", yocoPaymentId: id } : { kind: "timeout" };
      }
      // An error that nonetheless names a payment: a resource exists, so this is
      // not "an error with no payment id". Unknown; recover by client_reference.
      if (nonEmptyString(id)) return { kind: "timeout" };
      // DEC-25 (Mia, 9 Nov 2026): a 5xx with no id does not prove no payment
      // exists — PAYMENT_UNKNOWN, fail closed. So does any other non-4xx answer
      // (a 1xx/3xx reaching here was never a clean refusal).
      if (a.status < 400 || a.status >= 500) return { kind: "timeout" };
      if (YOCO_API_ASSUMPTIONS.sendDeviceErrorHttpStatuses.includes(a.status)) return { kind: "device_error" };
      // §6.8.4: a 4xx with no payment id. Nothing was sent; a retry is safe.
      return { kind: "gateway_unavailable", httpStatus: a.status };
    },

    async fetchPayment(yocoPaymentId: string): Promise<WebPosFetchResult> {
      const a = await call("GET", YOCO_API_ASSUMPTIONS.paths.payment(yocoPaymentId), FETCH_TIMEOUT_MS);
      if (a.kind !== "response") return { kind: "fetch_error" };
      if (a.status === 404) return { kind: "not_found" };
      if (a.status < 200 || a.status >= 300) return { kind: "fetch_error" };
      const payment = mapPayment(a.body);
      if (!payment || payment.yocoPaymentId !== yocoPaymentId) return { kind: "fetch_error" };
      return { kind: "found", payment };
    },

    async findPaymentsByClientReference(clientReference: string): Promise<WebPosLookupResult> {
      const a = await call(
        "GET",
        YOCO_API_ASSUMPTIONS.paths.paymentsByClientReference(clientReference),
        FETCH_TIMEOUT_MS
      );
      // A 404 here is not "no payment": the route itself may be wrong. Never read as empty.
      if (a.kind !== "response" || a.status < 200 || a.status >= 300) return { kind: "fetch_error" };
      const list = isRecord(a.body) ? a.body[YOCO_API_ASSUMPTIONS.response.listField] : undefined;
      if (!Array.isArray(list)) return { kind: "fetch_error" };
      const payments: WebPosPayment[] = [];
      for (const item of list) {
        const p = mapPayment(item);
        // One unreadable item could be the second charge: the whole read is an error.
        if (!p) return { kind: "fetch_error" };
        // Only this reference is evidence about this attempt.
        if (p.clientReference === clientReference) payments.push(p);
      }
      // Payments came back but none carry this reference: the filter (an
      // UNVERIFIED query parameter) was not applied, so "none found" is not
      // established. A read error, never an empty answer.
      if (list.length > 0 && payments.length === 0) return { kind: "fetch_error" };
      return { kind: "found", payments };
    },
  };
}
