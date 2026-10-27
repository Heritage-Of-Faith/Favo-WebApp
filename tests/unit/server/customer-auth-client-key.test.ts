// SEC-1 — the customer login/register throttles share the trusted client key:
// a spoofed first X-Forwarded-For entry must not pick the rate-limit bucket.
import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (n: string) => (n.toLowerCase() === "x-forwarded-for" ? "203.0.113.77, 198.51.100.9" : null),
  })),
}));

const mockCheckRateLimit = vi.fn().mockReturnValue({ allowed: false, retryAfterSecs: 30 });
vi.mock("@/server/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn() }));

import { loginCustomer } from "@/server/actions/customer-auth";

describe("customer-auth rate-limit key", () => {
  it("keys loginCustomer on the proxy-appended address, not the client-sent one", async () => {
    await loginCustomer({ email: "a@b.co", password: "whatever1" });
    expect(mockCheckRateLimit).toHaveBeenCalledWith("login:198.51.100.9", 5, 60_000);
  });
});
