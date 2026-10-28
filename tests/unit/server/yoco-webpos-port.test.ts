// AT-201 part 1: the Yoco Web POS port and its scriptable fake.
//
// PRD v7.0 §6.8.2 (the four calls), §6.8.4 (the error paths), §0 S2 / §6.0.1
// (GATEWAY_UNAVAILABLE vs PAYMENT_UNKNOWN), §11.2 (sendToTerminal), REQ-010,
// REQ-029, REQ-030. Yoco's Web POS payment resource reports exactly
// `pending | successful | failed` (§6.0.1: "FAVO does not invent a fourth
// status"). Amounts are integer cents on both sides — no factor of 100.

import { describe, it, expect } from "vitest";
import { FakeYocoWebPosPort } from "@/server/yoco/webpos-fake";
import type { YocoWebPosPort } from "@/server/yoco/webpos-port";

const DEVICE = "dev_favo_till";
// T2 (§6.0.3): a triple shot is R20 + R10 = "R30 on the machine" = 3000 cents.
const R30 = 3000;

describe("YocoWebPosPort fake — send outcomes (REQ-010, REQ-029)", () => {
  it("sent: returns Yoco's payment id, and the amount reaches the machine as cents, unchanged", async () => {
    const port: YocoWebPosPort = new FakeYocoWebPosPort({
      sends: [{ outcome: "sent", yocoPaymentId: "pay_1", fetches: [{ status: "pending" }] }],
    });
    const res = await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_1:1" });
    expect(res).toEqual({ kind: "sent", yocoPaymentId: "pay_1" });
    expect((port as FakeYocoWebPosPort).sends).toEqual([
      { deviceId: DEVICE, amountZar: 3000, clientReference: "cu_1:1" },
    ]);
  });

  it("refuses a non-integer amount — money is integer cents", async () => {
    const port = new FakeYocoWebPosPort({ sends: [{ outcome: "sent", yocoPaymentId: "pay_x" }] });
    await expect(
      port.sendPayment({ deviceId: DEVICE, amountZar: 30.5, clientReference: "cu_1:1" })
    ).rejects.toThrow(/integer cents/);
  });

  it("gateway_unavailable: an error with no payment id, and nothing exists to look up", async () => {
    const port = new FakeYocoWebPosPort({ sends: [{ outcome: "gateway_unavailable", httpStatus: 503 }] });
    const res = await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_2:1" });
    expect(res).toEqual({ kind: "gateway_unavailable", httpStatus: 503 });
    expect(await port.findPaymentsByClientReference("cu_2:1")).toEqual({ kind: "found", payments: [] });
  });

  it("device_error: the machine is off or off the wifi before the send — no payment id", async () => {
    const port = new FakeYocoWebPosPort({ sends: [{ outcome: "device_error" }] });
    const res = await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_3:1" });
    expect(res).toEqual({ kind: "device_error" });
    expect(await port.findPaymentsByClientReference("cu_3:1")).toEqual({ kind: "found", payments: [] });
  });

  it("timeout: is distinct from gateway_unavailable, and a payment Yoco did create is recoverable by client_reference", async () => {
    const port = new FakeYocoWebPosPort({
      sends: [{ outcome: "timeout", createdPaymentId: "pay_t", fetches: [{ status: "successful" }] }],
    });
    const res = await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_4:1" });
    expect(res).toEqual({ kind: "timeout" });
    expect(res.kind).not.toBe("gateway_unavailable");
    const found = await port.findPaymentsByClientReference("cu_4:1");
    expect(found).toEqual({
      kind: "found",
      payments: [
        { yocoPaymentId: "pay_t", clientReference: "cu_4:1", status: "successful", chargedAmountZar: 3000, tipZar: 0 },
      ],
    });
  });

  it("throws when no send outcome was scripted (a test must say what Yoco does)", async () => {
    const port = new FakeYocoWebPosPort();
    await expect(
      port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_5:1" })
    ).rejects.toThrow(/no scripted send/);
  });
});

