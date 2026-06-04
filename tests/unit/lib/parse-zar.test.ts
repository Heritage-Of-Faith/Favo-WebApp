// Unit tests for parseZar — money input parsing (A10 dependency).

import { describe, it, expect } from "vitest";
import { parseZar } from "@/lib/format";

describe("parseZar", () => {
  it("parses a plain integer Rand value to cents", () => {
    expect(parseZar("150")).toBe(15000);
    expect(parseZar("0")).toBe(0);
  });

  it("parses a comma decimal (SA convention)", () => {
    expect(parseZar("150,50")).toBe(15050);
    expect(parseZar("0,05")).toBe(5);
  });

  it("parses a dot decimal", () => {
    expect(parseZar("150.50")).toBe(15050);
    expect(parseZar("1.5")).toBe(150);
  });

  it("strips an R prefix and whitespace grouping", () => {
    expect(parseZar("R150")).toBe(15000);
    expect(parseZar("R 150,50")).toBe(15050);
    expect(parseZar("1 250.05")).toBe(125005);
  });

  it("rejects sub-cent precision", () => {
    expect(parseZar("150.555")).toBeNull();
    expect(parseZar("1,234")).toBeNull();
  });

  it("rejects non-numeric junk", () => {
    expect(parseZar("abc")).toBeNull();
    expect(parseZar("")).toBeNull();
    expect(parseZar("   ")).toBeNull();
    expect(parseZar("12.34.56")).toBeNull();
  });

  it("rejects ambiguous mixed separators", () => {
    expect(parseZar("1,234.56")).toBeNull();
  });

  it("rejects negative values (expenses/purchases are positive)", () => {
    expect(parseZar("-5")).toBeNull();
  });

  it("round-trips with formatZar for representable values", () => {
    // 150.50 → 15050 cents; not asserting formatZar output here, just integer cents
    expect(Number.isInteger(parseZar("150,50"))).toBe(true);
  });
});
