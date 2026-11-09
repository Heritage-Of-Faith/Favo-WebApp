// DEC-23 (Mia, 9 Nov 2026): §9.6.2 job 7 is delivered as an Admin banner, not a
// timer. PRD §6.10.4 / T14: "At 150 days with no draw the Admin is alerted so
// the donor can be asked. At 180 the balance is proposed for sweep." §9.6.2
// job 7: "At T14 minus 30 days … it alerts; at T14 …". R24 / §9.6.3: total
// live fund balance, "Above ~R5,000".

import { describe, it, expect } from "vitest";
import { dormancyStage, fundAlertsView, DORMANCY_ALERT_LEAD_DAYS } from "@/server/funds/funds";
import type { FundDeps } from "@/server/funds/types";
import { MemoryFundStore } from "./memory-fund-store";

const DAY = 86_400_000;
const CREATED = new Date("2026-03-01T08:00:00Z");
const at = (days: number, extraMs = 0) => new Date(CREATED.getTime() + days * DAY + extraMs);

describe("dormancyStage — T14 = 180 days, alert at 150", () => {
  const fund = { at: CREATED };

  it("the lead is the PRD's 30 days", () => expect(DORMANCY_ALERT_LEAD_DAYS).toBe(30));
  it("149 days → ok", () => expect(dormancyStage(fund, [], at(149), 180)).toBe("ok"));
  it("one millisecond before 150 days → ok", () => expect(dormancyStage(fund, [], at(150, -1), 180)).toBe("ok"));
  it("exactly 150 days → alert", () => expect(dormancyStage(fund, [], at(150), 180)).toBe("alert"));
  it("179 days → alert", () => expect(dormancyStage(fund, [], at(179), 180)).toBe("alert"));
  it("one millisecond before 180 days → alert", () => expect(dormancyStage(fund, [], at(180, -1), 180)).toBe("alert"));
  it("exactly 180 days → dormant", () => expect(dormancyStage(fund, [], at(180), 180)).toBe("dormant"));
  it("a tuned T14 of 90 alerts at 60", () => {
    expect(dormancyStage(fund, [], at(59), 90)).toBe("ok");
    expect(dormancyStage(fund, [], at(60), 90)).toBe("alert");
    expect(dormancyStage(fund, [], at(90), 90)).toBe("dormant");
  });
});

function deps(store: MemoryFundStore, now: Date, config: { ceilingZar: number; dormancyDays: number } | null): FundDeps {
  return { store, now: () => now, readConfig: async () => config } as unknown as FundDeps;
}

describe("fundAlertsView — read only", () => {
  it("lists a fund idle 150 days as alert and one idle 180 as dormant, and sums every live balance", async () => {
    const store = new MemoryFundStore();
    store.addFund({ id: "a", code: "FVO-AAAA", displayName: "Louis M.", at: CREATED });
    store.addEntry({ fundId: "a", kind: "top_up", amountZar: 250_000, at: CREATED });
    store.addFund({ id: "b", code: "FVO-BBBB", displayName: null, at: at(30) });
    store.addEntry({ fundId: "b", kind: "top_up", amountZar: 249_999, at: at(30) });
    store.addFund({ id: "c", code: "FVO-CCCC", displayName: "Fresh", at: at(170) });
    const before = JSON.stringify(store.state);

    const view = await fundAlertsView(deps(store, at(180), { ceilingZar: 200_000, dormancyDays: 180 }));

    expect(view.liabilityZar).toBe(499_999); // R4,999.99
    expect(view.activeFundCount).toBe(3);
    expect(view.dormancy).toEqual([
      { code: "FVO-AAAA", displayName: "Louis M.", stage: "dormant", idleDays: 180, balanceZar: 250_000 },
      { code: "FVO-BBBB", displayName: null, stage: "alert", idleDays: 150, balanceZar: 249_999 },
    ]);
    expect(JSON.stringify(store.state)).toBe(before); // nothing written: no task, no ledger entry
  });

  it("a draw restarts the clock", async () => {
    const store = new MemoryFundStore();
    store.addFund({ id: "a", code: "FVO-AAAA", at: CREATED });
    store.addEntry({ fundId: "a", kind: "top_up", amountZar: 50_000, at: CREATED });
    store.addEntry({ fundId: "a", kind: "spend", amountZar: -2000, at: at(100) });
    const view = await fundAlertsView(deps(store, at(200), { ceilingZar: 200_000, dormancyDays: 180 }));
    expect(view.dormancy).toEqual([]);
  });

  it("invalid T14: dormancy is null (unavailable), the liability still reads", async () => {
    const store = new MemoryFundStore();
    store.addFund({ id: "a", code: "FVO-AAAA", at: CREATED });
    store.addEntry({ fundId: "a", kind: "top_up", amountZar: 500_000, at: CREATED });
    const view = await fundAlertsView(deps(store, at(200), null));
    expect(view).toEqual({ liabilityZar: 500_000, activeFundCount: 1, dormancy: null });
  });
});
