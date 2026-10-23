// AT-170 — risky migrations need an explicit opt-in (owner decision, Nikao, 21 Oct 2026).

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  checkPendingApprovals,
  hasApprovalMarker,
  refusalMessage,
  riskyReasons,
  unmarkedRiskyMigrations,
  GATED_FROM_IDX,
} from "@/server/deploy/migration-approval";

const MARKED = `-- 0034: drop the legacy column
-- favo:requires-approval drops orders.legacy_note
ALTER TABLE "orders" DROP COLUMN "legacy_note";`;
const PLAIN = `CREATE TABLE "widgets" ("id" uuid PRIMARY KEY);`;
const m = (idx: number, tag: string, sql: string) => ({ idx, tag, sql });

describe("riskyReasons", () => {
  it("flags DROP, type changes, data deletes/rewrites and the three money tables", () => {
    expect(riskyReasons(`ALTER TABLE "x" DROP COLUMN "y";`)).toEqual(["DROP"]);
    expect(riskyReasons(`ALTER TABLE "x" ALTER COLUMN "y" SET DATA TYPE text;`)).toEqual(["column type change"]);
    expect(riskyReasons(`DELETE FROM "x" WHERE true;`)).toEqual(["data delete (DELETE)"]);
    expect(riskyReasons(`UPDATE "x" SET "y" = 1;`)).toEqual(["data rewrite (UPDATE … SET)"]);
    expect(riskyReasons(`ALTER TABLE "payments" ADD COLUMN "z" int;`)).toEqual(["touches payments"]);
    expect(riskyReasons(`ALTER TABLE "order_items" ADD COLUMN "z" int;`)).toEqual(["touches order_items"]);
  });

  it("ignores additive changes, DROP DEFAULT / DROP NOT NULL, look-alike names and comments", () => {
    expect(riskyReasons(PLAIN)).toEqual([]);
    expect(riskyReasons(`ALTER TABLE "x" ALTER COLUMN "y" DROP DEFAULT;`)).toEqual([]);
    expect(riskyReasons(`ALTER TABLE "x" ALTER COLUMN "y" DROP NOT NULL;`)).toEqual([]);
    expect(riskyReasons(`CREATE TABLE "customer_orders_log" ("orders_count" int);`)).toEqual([]);
    expect(riskyReasons(`-- this used to DROP orders\n${PLAIN}`)).toEqual([]);
  });
});

describe("riskyReasons: foreign-key targets (owner decision, Nikao, 22 Oct 2026)", () => {
  it("does not flag 0034 (walk_ins): a new table whose only link to orders is an FK", () => {
    // Verbatim from PR #265's drizzle/0034_at209_walk_ins.sql.
    const sql = readFileSync("tests/fixtures/migrations/0034_at209_walk_ins.fk-only.sql", "utf8");
    expect(riskyReasons(sql)).toEqual([]);
    expect(unmarkedRiskyMigrations([m(34, "0034_at209_walk_ins", sql)])).toEqual([]);
  });

  it("does not flag an inline REFERENCES to payments or order_items, qualified or not", () => {
    expect(riskyReasons(`CREATE TABLE "x" ("pid" text REFERENCES payments(id));`)).toEqual([]);
    expect(riskyReasons(`CREATE TABLE "x" ("oi" text REFERENCES "public"."order_items"("id"));`)).toEqual([]);
  });

  it("still flags anything that alters, drops, updates or deletes those tables", () => {
    expect(riskyReasons(`ALTER TABLE "orders" ADD COLUMN "note" text;`)).toEqual(["touches orders"]);
    expect(riskyReasons(`ALTER TABLE "orders" ADD CONSTRAINT "c" FOREIGN KEY ("x") REFERENCES "public"."staff"("id");`)).toEqual(["touches orders"]);
    expect(riskyReasons(`DROP TABLE "payments";`)).toEqual(["DROP", "touches payments"]);
    expect(riskyReasons(`UPDATE "order_items" SET "quantity" = 1;`)).toEqual(["data rewrite (UPDATE … SET)", "touches order_items"]);
    expect(riskyReasons(`DELETE FROM "public"."orders" WHERE false;`)).toEqual(["data delete (DELETE)", "touches orders"]);
  });

  it("still flags an FK-adding migration that also touches orders elsewhere", () => {
    const sql = `ALTER TABLE "walk_ins" ADD CONSTRAINT "fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");
ALTER TABLE "orders" ADD COLUMN "walk_in" boolean;`;
    expect(riskyReasons(sql)).toEqual(["touches orders"]);
  });
});

