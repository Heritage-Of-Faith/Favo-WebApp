// REQ-127 (PRD v7.0 §7.4, §05, §12.2 T01 + T08): v_weekly_variance honours
// the T08 lid band. The view's literal-percentage behaviour (lid 20% ok, lid
// 26% flagged, non-lid 20% judged by T01) is proven against Postgres in
// tests/db/0053-up-down.test.ts (CI only). This unit test pins the static
// facts that suite relies on, so a drift shows up in `bun test:unit` too.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INVENTORY_ITEMS } from "@db/seed/inventory";
import { VARIANCE_INVESTIGATE_PCT } from "@/lib/status/variance-band";
import { hasApprovalMarker, riskyReasons } from "@/server/deploy/migration-approval";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const UP = src("drizzle/0053_at127_lid_variance_band.sql");

describe("0053: the T08 lid band in v_weekly_variance (REQ-127)", () => {
  it("seeds config.variance_bands.lid = 25 (T08: 0–25% ok) without overwriting an Admin's value", () => {
    expect(UP).toContain(`('variance_bands', '{"lid": 25}'::jsonb)`);
    expect(UP).toContain(`ON CONFLICT ("tenant_id", "key") DO NOTHING`);
  });

  it("reads the lid band from config, falling back to T08's 25", () => {
    expect(UP).toMatch(/\(c\.value ->> 'lid'\)::numeric FROM app_config c\s+WHERE c\.tenant_id = st\.tenant_id AND c\.key = 'variance_bands'\),\s+25\s+\)/);
    // T08 "0–25% ok": exactly the band is ok; only above it is flagged.
    expect(UP).toContain("bool_or(lid_max_pct > lid_band_pct)");
    expect(UP).not.toContain("lid_max_pct >= lid_band_pct");
  });

  it("judges non-lid lines against T01's 5%, the same boundary as the admin band", () => {
    expect(VARIANCE_INVESTIGATE_PCT).toBe(5);
    expect(UP).toContain("bool_or(other_pct >= 5)");
    expect(UP).toContain("AND NOT ln.is_lid) AS other_pct");
  });

  it("marks only the seeded lid as a lid; cups stay on T01", () => {
    expect(UP).toContain(`UPDATE "inventory_items" SET "is_lid" = true WHERE "id" = 'inv_item_lid';`);
    const lids = INVENTORY_ITEMS.filter((i) => i.isLid).map((i) => i.id);
    expect(lids).toEqual(["inv_item_lid"]);
  });

  it("carries the approval marker because it UPDATEs a row", () => {
    expect(riskyReasons(UP)).toEqual(["data rewrite (UPDATE … SET)"]);
    expect(hasApprovalMarker(UP)).toBe(true);
  });
});
