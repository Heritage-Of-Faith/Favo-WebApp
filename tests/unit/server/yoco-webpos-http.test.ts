// AT-201: the live Web POS HTTP adapter, against a FAKE fetch only. No test
// here reaches the network or Yoco.
//
// PRD v7.0 §6.8.2 (the four calls), §6.8.4 (the error paths), §9.10.2 / L40
// (only the adapter touches the raw response; the masked PAN is dropped),
// REQ-002 (send 10 s; a status fetch 5 s), REQ-010 (GATEWAY_UNAVAILABLE vs
// PAYMENT_UNKNOWN, never conflated), REQ-031 (no copy of a masked PAN),
// REQ-071 (the key never leaves the server). Endpoint paths and most field
// names are UNVERIFIED (YOCO_API_ASSUMPTIONS); these tests pin behaviour, not
// Yoco's wire format.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createYocoWebPosPort,
  SEND_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  YOCO_API_ASSUMPTIONS,
} from "@/server/yoco/webpos-http";

const KEY = "sk_test_FAKE_never_real_9f3c";
const DEVICE = "dev_favo_till";
const REF = "cu_1:1";
// T2 (§6.0.3): a triple shot is "R30 on the machine" = 3000 cents.
const R30 = 3000;
const MASKED_PAN = "411111******1111";

type Call = { url: string; init: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fake fetch that answers each call from a script, and records every call. */
function fakeFetch(...answers: Array<Response | Error | "hang">) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (next === undefined) throw new Error("fakeFetch: no scripted answer left");
    if (next === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  vi.stubEnv("YOCO_SECRET_KEY", KEY);
  // Belt and braces: the real network is unreachable from these tests.
  vi.stubGlobal("fetch", () => {
    throw new Error("real fetch called in a unit test");
  });
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  }
});