describe("hasApprovalMarker", () => {
  it("finds the marker in the leading comment block", () => {
    expect(hasApprovalMarker(MARKED)).toBe(true);
  });

  it("does not count a marker after the first statement", () => {
    expect(hasApprovalMarker(`${PLAIN}\n-- favo:requires-approval late`)).toBe(false);
  });
});

describe("checkPendingApprovals (startup)", () => {
  it("refuses a pending marked migration with no approval", () => {
    const r = checkPendingApprovals([m(34, "0034_drop_note", MARKED)], {});
    expect(r.refused.map((x) => x.tag)).toEqual(["0034_drop_note"]);
    expect(r.approved).toEqual([]);
  });

  it("approves it when FAVO_APPROVE_MIGRATION names its exact tag", () => {
    const r = checkPendingApprovals([m(34, "0034_drop_note", MARKED)], {
      FAVO_APPROVE_MIGRATION: "0034_drop_note",
    });
    expect(r.refused).toEqual([]);
    expect(r.approved).toEqual(["0034_drop_note"]);
  });

  it("still refuses when the approval names a different tag, and reports the stray one", () => {
    const r = checkPendingApprovals([m(35, "0035_drop_more", MARKED)], {
      FAVO_APPROVE_MIGRATION: "0034_drop_note",
    });
    expect(r.refused.map((x) => x.tag)).toEqual(["0035_drop_more"]);
    expect(r.unused).toEqual(["0034_drop_note"]);
  });

  it("one approval cannot cover a second risky migration in the same deploy", () => {
    const r = checkPendingApprovals(
      [m(34, "0034_drop_note", MARKED), m(35, "0035_drop_more", MARKED)],
      { FAVO_APPROVE_MIGRATION: "0034_drop_note" },
    );
    expect(r.approved).toEqual(["0034_drop_note"]);
    expect(r.refused.map((x) => x.tag)).toEqual(["0035_drop_more"]);
  });

  it("does not accept a prefix or wildcard as approval", () => {
    const r = checkPendingApprovals([m(34, "0034_drop_note", MARKED)], { FAVO_APPROVE_MIGRATION: "0034*,0034" });
    expect(r.refused).toHaveLength(1);
  });

  it("lets ordinary migrations auto-apply", () => {
    expect(checkPendingApprovals([m(34, "0034_widgets", PLAIN)], {}).refused).toEqual([]);
  });

  it("backstops the CI gate: an unmarked risky migration from GATED_FROM_IDX is refused too", () => {
    const sql = `ALTER TABLE "payments" DROP COLUMN "x";`;
    expect(checkPendingApprovals([m(GATED_FROM_IDX, "0034_unmarked", sql)], {}).refused).toHaveLength(1);
    // …but the pre-decision history (a fresh database replays it) is left alone.
    expect(checkPendingApprovals([m(26, "0026_pre_decision", sql)], {}).refused).toEqual([]);
  });

  it("the refusal names the tag and the verified-backup step", () => {
    const msg = refusalMessage([{ tag: "0034_drop_note", reasons: ["DROP"] }]);
    expect(msg).toContain("0034_drop_note");
    expect(msg).toMatch(/verify it restores \(PRD §13\.3 step 1\)/);
    expect(msg).toContain("FAVO_APPROVE_MIGRATION=");
  });
});

describe("unmarkedRiskyMigrations (CI gate)", () => {
  it("fails a new risky migration without the marker", () => {
    const offenders = unmarkedRiskyMigrations([m(34, "0034_unmarked", `DELETE FROM "orders";`)]);
    expect(offenders).toEqual([
      { tag: "0034_unmarked", reasons: ["data delete (DELETE)", "touches orders"] },
    ]);
  });

  it("passes it once marked, and ignores ordinary and pre-decision migrations", () => {
    expect(
      unmarkedRiskyMigrations([
        m(34, "0034_drop_note", MARKED),
        m(35, "0035_widgets", PLAIN),
        m(32, "0032_deletion_pass", `DROP TABLE "x";`),
      ]),
    ).toEqual([]);
  });

  it("passes on the repo's real drizzle/ folder", () => {
    const journal: { idx: number; tag: string }[] = JSON.parse(
      readFileSync("drizzle/meta/_journal.json", "utf8"),
    ).entries;
    const files = journal.map((e) => m(e.idx, e.tag, readFileSync(`drizzle/${e.tag}.sql`, "utf8")));
    expect(unmarkedRiskyMigrations(files)).toEqual([]);
  });
});
