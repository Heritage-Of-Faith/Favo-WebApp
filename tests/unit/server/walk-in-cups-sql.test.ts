// AT-209 / REQ-116: the walk_in_cups query must name its column. Drizzle does
// not alias a bare sql`` select field, so without `.as("cups")` the raw SQL
// returns the column as "coalesce" — which the real-Postgres test in
// tests/db/0034-up-down.test.ts reads as `row.cups`.

import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { walkInCupsQuery } from "@/server/reports/walk-in-cups";

describe("walkInCupsQuery SQL", () => {
  it("names the summed column 'cups' and sums walk_ins.quantity over the revenue-day range", () => {
    const { sql, params } = walkInCupsQuery(drizzle.mock(), {
      fromDay: "2031-03-04",
      toDay: "2031-03-05",
    }).toSQL();
    expect(sql).toMatch(/as "cups"/i);
    expect(sql).toMatch(/sum\("walk_ins"\."quantity"\)/i);
    expect(sql).toMatch(/"orders"\."revenue_day" >= \$1/);
    expect(sql).toMatch(/"orders"\."revenue_day" <= \$2/);
    expect(params).toEqual(["2031-03-04", "2031-03-05"]);
  });
});