afterEach(() => {
  // §9.10.2: the adapter logs nothing — not the key, not a response body.
  for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
  consoleSpies.splice(0).forEach((s) => s.mockRestore());
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("REQ-002: the timeouts the PRD sets", () => {
  it("send is 10 s; one status fetch is 5 s", () => {
    expect(SEND_TIMEOUT_MS).toBe(10_000);
    expect(FETCH_TIMEOUT_MS).toBe(5_000);
  });
});

describe("REQ-031 / L40: the masked PAN never leaves the adapter", () => {
  const RAW = {
    id: "pay_1",
    client_reference: REF,
    status: "successful",
    amount: R30,
    masked_pan: MASKED_PAN,
    card: { masked_pan: MASKED_PAN, holder_name: "J CARDHOLDER", scheme_token: "tok_scheme_abc" },
    redirect_url: "https://example.invalid/merchant-input",
    model: "Khumo Print",
    extra_field: "should-not-survive",
  };

  it("fetchPayment returns only the four declared fields; nothing else survives", async () => {
    const f = fakeFetch(json(200, RAW));
    const res = await createYocoWebPosPort({ fetch: f.fetch }).fetchPayment("pay_1");
    expect(res).toEqual({
      kind: "found",
      payment: { yocoPaymentId: "pay_1", clientReference: REF, status: "successful", chargedAmountZar: 3000 },
    });
    const s = JSON.stringify(res);
    for (const leak of [MASKED_PAN, "1111", "masked", "J CARDHOLDER", "tok_scheme", "redirect", "should-not-survive"]) {
      expect(s).not.toContain(leak);
    }
  });

  it("findPaymentsByClientReference drops them on every item too", async () => {
    const f = fakeFetch(json(200, { data: [RAW, { ...RAW, id: "pay_2" }] }));
    const res = await createYocoWebPosPort({ fetch: f.fetch }).findPaymentsByClientReference(REF);
    const s = JSON.stringify(res);
    expect(s).not.toContain(MASKED_PAN);
    expect(s).not.toContain("J CARDHOLDER");
    expect(s).not.toContain("redirect");
  });

  it("lookupDevice returns only model and serial number", async () => {
    const f = fakeFetch(
      json(200, { id: DEVICE, status: "online", model: "Khumo Print", serial_number: "SN-001", masked_pan: MASKED_PAN, owner: "x" })
    );
    const res = await createYocoWebPosPort({ fetch: f.fetch }).lookupDevice(DEVICE);
    expect(res).toEqual({ kind: "online", model: "Khumo Print", serialNumber: "SN-001" });
    expect(JSON.stringify(res)).not.toContain(MASKED_PAN);
  });
});

describe("sendPayment (§6.8.2, §6.8.4, REQ-010)", () => {
  it("sends the integer cents and client_reference unchanged; returns Yoco's id", async () => {
    const f = fakeFetch(json(201, { id: "pay_1", client_reference: REF, status: "pending", redirect_url: "https://x.invalid" }));
    const res = await createYocoWebPosPort({ fetch: f.fetch }).sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF });
    expect(res).toEqual({ kind: "sent", yocoPaymentId: "pay_1" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].init.method).toBe("POST");
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body[YOCO_API_ASSUMPTIONS.request.amountField]).toBe(3000); // no factor of 100
    expect(body.client_reference).toBe("cu_1:1");
    expect(f.calls[0].url).toContain(DEVICE);
  });

  // CHANGED (DEC-25, Mia 9 Nov 2026): 500/503 used to be pinned here as
  // gateway_unavailable. A 5xx with no id is now PAYMENT_UNKNOWN; only a 4xx
  // with no id is "nothing sent".
  it("a 4xx with no payment id → gateway_unavailable (nothing sent; retry safe)", async () => {
    for (const status of [400, 401, 422]) {
      const f = fakeFetch(json(status, { error: "nope" }));
      const res = await createYocoWebPosPort({ fetch: f.fetch }).sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF });
      expect(res).toEqual({ kind: "gateway_unavailable", httpStatus: status });
    }
  });

  it("DEC-25: a 5xx with no payment id → timeout (PAYMENT_UNKNOWN), never gateway_unavailable", async () => {
    for (const status of [500, 502, 503, 504]) {
      const f = fakeFetch(json(status, { error: "upstream" }));
      const res = await createYocoWebPosPort({ fetch: f.fetch }).sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF });
      expect(res).toEqual({ kind: "timeout" });
      expect(f.calls).toHaveLength(1);
    }
  });

  it("never follows a redirect: the request says redirect 'error', and a redirect answer is unknown", async () => {
    const f = fakeFetch(new TypeError("fetch failed: unexpected redirect"));
    const port = createYocoWebPosPort({ fetch: f.fetch });
    const res = await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF });
    expect(f.calls[0].init.redirect).toBe("error");
    expect(res).toEqual({ kind: "timeout" });
    // A fetch implementation that hands back the 3xx itself is still unknown, never "not sent".
    const g = fakeFetch(new Response(null, { status: 307, headers: { Location: "https://elsewhere.invalid/" } }));
    expect(await createYocoWebPosPort({ fetch: g.fetch }).sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF })).toEqual({
      kind: "timeout",
    });
  });

  it("the reads never follow a redirect either", async () => {
    const f = fakeFetch(json(404, {}), json(404, {}), json(500, {}));
    const port = createYocoWebPosPort({ fetch: f.fetch });
    await port.lookupDevice(DEVICE);
    await port.fetchPayment("pay_1");
    await port.findPaymentsByClientReference(REF);
    for (const c of f.calls) expect(c.init.redirect).toBe("error");
  });

  it("a send that times out at 10 s → timeout (PAYMENT_UNKNOWN), never gateway_unavailable, never retried", async () => {
    vi.useFakeTimers();
    const f = fakeFetch("hang");
    const pending = createYocoWebPosPort({ fetch: f.fetch }).sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF });
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ kind: "timeout" });
    expect(f.calls).toHaveLength(1);
  });

  it("a network failure mid-send → timeout (a payment may exist), called once", async () => {
    const f = fakeFetch(new TypeError("fetch failed"));
    const res = await createYocoWebPosPort({ fetch: f.fetch }).sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF });
    expect(res).toEqual({ kind: "timeout" });
    expect(f.calls).toHaveLength(1);
  });

  it("accepted but no readable id → timeout, not 'not sent'", async () => {
    const f = fakeFetch(json(200, { status: "pending" }));
    const res = await createYocoWebPosPort({ fetch: f.fetch }).sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF });
    expect(res).toEqual({ kind: "timeout" });
  });

  it("an error that names a payment id is NOT 'an error with no id' → timeout", async () => {
    const f = fakeFetch(json(502, { id: "pay_9" }));
    const res = await createYocoWebPosPort({ fetch: f.fetch }).sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF });
    expect(res).toEqual({ kind: "timeout" });
  });

  it("no YOCO_SECRET_KEY → no request at all; gateway_unavailable", async () => {
    vi.stubEnv("YOCO_SECRET_KEY", "");
    const f = fakeFetch();
    const res = await createYocoWebPosPort({ fetch: f.fetch }).sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF });
    expect(res).toEqual({ kind: "gateway_unavailable" });
    expect(f.calls).toHaveLength(0);
  });

  it("a non-integer amount is refused before any request", async () => {
    const f = fakeFetch();
    const res = await createYocoWebPosPort({ fetch: f.fetch }).sendPayment({ deviceId: DEVICE, amountZar: 30.5, clientReference: REF });
    expect(res).toEqual({ kind: "gateway_unavailable" });
    expect(f.calls).toHaveLength(0);
  });
});

