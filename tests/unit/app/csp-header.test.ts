// SEC-4 — a Content-Security-Policy header next to the existing security headers.
import { describe, it, expect, afterEach } from "vitest";
import nextConfig from "../../../next.config";

async function headerMap(): Promise<Map<string, string>> {
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === "/:path*")!;
  return new Map(all.headers.map((h) => [h.key, h.value]));
}

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...vals] = d.split(/\s+/);
      return [name!, vals];
    })
  );
}

const ORIGINAL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
afterEach(() => {
  if (ORIGINAL_SUPABASE === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_SUPABASE;
});

describe("Content-Security-Policy", () => {
  it("is set and keeps the existing security headers", async () => {
    const h = await headerMap();
    expect(h.get("Content-Security-Policy")).toBeDefined();
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("locks the core directives (no unsafe-eval outside development)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const d = directives((await headerMap()).get("Content-Security-Policy")!);
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("script-src")).toContain("'self'");
    expect(d.get("script-src")).not.toContain("'unsafe-eval'");
    expect(d.get("img-src")).toEqual(expect.arrayContaining(["'self'", "data:"]));
    expect(d.get("connect-src")).toContain("'self'");
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("worker-src")).toEqual(["'self'"]); // service workers /sw.js, /pos-sw.js
    expect(d.get("manifest-src")).toEqual(["'self'"]);
    // Must not upgrade requests: the practice host is plain http on the LAN.
    expect(d.has("upgrade-insecure-requests")).toBe(false);
  });

  it("allows the Google Fonts the root layout loads", async () => {
    const d = directives((await headerMap()).get("Content-Security-Policy")!);
    expect(d.get("style-src")).toContain("https://fonts.googleapis.com");
    expect(d.get("font-src")).toContain("https://fonts.gstatic.com");
  });

  it("adds the Supabase origin (https and wss) to connect-src when configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcd.supabase.co/";
    const d = directives((await headerMap()).get("Content-Security-Policy")!);
    expect(d.get("connect-src")).toEqual(
      expect.arrayContaining(["'self'", "https://abcd.supabase.co", "wss://abcd.supabase.co"])
    );
  });

  it("ignores a Supabase value that is not a URL", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "<from .env.local>";
    const csp = (await headerMap()).get("Content-Security-Policy")!;
    expect(csp).not.toContain("<from");
  });
});
