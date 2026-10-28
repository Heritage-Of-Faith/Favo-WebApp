// AT-201: a scriptable, in-memory YocoWebPosPort for tests. It never touches
// the network and never touches live Yoco.
//
// Script each send in order. A send that creates a payment (`sent`, or a
// `timeout` with `createdPaymentId`) takes a list of fetch steps: every fetch
// of that payment — by id or by client_reference — consumes the next step, and
// the last step repeats. With no steps the payment reads `pending` forever.

import type {
  WebPosDeviceResult,
  WebPosFetchResult,
  WebPosLookupResult,
  WebPosPayment,
  WebPosSendInput,
  WebPosSendResult,
  YocoWebPosPort,
} from "./webpos-port";

export type FakeFetchStep =
  | { status: "pending" }
  | { status: "successful"; chargedAmountZar?: number; tipZar?: number }
  | { status: "failed" }
  | { fetchError: true };

export type FakeSendScript =
  | { outcome: "sent"; yocoPaymentId: string; fetches?: FakeFetchStep[] }
  | { outcome: "gateway_unavailable"; httpStatus?: number }
  | { outcome: "device_error" }
  | { outcome: "timeout"; createdPaymentId?: string; fetches?: FakeFetchStep[] };

export type FakeYocoWebPosOptions = {
  sends?: FakeSendScript[];
  device?: WebPosDeviceResult;
};

type FakePayment = {
  yocoPaymentId: string;
  clientReference: string;
  amountZar: number;
  steps: FakeFetchStep[];
  cursor: number;
};

export class FakeYocoWebPosPort implements YocoWebPosPort {
  /** Every send, as received. */
  readonly sends: WebPosSendInput[] = [];
  /** Every fetch by id, in order. */
  readonly fetches: string[] = [];
  /** Every lookup by client_reference, in order. */
  readonly lookups: string[] = [];

  private readonly script: FakeSendScript[];
  private readonly device: WebPosDeviceResult;
  private readonly payments: FakePayment[] = [];

  constructor(opts: FakeYocoWebPosOptions = {}) {
    this.script = [...(opts.sends ?? [])];
    this.device = opts.device ?? { kind: "online", model: "fake", serialNumber: "fake" };
  }

  async lookupDevice(_deviceId: string): Promise<WebPosDeviceResult> {
    return this.device;
  }

  async sendPayment(input: WebPosSendInput): Promise<WebPosSendResult> {
    if (!Number.isInteger(input.amountZar)) {
      throw new Error(`FakeYocoWebPosPort: amountZar must be integer cents, got ${input.amountZar}`);
    }
    this.sends.push({ ...input });
    const next = this.script.shift();
    if (!next) throw new Error("FakeYocoWebPosPort: no scripted send outcome left");

    switch (next.outcome) {
      case "sent":
        this.create(next.yocoPaymentId, input, next.fetches);
        return { kind: "sent", yocoPaymentId: next.yocoPaymentId };
      case "timeout":
        if (next.createdPaymentId) this.create(next.createdPaymentId, input, next.fetches);
        return { kind: "timeout" };
      case "gateway_unavailable":
        return next.httpStatus === undefined
          ? { kind: "gateway_unavailable" }
          : { kind: "gateway_unavailable", httpStatus: next.httpStatus };
      case "device_error":
        return { kind: "device_error" };
    }
  }

  async fetchPayment(yocoPaymentId: string): Promise<WebPosFetchResult> {
    this.fetches.push(yocoPaymentId);
    const p = this.payments.find((x) => x.yocoPaymentId === yocoPaymentId);
    if (!p) return { kind: "not_found" };
    const read = this.advance(p);
    return read === "fetch_error" ? { kind: "fetch_error" } : { kind: "found", payment: read };
  }

  async findPaymentsByClientReference(clientReference: string): Promise<WebPosLookupResult> {
    this.lookups.push(clientReference);
    const found: WebPosPayment[] = [];
    for (const p of this.payments.filter((x) => x.clientReference === clientReference)) {
      const read = this.advance(p);
      if (read === "fetch_error") return { kind: "fetch_error" };
      found.push(read);
    }
    return { kind: "found", payments: found };
  }

  private create(yocoPaymentId: string, input: WebPosSendInput, steps?: FakeFetchStep[]) {
    this.payments.push({
      yocoPaymentId,
      clientReference: input.clientReference,
      amountZar: input.amountZar,
      steps: steps && steps.length > 0 ? steps : [{ status: "pending" }],
      cursor: 0,
    });
  }

  private advance(p: FakePayment): WebPosPayment | "fetch_error" {
    const step = p.steps[Math.min(p.cursor, p.steps.length - 1)];
    p.cursor += 1;
    if ("fetchError" in step) return "fetch_error";
    const base = { yocoPaymentId: p.yocoPaymentId, clientReference: p.clientReference };
    if (step.status === "successful") {
      return {
        ...base,
        status: "successful",
        chargedAmountZar: step.chargedAmountZar ?? p.amountZar,
        tipZar: step.tipZar ?? 0,
      };
    }
    return { ...base, status: step.status, chargedAmountZar: null, tipZar: 0 };
  }
}