describe("REQ-071 / P7: the secret key goes only into the request header", () => {
  it("is read at call time, sent in the header, and absent from every result", async () => {
    const f = fakeFetch(
      json(200, { id: "pay_1" }),
      new Error(`boom ${KEY}`), // even an error that echoes the key is swallowed
      json(500, { message: KEY }),
      "hang"
    );
    vi.useFakeTimers();
    const port = createYocoWebPosPort({ fetch: f.fetch });
    const results: unknown[] = [];
    results.push(await port.sendPayment({ deviceId: DEVICE, amountZar: R30, clientReference: REF }));
    results.push(await port.fetchPayment("pay_1"));
    results.push(await port.lookupDevice(DEVICE));
    const hung = port.findPaymentsByClientReference(REF);
    await vi.advanceTimersByTimeAsync(5_000);
    results.push(await hung);
    for (const r of results) expect(JSON.stringify(r)).not.toContain(KEY);
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers[YOCO_API_ASSUMPTIONS.authHeader]).toContain(KEY);
  });

  it("the module exports no key", async () => {
    const mod = await import("@/server/yoco/webpos-http");
    expect(JSON.stringify(Object.keys(mod))).not.toMatch(/secret|key/i);
  });
});

describe("lookupDevice: online / device_error / fetch_error (§6.8.2)", () => {
  it("a state that is not online → device_error", async () => {
    const f = fakeFetch(json(200, { status: "offline", model: "Khumo Print", serial_number: "SN-001" }));
    expect(await createYocoWebPosPort({ fetch: f.fetch }).lookupDevice(DEVICE)).toEqual({ kind: "device_error" });
  });

  it("online but no terminal model / serial → device_error", async () => {
    const f = fakeFetch(json(200, { status: "online" }));
    expect(await createYocoWebPosPort({ fetch: f.fetch }).lookupDevice(DEVICE)).toEqual({ kind: "device_error" });
  });

  it("no such device (404) → device_error", async () => {
    const f = fakeFetch(json(404, {}));
    expect(await createYocoWebPosPort({ fetch: f.fetch }).lookupDevice(DEVICE)).toEqual({ kind: "device_error" });
  });

  it("5xx, a network failure, an unreadable body → fetch_error", async () => {
    const f = fakeFetch(json(500, {}), new TypeError("fetch failed"), new Response("not json", { status: 200 }));
    const port = createYocoWebPosPort({ fetch: f.fetch });
    expect(await port.lookupDevice(DEVICE)).toEqual({ kind: "fetch_error" });
    expect(await port.lookupDevice(DEVICE)).toEqual({ kind: "fetch_error" });
    expect(await port.lookupDevice(DEVICE)).toEqual({ kind: "fetch_error" });
  });

  it("no answer in 5 s → fetch_error", async () => {
    vi.useFakeTimers();
    const f = fakeFetch("hang");
    const p = createYocoWebPosPort({ fetch: f.fetch }).lookupDevice(DEVICE);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toEqual({ kind: "fetch_error" });
  });
});

