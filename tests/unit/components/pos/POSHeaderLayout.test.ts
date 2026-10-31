// iPad layout guard: the POS header must be allowed to wrap, never clip.
// Structure-only (source) assertions — no browser needed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../../../../src/components/pos/POSWorkspace.tsx"), "utf8");
const topBar = src.slice(src.indexOf("TOP BAR"), src.indexOf("Bean freshness alert banner"));

describe("POS top bar (iPad 820/1024/1180/1366)", () => {
  it("wraps instead of overflowing", () => {
    expect(topBar).toMatch(/data-pos-header[^>]*className="[^"]*\bflex-wrap\b/);
  });
  it("never wraps the logo text", () => {
    expect(topBar).toMatch(/whitespace-nowrap[^>]*>FAVO · POS/);
  });
  it("puts the bean/container strip in its own horizontally scrollable container", () => {
    expect(topBar).toMatch(/data-pos-strip[^>]*className="[^"]*\boverflow-x-auto\b/);
  });
  it("keeps header controls at 44px", () => {
    expect(topBar.match(/min-h-\[44px\]|h-11 w-11/g)!.length).toBeGreaterThanOrEqual(3);
  });
  it("uses the short search placeholder", () => {
    expect(src).toContain('placeholder="Search name or phone"');
    expect(src).not.toContain("Search name, email");
  });
});
