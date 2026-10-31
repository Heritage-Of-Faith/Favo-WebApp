// R3-3 (Hours: closed sessions read "open-ended") and R3-4 (Yield hides an
// open cup-tracked bag that has no recorded container cost).
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sessionSpan, openingLabel } from "@/lib/session-span";
import { yieldLotFilter } from "@/server/inventory/yield-filter";

describe("sessionSpan (R3-3)", () => {
  it("the one open session with no end is open-ended", () => {
    expect(sessionSpan({ opensAt: "09:40", closesAt: null, closedAt: null })).toBe("09:40 → open-ended");
  });
  it("a closed session shows when it closed, never open-ended", () => {
    expect(sessionSpan({ opensAt: "08:40", closesAt: null, closedAt: "09:15" })).toBe("08:40 – 09:15 · closed");
  });
  it("a closed session with a planned end keeps it and is tagged closed", () => {
    expect(sessionSpan({ opensAt: "08:40", closesAt: "09:30", closedAt: "09:20" })).toBe("08:40 – 09:30 · closed 09:20");
  });
  it("an open session with a planned end shows the end", () => {
    expect(sessionSpan({ opensAt: "08:40", closesAt: "09:30" })).toBe("08:40 – 09:30");
  });
  // QA R4-2: a future opening closed before it began read "23:59 – 08:46 · closed".
  it("a close time before the open time is not shown; the row just says closed", () => {
    expect(sessionSpan({ opensAt: "23:59", closesAt: null, closedAt: "08:46" })).toBe("23:59 · closed");
    expect(sessionSpan({ opensAt: "23:59", closesAt: null, closedAt: "23:59" })).toBe("23:59 · closed");
    expect(sessionSpan({ opensAt: "10:00", closesAt: "11:00", closedAt: "08:46" })).toBe("10:00 – 11:00 · closed");
  });
});

describe("openingLabel (QA R4-2 ordinals)", () => {
  it("is a word for every row, never a mix of words and digits", () => {
    expect([0, 4, 5, 6, 7].map(openingLabel)).toEqual([
      "First opening", "Fifth opening", "Sixth opening", "Seventh opening", "Eighth opening",
    ]);
    expect(openingLabel(11)).toBe("Twelfth opening");
    expect(openingLabel(12)).toBe("Opening 13");
  });
});

describe("yieldLotFilter (R3-4)", () => {
  const { sql, params } = new PgDialect().sqlToQuery(yieldLotFilter());
  it("lets a cup-tracked lot in without a container cost", () => {
    expect(sql).toMatch(/"inventory_items"\."unit" = \$\d+ or "inventory_lots"\."container_cost_zar" is not null/);
    expect(params).toContain("cup");
  });
  it("still lists only open or closed lots", () => {
    expect(sql).toMatch(/"inventory_lots"\."state" in \(\$\d+, \$\d+\)/);
    expect(params).toEqual(expect.arrayContaining(["open", "closed"]));
  });
});
