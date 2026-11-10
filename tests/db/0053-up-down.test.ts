// REQ-127: 0053 (inventory_items.is_lid, app_config variance_bands.lid, and
// v_weekly_variance honouring the T08 lid band) ships with a tested `down`
// (PRD §14). PROVISIONAL number — renumbered in merge order.
// Spec: PRD v7.0 §7.4 ("lids carry their own wider variance band (T08) so the
// noise does not pollute the overall variance signal"), §05 ("SQL view
// v_weekly_variance, honouring the T08 lid band"), §12.2 T01 ("0–5% ok",
// config.variance_bands) and T08 ("Lid variance band: 0–25% ok",
// config.variance_bands.lid), REQ-127.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0053.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves, with literal percentages:
//   - a lid 20% off is within T08 and does not move the overall figure: beside
//     a cup 4% off, the week reads 4% and breaches nothing;
//   - a lid at exactly 25.00% is ok; 25.01% and 26% breach T08 (the overall
//     T01 figure is unaffected);
//   - a cup 20% off is judged by T01 (breach), not by the lid band;
//   - the lid band is read from config.variance_bands.lid (15 → 20% breaches);
//   - the migration marks the seeded lid and seeds variance_bands.lid = 25;
//   - down restores 0022's view and drops is_lid; up brings both back.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0053_at127_lid_variance_band.sql";
const DOWN = "down/0053_at127_lid_variance_band.down.sql";
const WHEN_0053 = 1793220200000; // drizzle/meta/_journal.json, idx 53

/** completed_at 2001-03-07 (a Wednesday, SAST) → week_starting 2001-03-05. */
const COMPLETED = "2001-03-07T10:00:00+02:00";
const WEEK = "2001-03-05";

async function ledgerHas0053(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0053}`;
  return rows.length > 0;
}

async function viewColumns(tx: TransactionSql): Promise<string[]> {
  const rows = await tx`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_weekly_variance' ORDER BY ordinal_position`;
  return rows.map((r) => r.column_name as string);
}

