// @vitest-environment node
// SEC-6 — API routes that parse JSON refuse bodies over ~100 KB with 413.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn().mockResolvedValue({ id: "staff-1", role: "barista", name: "Louis" }),
}));
vi.mock("@/server/auth/customer-session", () => ({ getCustomerSession: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/server/sync/apply-outbox", async () => {
  const { z } = await import("zod");
  return { applyOutboxItem: vi.fn(), outboxItemSchema: z.object({ staffId: z.string() }) };
});

import { POST as syncOrders } from "@/app/api/sync/orders/route";
import { POST as pushSubscribe } from "@/app/api/push/subscribe/route";
import { readJsonBody, MAX_JSON_BODY_BYTES } from "@/server/http/request-guards";

const big = JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) }); // ~2 MB, as in the QA probe

function post(body: string, headers: Record<string, string> = {}) {
  return new Request("http://x/api", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}

function streamed(body: string) {
  // No Content-Length: the body arrives as a stream.
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 16_384) c.enqueue(bytes.slice(i, i + 16_384));
      c.close();
    },
  });
  return new Request("http://x/api", { method: "POST", body: stream, duplex: "half" } as RequestInit);
}

describe("readJsonBody", () => {
  it("cap is 100 KB", () => {
    expect(MAX_JSON_BODY_BYTES).toBe(100 * 1024);
  });
  it("413 on a large body, even without a Content-Length", async () => {
    expect(await readJsonBody(post(big))).toEqual({ ok: false, status: 413 });
    expect(await readJsonBody(streamed(big))).toEqual({ ok: false, status: 413 });
  });
  it("400 on bad JSON, value on good JSON", async () => {
    expect(await readJsonBody(post("{nope"))).toEqual({ ok: false, status: 400 });
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe("routes", () => {
  it("POST /api/sync/orders → 413 for a 2 MB body", async () => {
    const res = await syncOrders(post(big));
    expect(res.status).toBe(413);
  });
  it("POST /api/sync/orders keeps 400 for bad JSON", async () => {
    expect((await syncOrders(post("{nope"))).status).toBe(400);
  });
  it("POST /api/push/subscribe → 413 for a 2 MB body", async () => {
    const res = await pushSubscribe(post(big));
    expect(res.status).toBe(413);
  });
});
