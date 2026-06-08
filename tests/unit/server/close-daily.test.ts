// closeDaily unit tests — G10
// Tests pure helpers (dayBounds, varianceBand) without DB or network.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dayBounds, varianceBand } from "@/server/crons/close-daily";

// ─── varianceBand ─────────────────────────────────────────────────────────────

describe("varianceBand — T01 thresholds", () => {
  it("0% → ok", () => expect(varianceBand(0)).toBe("ok"));
  it("4.99% → ok", () => expect(varianceBand(4.99)).toBe("ok"));
  it("5% → investigate", () => expect(varianceBand(5)).toBe("investigate"));
  it("9.99% → investigate", () => expect(varianceBand(9.99)).toBe("investigate"));
  it("10% → critical", () => expect(varianceBand(10)).toBe("critical"));
  it("50% → critical", () => expect(varianceBand(50)).toBe("critical"));
});

// ─── dayBounds ────────────────────────────────────────────────────────────────

describe("dayBounds", () => {
  it("returns a YYYY-MM-DD date string in SAST", () => {
    // 2026-06-08 10:00 UTC = 12:00 SAST → date should be 2026-06-08
    const ref = new Date("2026-06-08T10:00:00Z");
    const { date } = dayBounds(ref);
    expect(date).toBe("2026-06-08");
  });

  it("00:30 SAST still belongs to same day", () => {
    // 2026-06-08 22:30 UTC = 00:30+1 SAST next day → date should be 2026-06-09
    const ref = new Date("2026-06-08T22:30:00Z");
    const { date } = dayBounds(ref);
    expect(date).toBe("2026-06-09");
  });

  it("23:59 UTC+2 crosses midnight correctly", () => {
    // 2026-06-07 21:59 UTC = 23:59 SAST on 2026-06-07 → date 2026-06-07
    const ref = new Date("2026-06-07T21:59:00Z");
    const { date } = dayBounds(ref);
    expect(date).toBe("2026-06-07");
  });

  it("start is before end", () => {
    const { start, end } = dayBounds(new Date("2026-06-08T10:00:00Z"));
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it("span is exactly 24 hours minus 1ms", () => {
    const { start, end } = dayBounds(new Date("2026-06-08T10:00:00Z"));
    const diffMs = end.getTime() - start.getTime();
    expect(diffMs).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it("start is exactly midnight SAST (22:00 UTC)", () => {
    const ref = new Date("2026-06-08T10:00:00Z");
    const { start } = dayBounds(ref);
    // 2026-06-08 00:00 SAST = 2026-06-07 22:00 UTC
    expect(start.toISOString()).toBe("2026-06-07T22:00:00.000Z");
  });
});

// ─── closeDaily — DB integration (mocked) ────────────────────────────────────

vi.mock("@db/index", () => {
  return {
    db: {
      select: vi.fn(),
      execute: vi.fn(),
    },
  };
});

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/discord/webhook", () => ({
  pingFavoOps: vi.fn().mockResolvedValue(undefined),
  formatZarField: vi.fn((n: number) => `R ${n}`),
}));

describe("closeDaily — reconciliation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok band when revenue matches payments", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: 100000 }]),
      }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.execute).mockResolvedValueOnce([{ total: "100000" }] as unknown as Awaited<ReturnType<typeof db.execute>>);

    const { closeDaily } = await import("@/server/crons/close-daily");
    const result = await closeDaily(new Date("2026-06-08T10:00:00Z"));

    expect(result.band).toBe("ok");
    expect(result.variancePct).toBe(0);
  });

  it("returns critical band on >10% mismatch and pings Discord", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: 100000 }]),
      }),
    } as unknown as ReturnType<typeof db.select>);
    // Payments only 80% of revenue → 20% variance
    vi.mocked(db.execute).mockResolvedValueOnce([{ total: "80000" }] as unknown as Awaited<ReturnType<typeof db.execute>>);

    const { closeDaily } = await import("@/server/crons/close-daily");
    const result = await closeDaily(new Date("2026-06-08T10:00:00Z"));

    expect(result.band).toBe("critical");
    const { pingFavoOps } = await import("@/server/discord/webhook");
    expect(vi.mocked(pingFavoOps)).toHaveBeenCalledOnce();
  });

  it("does NOT ping Discord when band is ok", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: 50000 }]),
      }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.execute).mockResolvedValueOnce([{ total: "50000" }] as unknown as Awaited<ReturnType<typeof db.execute>>);

    const { closeDaily } = await import("@/server/crons/close-daily");
    await closeDaily(new Date("2026-06-08T10:00:00Z"));

    const { pingFavoOps } = await import("@/server/discord/webhook");
    expect(vi.mocked(pingFavoOps)).not.toHaveBeenCalled();
  });

  it("returns investigate band on 7% mismatch", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: 100000 }]),
      }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.execute).mockResolvedValueOnce([{ total: "93000" }] as unknown as Awaited<ReturnType<typeof db.execute>>);

    const { closeDaily } = await import("@/server/crons/close-daily");
    const result = await closeDaily(new Date("2026-06-08T10:00:00Z"));

    expect(result.band).toBe("investigate");
    expect(result.variancePct).toBeCloseTo(7, 0);
  });

  it("writes an audit row on every run", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: 0 }]),
      }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.execute).mockResolvedValueOnce([{ total: "0" }] as unknown as Awaited<ReturnType<typeof db.execute>>);

    const { closeDaily } = await import("@/server/crons/close-daily");
    await closeDaily(new Date("2026-06-08T10:00:00Z"));

    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(writeAudit).mock.calls[0][0];
    expect(auditCall.action).toBe("daily_close");
  });
});
