// @vitest-environment node
// SEC-5 — malformed input gets a clean 400 with a safe message, never a bare 500.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn().mockResolvedValue({ id: "staff-olivia", role: "admin", name: "Olivia" }),
}));
const computeCogsLive = vi.fn().mockResolvedValue({ date: "2026-10-25" });
vi.mock("@/server/cogs/compute", () => ({
  getCogsLive: (d: string) => computeCogsLive(d),
  todaySast: () => "2026-10-26",
}));
const buildReportRows = vi.fn().mockResolvedValue([]);
vi.mock("@/server/reports/export-csv", () => ({
  buildReportRows: (...a: unknown[]) => buildReportRows(...a),
  rowsToCsv: () => "Date\r\n",
}));
vi.mock("@/server/reports/sales-csv", () => ({ buildSalesCsv: vi.fn().mockResolvedValue("") }));
vi.mock("@/server/reports/inventory-csv", () => ({ buildInventoryCsv: vi.fn().mockResolvedValue("") }));
vi.mock("@/server/reports/monthly-pnl-csv", () => ({ buildMonthlyPnlCsv: vi.fn().mockResolvedValue("") }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

import { GET as cogsLive } from "@/app/api/cogs/live/route";
import { GET as exportReport } from "@/app/api/reports/export/route";

beforeEach(() => {
  computeCogsLive.mockClear();
  buildReportRows.mockClear();
});

describe("GET /api/cogs/live — date validation", () => {
  it("rejects an impossible calendar date with 400 and does not compute", async () => {
    const res = await cogsLive(new NextRequest("http://x/api/cogs/live?date=1999-13-45"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "date must be a real calendar date in YYYY-MM-DD format." });
    expect(computeCogsLive).not.toHaveBeenCalled();
  });

  it("rejects 2026-02-30 (right shape, not a real day)", async () => {
    const res = await cogsLive(new NextRequest("http://x/api/cogs/live?date=2026-02-30"));
    expect(res.status).toBe(400);
  });

  it("rejects an empty date= with 400, not a bare 500 (QA R2-SEC-2)", async () => {
    const res = await cogsLive(new NextRequest("http://x/api/cogs/live?date="));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "date must be a real calendar date in YYYY-MM-DD format." });
    expect(computeCogsLive).not.toHaveBeenCalled();
  });

  it("accepts a real date and still defaults to today when absent", async () => {
    expect((await cogsLive(new NextRequest("http://x/api/cogs/live?date=2024-02-29"))).status).toBe(200);
    expect(computeCogsLive).toHaveBeenLastCalledWith("2024-02-29");
    expect((await cogsLive(new NextRequest("http://x/api/cogs/live"))).status).toBe(200);
    expect(computeCogsLive).toHaveBeenLastCalledWith("2026-10-26");
  });
});

describe("GET /api/reports/export — from/to validation and range cap", () => {
  const url = (q: string) => new NextRequest(`http://x/api/reports/export?kind=cogs&format=csv&${q}`);

  it("rejects an impossible date with 400", async () => {
    const res = await exportReport(url("from=2026-13-01&to=2026-13-02"));
    expect(res.status).toBe(400);
    expect(buildReportRows).not.toHaveBeenCalled();
  });

  it("rejects a range longer than 366 days with 400 and a safe message", async () => {
    const res = await exportReport(url("from=0001-01-01&to=9999-12-31"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "The date range can be at most 366 days." });
    expect(buildReportRows).not.toHaveBeenCalled();
  });

  it("accepts exactly 366 days (a leap year)", async () => {
    const res = await exportReport(url("from=2024-01-01&to=2024-12-31"));
    expect(res.status).toBe(200);
  });

  it("rejects 367 days", async () => {
    const res = await exportReport(url("from=2024-01-01&to=2025-01-01"));
    expect(res.status).toBe(400);
  });
});