describe("fetchPayment: a fetch error is never a status (§6.8.4)", () => {
  const port = (...a: Array<Response | Error | "hang">) => createYocoWebPosPort({ fetch: fakeFetch(...a).fetch });

  it("pending and failed carry no charged amount", async () => {
    expect(await port(json(200, { id: "pay_1", client_reference: REF, status: "pending", amount: R30 })).fetchPayment("pay_1")).toEqual({
      kind: "found",
      payment: { yocoPaymentId: "pay_1", clientReference: REF, status: "pending", chargedAmountZar: null },
    });
    expect(await port(json(200, { id: "pay_1", client_reference: REF, status: "failed" })).fetchPayment("pay_1")).toEqual({
      kind: "found",
      payment: { yocoPaymentId: "pay_1", clientReference: REF, status: "failed", chargedAmountZar: null },
    });
  });

  it("a charged amount different from the ask is returned as charged (R35 = 3500), never overwritten", async () => {
    const r = await port(json(200, { id: "pay_1", client_reference: REF, status: "successful", amount: 3500 })).fetchPayment("pay_1");
    expect(r).toMatchObject({ kind: "found", payment: { chargedAmountZar: 3500 } });
  });

  it("404 → not_found", async () => {
    expect(await port(json(404, {})).fetchPayment("pay_1")).toEqual({ kind: "not_found" });
  });

  it("5xx, timeout-like network failure, a fourth status, rand-not-cents, a different id → fetch_error", async () => {
    expect(await port(json(503, {})).fetchPayment("pay_1")).toEqual({ kind: "fetch_error" });
    expect(await port(new TypeError("fetch failed")).fetchPayment("pay_1")).toEqual({ kind: "fetch_error" });
    for (const status of ["refunded", "voided", "cancelled", "SUCCESSFUL"]) {
      expect(await port(json(200, { id: "pay_1", client_reference: REF, status })).fetchPayment("pay_1")).toEqual({ kind: "fetch_error" });
    }
    expect(
      await port(json(200, { id: "pay_1", client_reference: REF, status: "successful", amount: 30.5 })).fetchPayment("pay_1")
    ).toEqual({ kind: "fetch_error" });
    expect(await port(json(200, { id: "pay_X", client_reference: REF, status: "pending" })).fetchPayment("pay_1")).toEqual({
      kind: "fetch_error",
    });
  });

  it("makes exactly one request per call — the tender chain owns the ×2", async () => {
    const f = fakeFetch(json(500, {}));
    await createYocoWebPosPort({ fetch: f.fetch }).fetchPayment("pay_1");
    expect(f.calls).toHaveLength(1);
  });
});

describe("findPaymentsByClientReference: every payment, so a double charge is seen (§6.8.4)", () => {
  it("two successful payments on one reference → both returned", async () => {
    const f = fakeFetch(
      json(200, {
        data: [
          { id: "pay_1", client_reference: REF, status: "successful", amount: R30 },
          { id: "pay_2", client_reference: REF, status: "successful", amount: R30 },
        ],
      })
    );
    const r = await createYocoWebPosPort({ fetch: f.fetch }).findPaymentsByClientReference(REF);
    expect(r).toEqual({
      kind: "found",
      payments: [
        { yocoPaymentId: "pay_1", clientReference: REF, status: "successful", chargedAmountZar: 3000 },
        { yocoPaymentId: "pay_2", clientReference: REF, status: "successful", chargedAmountZar: 3000 },
      ],
    });
    expect(f.calls[0].url).toContain(encodeURIComponent(REF));
  });

  it("one unreadable item → fetch_error (it could be the second charge), never a silent drop", async () => {
    const f = fakeFetch(
      json(200, { data: [{ id: "pay_1", client_reference: REF, status: "successful", amount: R30 }, { id: "pay_2" }] })
    );
    expect(await createYocoWebPosPort({ fetch: f.fetch }).findPaymentsByClientReference(REF)).toEqual({ kind: "fetch_error" });
  });

  // CHANGED (coordinator review, 9 Nov 2026): this used to pin found-empty.
  // Items that all carry another reference mean the filter was not applied,
  // so "no payment" is not established: a read error.
  it("items returned but none on this reference → fetch_error, never found-empty", async () => {
    const f = fakeFetch(json(200, { data: [{ id: "pay_7", client_reference: "cu_1:2", status: "successful", amount: R30 }] }));
    expect(await createYocoWebPosPort({ fetch: f.fetch }).findPaymentsByClientReference(REF)).toEqual({ kind: "fetch_error" });
  });

  it("a payment on another reference is not evidence about this one (mixed list → only ours)", async () => {
    const f = fakeFetch(
      json(200, {
        data: [
          { id: "pay_7", client_reference: "cu_1:2", status: "successful", amount: R30 },
          { id: "pay_1", client_reference: REF, status: "pending" },
        ],
      })
    );
    expect(await createYocoWebPosPort({ fetch: f.fetch }).findPaymentsByClientReference(REF)).toEqual({
      kind: "found",
      payments: [{ yocoPaymentId: "pay_1", clientReference: REF, status: "pending", chargedAmountZar: null }],
    });
  });

  it("an empty list → found, none", async () => {
    const f = fakeFetch(json(200, { data: [] }));
    expect(await createYocoWebPosPort({ fetch: f.fetch }).findPaymentsByClientReference(REF)).toEqual({ kind: "found", payments: [] });
  });

  it("404, 5xx, a non-list body → fetch_error, never read as 'no payment'", async () => {
    for (const a of [json(404, {}), json(500, {}), json(200, { data: "x" })]) {
      const f = fakeFetch(a);
      expect(await createYocoWebPosPort({ fetch: f.fetch }).findPaymentsByClientReference(REF)).toEqual({ kind: "fetch_error" });
    }
  });
});
