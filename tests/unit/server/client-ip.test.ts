// SEC-1 — the client key must never be chosen by the client: it comes from the
// entry our own trusted proxy appended, never the client-supplied first entry.
import { describe, it, expect, afterEach } from "vitest";
import { clientKeyFrom, normaliseAddress, trustedProxyHops } from "@/server/client-ip";

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("trustedProxyHops", () => {
  it("defaults to one reverse proxy", () => {
    expect(trustedProxyHops()).toBe(1);
  });

  it("reads TRUSTED_PROXY_HOPS when it is a whole number, else falls back to 1", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(trustedProxyHops()).toBe(2);
    process.env.TRUSTED_PROXY_HOPS = "0";
    expect(trustedProxyHops()).toBe(0);
    process.env.TRUSTED_PROXY_HOPS = "lots";
    expect(trustedProxyHops()).toBe(1);
    process.env.TRUSTED_PROXY_HOPS = "-3";
    expect(trustedProxyHops()).toBe(1);
  });
});

describe("normaliseAddress", () => {
  it("unwraps IPv4-mapped IPv6 and strips ports", () => {
    expect(normaliseAddress("::ffff:198.51.100.9")).toBe("198.51.100.9");
    expect(normaliseAddress("198.51.100.9:51234")).toBe("198.51.100.9");
    expect(normaliseAddress("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normaliseAddress("2001:db8::1")).toBe("2001:db8::1");
    expect(normaliseAddress("  ")).toBeNull();
  });
});

describe("clientKeyFrom", () => {
  const key = (xff: string | null, hops: number, cf: string | null = null) =>
    clientKeyFrom({ forwardedFor: xff, cfConnectingIp: cf }, hops);

  it("ignores a spoofed first entry and keys on the address the proxy appended", () => {
    expect(key("203.0.113.77, 198.51.100.9", 1)).toBe("198.51.100.9");
    expect(key("203.0.113.78, 198.51.100.9", 1)).toBe("198.51.100.9");
  });

  it("with two trusted hops takes the second-to-last entry", () => {
    expect(key("6.6.6.6, 198.51.100.9, 10.0.0.2", 2)).toBe("198.51.100.9");
  });

  it("CHANGED: a chain shorter than the hop count uses the RIGHT-MOST entry, never entries[0]", () => {
    expect(key("203.0.113.77, 198.51.100.9", 3)).toBe("198.51.100.9");
  });

  it("normalises the chosen entry", () => {
    expect(key("203.0.113.77, ::ffff:198.51.100.9", 1)).toBe("198.51.100.9");
    expect(key("203.0.113.77, 198.51.100.9:6000", 1)).toBe("198.51.100.9");
  });

  it("hops = 0 (no proxy): the header is all client-written, so it is ignored entirely", () => {
    expect(key("203.0.113.77", 0)).toBe("direct");
    expect(key("203.0.113.78", 0)).toBe("direct");
  });

  it("missing header → one shared key", () => {
    expect(key(null, 1)).toBe("direct");
    expect(key(" , ", 1)).toBe("direct");
  });

  it("prefers CF-Connecting-IP only when the request came through the trusted hop count", () => {
    expect(key("203.0.113.77, 198.51.100.9, 10.0.0.2", 2, "198.51.100.44")).toBe("198.51.100.44");
    // Chain shorter than the hops: it did not come through our proxies — ignore the CF header.
    expect(key("10.0.0.2", 2, "203.0.113.99")).toBe("10.0.0.2");
    // No proxy trusted: never.
    expect(key("10.0.0.2", 0, "203.0.113.99")).toBe("direct");
  });
});