async function hasIsLid(tx: TransactionSql): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'is_lid'`;
  return rows.length > 0;
}

type Week = {
  stock_take_count: number;
  avg: number;
  max: number;
  breaches_threshold: boolean;
  lid_line_count: number;
  max_lid: number | null;
  lid_band: number;
  lid_breaches_band: boolean;
};

async function week(tx: TransactionSql): Promise<Week> {
  const [r] = await tx`
    SELECT stock_take_count::int AS stock_take_count,
           avg_abs_variance_pct::float AS avg,
           max_abs_variance_pct AS max,
           breaches_threshold,
           lid_line_count::int AS lid_line_count,
           max_lid_variance_pct::float AS max_lid,
           lid_band_pct::float AS lid_band,
           lid_breaches_band
    FROM v_weekly_variance WHERE week_starting = ${WEEK}::date`;
  return r as unknown as Week;
}

class Rollback extends Error {}

maybe("0053 T08 lid band in v_weekly_variance: literal bands, up → down → up (REQ-127)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  /** One completed stock take: a cup lot (expected 100) and a lid lot (expected lidExpected), counted as given. */
  async function take(tx: TransactionSql, cupCounted: number, lidCounted: number, lidExpected = 100) {
    const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('REQ-127 Admin', 'admin', 'x') RETURNING id`;
    const [cup] = await tx`
      INSERT INTO inventory_items (name, kind, unit) VALUES ('REQ-127 Cup', 'packaging', 'unit') RETURNING id`;
    const [lid] = await tx`
      INSERT INTO inventory_items (name, kind, unit, is_lid) VALUES ('REQ-127 Lid', 'packaging', 'unit', true) RETURNING id`;
    const [cupLot] = await tx`INSERT INTO inventory_lots (inventory_item_id) VALUES (${cup.id}) RETURNING id`;
    const [lidLot] = await tx`INSERT INTO inventory_lots (inventory_item_id) VALUES (${lid.id}) RETURNING id`;
    const [t] = await tx`
      INSERT INTO stock_takes (kind, by_staff_id, completed_at) VALUES ('full', ${s.id}, ${COMPLETED}) RETURNING id`;
    await tx`
      INSERT INTO stock_take_lines (stock_take_id, inventory_lot_id, expected, counted, variance) VALUES
        (${t.id}, ${cupLot.id}, 100, ${cupCounted}, ${cupCounted - 100}),
        (${t.id}, ${lidLot.id}, ${lidExpected}, ${lidCounted}, ${lidCounted - lidExpected})`;
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("a lid at 20% is within T08 and does not pollute the overall figure (cup at 4%)", async () => {
    await inRolledBackTx(async (tx) => {
      await take(tx, 104, 120);
      expect(await week(tx)).toEqual({
        stock_take_count: 1,
        avg: 4,
        max: 4,
        breaches_threshold: false,
        lid_line_count: 1,
        max_lid: 20,
        lid_band: 25,
        lid_breaches_band: false,
      });
    });
  });

  it("a lid at 26% breaches T08; the overall T01 figure is untouched", async () => {
    await inRolledBackTx(async (tx) => {
      await take(tx, 104, 126);
      const w = await week(tx);
      expect(w.max_lid).toBe(26);
      expect(w.lid_breaches_band).toBe(true);
      expect(w.avg).toBe(4);
      expect(w.breaches_threshold).toBe(false);
    });
  });

  // T08 "0–25% ok" (owner decision): exactly 25.00% is ok, only above is flagged.
  it("a lid at exactly 25.00% is within T08", async () => {
    await inRolledBackTx(async (tx) => {
      await take(tx, 104, 12500, 10000);
      const w = await week(tx);
      expect(w.max_lid).toBe(25);
      expect(w.lid_breaches_band).toBe(false);
    });
  });

  it("a lid at 25.01% breaches T08", async () => {
    await inRolledBackTx(async (tx) => {
      await take(tx, 104, 12501, 10000);
      const w = await week(tx);
      expect(w.max_lid).toBe(25.01);
      expect(w.lid_breaches_band).toBe(true);
    });
  });

  it("a non-lid at 20% is judged by T01 (breach), not by the lid band", async () => {
    await inRolledBackTx(async (tx) => {
      await take(tx, 120, 120);
      const w = await week(tx);
      expect(w.avg).toBe(20);
      expect(w.max).toBe(20);
      expect(w.breaches_threshold).toBe(true);
      expect(w.max_lid).toBe(20);
      expect(w.lid_breaches_band).toBe(false);
    });
  });

  it("the lid band is read from config.variance_bands.lid", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`
        INSERT INTO app_config (key, value) VALUES ('variance_bands', '{"lid": 15}'::jsonb)
        ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`;
      await take(tx, 104, 120);
      const w = await week(tx);
      expect(w.lid_band).toBe(15);
      expect(w.lid_breaches_band).toBe(true);
    });
  });

  it("up marks the seeded lid and seeds variance_bands.lid = 25", async () => {
    await inRolledBackTx(async (tx) => {
      const [cfg] = await tx`SELECT value FROM app_config WHERE key = 'variance_bands'`;
      expect(cfg?.value).toEqual({ lid: 25 });
      const seeded = await tx`SELECT is_lid FROM inventory_items WHERE id = 'inv_item_lid'`;
      if (seeded.length > 0) expect(seeded[0]!.is_lid).toBe(true); // present only on a seeded DB
      const cups = await tx`SELECT 1 FROM inventory_items WHERE id IN ('inv_item_cup_8oz', 'inv_item_cup_12oz') AND is_lid`;
      expect(cups.length).toBe(0);
    });
  });

  it("down restores 0022's view and drops is_lid; up brings both back", async () => {
    await inRolledBackTx(async (tx) => {
      const AT_0053 = [
        "week_starting", "stock_take_count", "avg_abs_variance_pct", "max_abs_variance_pct", "breaches_threshold",
        "lid_line_count", "max_lid_variance_pct", "lid_band_pct", "lid_breaches_band",
      ];
      expect(await viewColumns(tx)).toEqual(AT_0053);
      expect(await hasIsLid(tx)).toBe(true);
      const ledgerBefore = await ledgerHas0053(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      expect(await viewColumns(tx)).toEqual(AT_0053.slice(0, 5));
      expect(await hasIsLid(tx)).toBe(false);
      expect((await tx`SELECT 1 FROM app_config WHERE key = 'variance_bands'`).length).toBe(0);
      if (ledgerBefore !== null) expect(await ledgerHas0053(tx)).toBe(false);

      await tx.unsafe(migrationSql(UP));
      expect(await viewColumns(tx)).toEqual(AT_0053);
      expect(await hasIsLid(tx)).toBe(true);
      await take(tx, 104, 126);
      expect((await week(tx)).lid_breaches_band).toBe(true);
    });
  });
});