describe("YocoWebPosPort fake — fetch outcomes (§6.8.4, REQ-008, REQ-030)", () => {
  it("pending, then successful with the charged amount (defaults to the sent amount)", async () => {
    const port = new FakeYocoWebPosPort({
      sends: [{ outcome: "sent", yocoPaymentId: "pay_s", fetches: [{ status: "pending" }, { status: "successful" }] }],
    });
    await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_6:1" });
    expect(await port.fetchPayment("pay_s")).toEqual({
      kind: "found",
      payment: { yocoPaymentId: "pay_s", clientReference: "cu_6:1", status: "pending", chargedAmountZar: null, tipZar: 0 },
    });
    expect(await port.fetchPayment("pay_s")).toEqual({
      kind: "found",
      payment: { yocoPaymentId: "pay_s", clientReference: "cu_6:1", status: "successful", chargedAmountZar: 3000, tipZar: 0 },
    });
    // The last scripted step is sticky.
    expect((await port.fetchPayment("pay_s")).kind).toBe("found");
    expect(port.fetches).toEqual(["pay_s", "pay_s", "pay_s"]);
  });

  it("successful at a different charged amount is reported as charged, never as asked", async () => {
    const port = new FakeYocoWebPosPort({
      sends: [{ outcome: "sent", yocoPaymentId: "pay_v", fetches: [{ status: "successful", chargedAmountZar: 3300, tipZar: 300 }] }],
    });
    await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_7:1" });
    const res = await port.fetchPayment("pay_v");
    expect(res.kind === "found" && res.payment.chargedAmountZar).toBe(3300);
    expect(res.kind === "found" && res.payment.tipZar).toBe(300);
  });

  it("failed: a declined card is Yoco's `failed`, not a FAVO status", async () => {
    const port = new FakeYocoWebPosPort({
      sends: [{ outcome: "sent", yocoPaymentId: "pay_f", fetches: [{ status: "failed" }] }],
    });
    await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_8:1" });
    const res = await port.fetchPayment("pay_f");
    expect(res.kind === "found" && res.payment.status).toBe("failed");
    expect(res.kind === "found" && res.payment.chargedAmountZar).toBeNull();
  });

  it("fetch_error is never a status — the machine dropped off the wifi after the send", async () => {
    const port = new FakeYocoWebPosPort({
      sends: [{
        outcome: "sent",
        yocoPaymentId: "pay_e",
        fetches: [{ status: "pending" }, { fetchError: true }, { status: "successful" }],
      }],
    });
    await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_9:1" });
    expect((await port.fetchPayment("pay_e")).kind).toBe("found");
    const err = await port.fetchPayment("pay_e");
    expect(err).toEqual({ kind: "fetch_error" });
    expect("payment" in err).toBe(false);
    expect((await port.findPaymentsByClientReference("cu_9:1")).kind).toBe("found");
  });

  it("an unknown payment id is not_found, not an error and not a status", async () => {
    const port = new FakeYocoWebPosPort();
    expect(await port.fetchPayment("pay_nope")).toEqual({ kind: "not_found" });
  });

  it("lookup by client_reference returns every payment on that reference (two = a double charge, §6.8.4)", async () => {
    const port = new FakeYocoWebPosPort({
      sends: [
        { outcome: "sent", yocoPaymentId: "pay_a", fetches: [{ status: "successful" }] },
        { outcome: "sent", yocoPaymentId: "pay_b", fetches: [{ status: "successful" }] },
      ],
    });
    await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_10:1" });
    await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_10:1" });
    const res = await port.findPaymentsByClientReference("cu_10:1");
    expect(res.kind === "found" && res.payments.map((p) => p.yocoPaymentId)).toEqual(["pay_a", "pay_b"]);
  });

  it("the port's payment carries only the declared fields (no PAN of any kind, REQ-031)", async () => {
    const port = new FakeYocoWebPosPort({
      sends: [{ outcome: "sent", yocoPaymentId: "pay_k", fetches: [{ status: "successful" }] }],
    });
    await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: "cu_11:1" });
    const res = await port.fetchPayment("pay_k");
    expect(res.kind === "found" && Object.keys(res.payment).sort()).toEqual(
      ["chargedAmountZar", "clientReference", "status", "tipZar", "yocoPaymentId"]
    );
  });
});

describe("YocoWebPosPort fake — device lookup (§6.8.2)", () => {
  it("online with model and serial; device_error; fetch_error", async () => {
    const online = new FakeYocoWebPosPort({ device: { kind: "online", model: "Khumo Print", serialNumber: "SN1" } });
    expect(await online.lookupDevice(DEVICE)).toEqual({ kind: "online", model: "Khumo Print", serialNumber: "SN1" });
    expect(await new FakeYocoWebPosPort({ device: { kind: "device_error" } }).lookupDevice(DEVICE)).toEqual({ kind: "device_error" });
    expect(await new FakeYocoWebPosPort({ device: { kind: "fetch_error" } }).lookupDevice(DEVICE)).toEqual({ kind: "fetch_error" });
  });
});
