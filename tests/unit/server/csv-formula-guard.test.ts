// SEC-8 — CSV formula injection: a text cell starting with = + - @ (or tab / CR)
// is prefixed with a single quote so Excel/Sheets show it as text, in every
// CSV writer. Numbers (e.g. a negative margin in cents) are left as numbers.
import { describe, it, expect, vi } from "vitest";

const execute = vi.fn();
const selectWhere = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    execute: (...a: unknown[]) => execute(...a),
    select: () => ({ from: () => ({ where: (...a: unknown[]) => selectWhere(...a) }) }),
  },
}));

import { csvCell } from "@/server/reports/csv";
import { formatZar } from "@/lib/format";
import { rowsToCsv } from "@/server/reports/export-csv";
import { buildSalesCsv } from "@/server/reports/sales-csv";
import { buildInventoryCsv } from "@/server/reports/inventory-csv";
import { buildMonthlyPnlCsv } from "@/server/reports/monthly-pnl-csv";

describe("csvCell", () => {
  it.each([
    ["=HYPERLINK(\"http://evil\")", "\"'=HYPERLINK(\"\"http://evil\"\")\""],
    ["+27 82", "'+27 82"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tcmd", "'\tcmd"],
    ["=1,2", "\"'=1,2\""],
  ])("neutralises %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("leaves ordinary text, numbers and empty cells alone", () => {
    expect(csvCell("Louis")).toBe("Louis");
    expect(csvCell(-500)).toBe("-500");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell(null)).toBe("");
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("CHANGED: rand amounts and signed numbers are not formulas — no prefix", () => {
    expect(csvCell("-R12,50")).toBe('"-R12,50"');
    expect(csvCell("-R 12,50")).toBe('"-R 12,50"');
    expect(csvCell("-R 1 234 567,89")).toBe('"-R 1 234 567,89"');
    expect(csvCell("+12,5")).toBe('"+12,5"');
    // Exactly what the sales / P&L writers emit for a negative amount.
    const neg = formatZar(-123456789);
    expect(csvCell(neg)).toBe(`"${neg}"`);
    expect(csvCell("-12.5")).toBe("-12.5");
  });

  it("but text that merely starts like money is still neutralised", () => {
    expect(csvCell("-R12+cmd")).toBe("'-R12+cmd");
    expect(csvCell("-1+1")).toBe("'-1+1");
  });
});

describe("every CSV writer uses the guard", () => {
  it("COGS rowsToCsv", () => {
    const csv = rowsToCsv([
      // Row shape after the cost chain (AT-189..192): expenses, net, cost status.
      { date: "=cmd", revenueZar: 100, cogsZar: 50, grossMarginZar: -50, grossMarginPct: -50, expensesZar: 0, netZar: -50, costStatus: "final" },
    ] as unknown as Parameters<typeof rowsToCsv>[0]);
    expect(csv.split("\r\n")[1]).toBe("'=cmd,100,50,-50,-50,0,-50,final");
  });

  it("sales CSV — customer name", async () => {
    execute.mockResolvedValueOnce([
      { order_id: "o1", placed_at_sast: "2026-10-25 09:00", customer_name: "=HYPERLINK(1)", total_zar: 3500, state: "collected" },
    ]);
    const csv = await buildSalesCsv("2026-10-25", "2026-10-25");
    expect(csv.split("\r\n")[1]).toContain(",'=HYPERLINK(1),");
  });

  it("inventory CSV — item name", async () => {
    execute.mockResolvedValueOnce([
      { lot_id: "l1", item: "@evil", origin: "+x", qty_remaining: 3, last_movement_at: null, state: "active" },
    ]);
    const csv = await buildInventoryCsv();
    expect(csv.split("\r\n")[1]).toBe("l1,'@evil,'+x,3,,active");
  });

  it("monthly P&L CSV — signer name", async () => {
    selectWhere.mockResolvedValueOnce([
      { month: "2026-09", revenueZar: 0, cogsZar: 0, grossMarginZar: 0, netZar: 0, costState: "final", cogsAbsentItems: [], ordersWithoutCost: 0, status: "draft", adminSig: { signerName: "-1+1", at: "x" } },
    ]);
    const csv = await buildMonthlyPnlCsv("2026-09-01", "2026-09-30");
    expect(csv.split("\r\n")[1]!.endsWith(",'-1+1 (x)")).toBe(true);
  });
});
