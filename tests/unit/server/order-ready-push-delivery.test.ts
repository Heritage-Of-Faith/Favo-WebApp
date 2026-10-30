// REQ-165 — a customer push carries no fund balance and no personal data
// beyond the drink name / first name. Real web-push, throwaway VAPID keys, and
// a local http server standing in for the push service (nothing leaves the
// machine). Delivery encryption is real: the server decrypts nothing, so the
// test inspects what web-push would encrypt by spying on sendNotification's
// payload argument while still performing the real HTTP request.

// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import webpush from "web-push";
import { vi } from "vitest";

let server: http.Server;
let port = 0;
const received: { method?: string; url?: string; headers: http.IncomingHttpHeaders; bytes: number }[] = [];

beforeAll(async () => {
  const keys = webpush.generateVAPIDKeys(); // throwaway
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  // web-push always speaks https; route that to the plain-http local server so
  // the request is real but never leaves 127.0.0.1.
  vi.spyOn(https, "request").mockImplementation(((...a: Parameters<typeof http.request>) =>
    http.request(...a)) as unknown as typeof https.request);
  server = http.createServer((req, res) => {
    let bytes = 0;
    req.on("data", (c: Buffer) => (bytes += c.length));
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, bytes });
      res.statusCode = 201;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("sendOrderReadyPush delivery (local fake push service)", () => {
  it("delivers an encrypted payload and the plaintext holds only the drink/first name", async () => {
    const browserKeys = (await import("node:crypto")).createECDH("prime256v1");
    browserKeys.generateKeys();
    const sub = {
      endpoint: `http://127.0.0.1:${port}/push/abc`,
      keys: {
        p256dh: browserKeys.getPublicKey().toString("base64url"),
        auth: Buffer.from("0123456789abcdef").toString("base64url"),
      },
    };

    const spy = vi.spyOn(webpush, "sendNotification");
    const { sendOrderReadyPush } = await import("@/server/push/send");
    const alive = await sendOrderReadyPush(sub, "ord-42", "Thandi");

    expect(alive).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]!.method).toBe("POST");
    expect(received[0]!.headers["content-encoding"]).toBe("aes128gcm");
    expect(received[0]!.headers.authorization).toMatch(/^vapid /);
    expect(received[0]!.bytes).toBeGreaterThan(0);

    const plaintext = String(spy.mock.calls[0]![1]);
    const body = JSON.parse(plaintext);
    expect(Object.keys(body).sort()).toEqual(["body", "data", "tag", "title"]);
    expect(Object.keys(body.data).sort()).toEqual(["orderId", "url"]);
    // REQ-165: no fund balance / ledger, and no contact or money data.
    expect(plaintext).not.toMatch(/balance|fund|ledger|email|phone|msisdn|total|zar|R\d/i);
    spy.mockRestore();
  });

  it("returns false (prune) when the push service answers 410", async () => {
    const gone = http.createServer((_req, res) => { res.statusCode = 410; res.end(); });
    await new Promise<void>((r) => gone.listen(0, "127.0.0.1", r));
    const p = (gone.address() as AddressInfo).port;
    const ecdh = (await import("node:crypto")).createECDH("prime256v1");
    ecdh.generateKeys();
    const { sendOrderReadyPush } = await import("@/server/push/send");
    const alive = await sendOrderReadyPush(
      {
        endpoint: `http://127.0.0.1:${p}/x`,
        keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: Buffer.from("0123456789abcdef").toString("base64url") },
      },
      "ord-1"
    );
    await new Promise<void>((r) => gone.close(() => r()));
    expect(alive).toBe(false);
  });
});
