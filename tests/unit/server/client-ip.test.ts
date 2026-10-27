// SEC-1 — the rate-limit client key must come from a trusted hop, never from
// the client-supplied first entry of X-Forwarded-For.
import { describe, it, expect, afterEach } from "vitest";
import { clientKeyFromForwardedFor, trustedProxyHops } from "@/server/client-ip";

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("trustedProxyHops", () => {
  it("defaults to one reverse proxy", () => {
    expect(trustedProxyHops()).toBe(1);
  });

  it("reads TRUSTED_PROXY_HOPS when it is a whole number", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(trustedProxyHops()).toBe(2);
  });

  it("falls back to 1 on junk", () => {
    process.env.TRUSTED_PROXY_HOPS = "lots";
    expect(trustedProxyHops()).toBe(1);
    process.env.TRUSTED_PROXY_HOPS = "-3";
    expect(trustedProxyHops()).toBe(1);
  });
});

describe("clientKeyFromForwardedFor", () => {
  it("ignores a spoofed first entry and keys on the address the proxy appended", () => {
    // Client sent X-Forwarded-For: 203.0.113.77; the proxy appended 198.51.100.9.
    expect(clientKeyFromForwardedFor("203.0.113.77, 198.51.100.9", 1)).toBe("198.51.100.9");
    // Rotating the spoofed value does not change the key.
    expect(clientKeyFromForwardedFor("203.0.113.78, 198.51.100.9", 1)).toBe("198.51.100.9");
  });

  it("with two trusted hops takes the second-to-last entry", () => {
    expect(clientKeyFromForwardedFor("6.6.6.6, 198.51.100.9, 10.0.0.2", 2)).toBe("198.51.100.9");
  });

  it("uses the first entry when the chain is shorter than the hop count", () => {
    expect(clientKeyFromForwardedFor("198.51.100.9", 2)).toBe("198.51.100.9");
  });

  it("returns 'anonymous' when the header is missing or empty", () => {
    expect(clientKeyFromForwardedFor(null, 1)).toBe("anonymous");
    expect(clientKeyFromForwardedFor(" , ", 1)).toBe("anonymous");
  });

  it("returns 'anonymous' when no proxy is trusted (hops = 0)", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(trustedProxyHops()).toBe(0);
    expect(clientKeyFromForwardedFor("203.0.113.77", 0)).toBe("anonymous");
  });
});
