// AT-204 prerequisite (Migration A): 0036 ships with a tested `down` (PRD §14,
// "Rollback strategies"), and the database enforces what the PRD fixes:
//   - §6.11.1 / §10.6: at most one opening_sessions row is open at a time
//     (partial UNIQUE (tenant_id) WHERE closed_at IS NULL), while
//     UNIQUE(session_date, opens_at) is KEPT (COL-14) — a second session on
//     the same date is the normal path once the first is closed;
//   - L43: voucher_slips_counted is NULL when nobody counted (not zero);
//     voucher_redemptions_recorded is NOT NULL; voucher_kinds_active and both
//     voucher_kinds columns default to '{}';
//   - L27 / REQ-043: event_windows.ends_at is NOT NULL and a window longer
//     than 24 h is refused;
//   - the past-day back-fill (L07) and the refusal over two open sessions.
//
// Provisional number 0036 (see the migration header).
// Runs against the CI test DB, which `bun db:migrate` has already brought to
// 0036. Every case runs inside ONE transaction that is always rolled back.
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0036_at204_event_sessions.sql";
const DOWN = "down/0036_at204_event_sessions.down.sql";
const NEW_TABLES = ["event_profiles", "event_windows"] as const;
const NEW_ENUMS = ["event_menu_scope", "event_payment_posture", "event_audience"] as const;

type Shape = { columns: string[]; constraints: string[]; indexes: string[] };
type SnapshotTable = {
  columns: Record<string, { name: string; notNull: boolean }>;
  foreignKeys: Record<string, unknown>;
  uniqueConstraints: Record<string, unknown>;
  checkConstraints?: Record<string, unknown>;
  indexes: Record<string, unknown>;
};

function snapshotShape(file: string, table: string): Shape | undefined {
  const path = resolve(process.cwd(), "drizzle", "meta", file);
  const snap = JSON.parse(readFileSync(path, "utf8")) as { tables: Record<string, SnapshotTable> };
  const t = snap.tables[`public.${table}`];
  if (!t) return undefined;
  return {
    columns: Object.values(t.columns).map((c) => c.name + (c.notNull ? "!" : "")).sort(),
    constraints: [
      ...Object.keys(t.foreignKeys),
      ...Object.keys(t.uniqueConstraints),
      ...Object.keys(t.checkConstraints ?? {}),
    ].sort(),
    indexes: Object.keys(t.indexes).sort(),
  };
}

async function dbShape(tx: TransactionSql, table: string): Promise<Shape | undefined> {
  const [exists] = await tx`SELECT to_regclass(${"public." + table}) AS r`;
  if (!exists.r) return undefined;
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  const cons = await tx`
    SELECT conname FROM pg_constraint
    WHERE conrelid = ${"public." + table}::regclass AND contype IN ('f', 'u', 'c')`;
  const idx = await tx`
    SELECT c.relname FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = ${"public." + table}::regclass
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u', 'x')
      )`;
  return {
    columns: cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort(),
    constraints: cons.map((r) => r.conname as string).sort(),
    indexes: idx.map((r) => r.relname as string).sort(),
  };
}

async function expectSchemaAt(tx: TransactionSql, snapshotFile: string) {
  for (const table of ["opening_sessions", ...NEW_TABLES]) {
    expect({ table, shape: await dbShape(tx, table) }).toEqual({
      table,
      shape: snapshotShape(snapshotFile, table),
    });
  }
}

async function enumExists(tx: TransactionSql, name: string): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = ${name}`;
  return rows.length > 0;
}

class Rollback extends Error {}

maybe("0036 event sessions: up → down → up, and the refusals (AT-204 prerequisite)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        // Any session another suite left open would trip the one-open index;
        // close it inside this always-rolled-back transaction.
        await tx`UPDATE opening_sessions SET closed_at = now() WHERE closed_at IS NULL`;
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  beforeAll(() => {
    sql = connect();
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("the migrated DB starts at 0036", async () => {
    await inRolledBackTx(async (tx) => {
      await expectSchemaAt(tx, "0036_snapshot.json");
      for (const e of NEW_ENUMS) expect(await enumExists(tx, e)).toBe(true);
    });
  });

  it("down returns opening_sessions to 0033 and drops the event tables; up again returns to 0036", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      await expectSchemaAt(tx, "0033_snapshot.json");
      for (const e of NEW_ENUMS) expect(await enumExists(tx, e)).toBe(false);
      // COL-14: the 0029 constraint survives the down.
      const kept = await tx`
        SELECT 1 FROM pg_constraint WHERE conname = 'opening_sessions_date_opens_unique'`;
      expect(kept.length).toBe(1);

      await tx.unsafe(migrationSql(UP));
      await expectSchemaAt(tx, "0036_snapshot.json");
      for (const e of NEW_ENUMS) expect(await enumExists(tx, e)).toBe(true);
    });
  });

  it("up closes past-day sessions at the next SAST midnight and leaves a current one open", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      const [past] = await tx`
        INSERT INTO opening_sessions (session_date, opens_at, mode)
        VALUES ('2001-01-07', '07:50', 'sunday') RETURNING id`;
      const [current] = await tx`
        INSERT INTO opening_sessions (session_date, opens_at, mode)
        VALUES ('2099-01-04', '07:50', 'sunday') RETURNING id`;
      await tx.unsafe(migrationSql(UP));
      const [p] = await tx`
        SELECT closed_at = '2001-01-08 00:00:00+02'::timestamptz AS at_midnight
        FROM opening_sessions WHERE id = ${past.id}`;
      expect(p.at_midnight).toBe(true);
      const [c] = await tx`SELECT closed_at FROM opening_sessions WHERE id = ${current.id}`;
      expect(c.closed_at).toBeNull();
    });
  });

  it("up refuses, and changes nothing, when two current sessions are open", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      await tx`
        INSERT INTO opening_sessions (session_date, opens_at, mode)
        VALUES ('2099-01-04', '07:50', 'sunday'), ('2099-01-04', '17:45', 'sunday')`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(UP)))).rejects.toThrow(
        /AT-204\/0036: more than one opening_sessions row from today or later is open/
      );
      expect(await enumExists(tx, "event_payment_posture")).toBe(false);
    });
  });

  it("opening_sessions: one open at a time; UNIQUE(session_date, opens_at) kept; voucher defaults", async () => {
    await inRolledBackTx(async (tx) => {
      const [morning] = await tx`
        INSERT INTO opening_sessions (session_date, opens_at, mode)
        VALUES ('2099-01-04', '07:50', 'sunday')
        RETURNING id, voucher_slips_counted, voucher_redemptions_recorded, voucher_kinds_active, closed_at`;
      expect(morning.voucher_slips_counted).toBeNull(); // L43: not counted ≠ 0
      expect(morning.voucher_redemptions_recorded).toBe(0);
      expect(morning.voucher_kinds_active).toEqual([]);
      expect(morning.closed_at).toBeNull();

      // A second session while the first is open is refused (§6.11.1).
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO opening_sessions (session_date, opens_at, mode)
          VALUES ('2099-01-04', '17:45', 'event')`)
      ).rejects.toThrow(/opening_sessions_one_open/);

      // Close the morning; the evening session on the same date is the normal path.
      await tx`UPDATE opening_sessions SET closed_at = now(), voucher_slips_counted = 0 WHERE id = ${morning.id}`;
      await tx`
        INSERT INTO opening_sessions (session_date, opens_at, mode, voucher_kinds_active)
        VALUES ('2099-01-04', '17:45', 'event', ARRAY['untracked_hot_drink'])`;

      // COL-14: the same (session_date, opens_at) is still refused, open or closed.
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO opening_sessions (session_date, opens_at, mode, closed_at)
          VALUES ('2099-01-04', '07:50', 'sunday', now())`)
      ).rejects.toThrow(/opening_sessions_date_opens_unique/);

      // voucher_redemptions_recorded is NOT NULL.
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO opening_sessions (session_date, opens_at, mode, closed_at, voucher_redemptions_recorded)
          VALUES ('2099-01-05', '08:40', 'weekday', now(), NULL)`)
      ).rejects.toThrow(/voucher_redemptions_recorded/);
    });
  });

  it("event_windows: ends_at required; at most 24 h; end after start; FKs and defaults", async () => {
    await inRolledBackTx(async (tx) => {
      const [profile] = await tx`
        INSERT INTO event_profiles (name, recurrence, default_start, default_end, menu_scope,
          payment_posture, consumes_cup_lid, audience, extra_shot_surcharge)
        VALUES ('AT-204 Discipleship 101', 'FREQ=WEEKLY;BYDAY=WE', '18:30', '20:30', 'coffee_only',
          'free', true, 'church_member', false)
        RETURNING id, voucher_kinds, active`;
      expect(profile.voucher_kinds).toEqual([]);
      expect(profile.active).toBe(true);

      const insertWindow = (startsAt: string, endsAt: string | null) =>
        tx.savepoint((sp) => sp`
          INSERT INTO event_windows (event_profile_id, name, starts_at, ends_at, menu_scope,
            payment_posture, consumes_cup_lid, audience, extra_shot_surcharge)
          VALUES (${profile.id}, 'AT-204 window', ${startsAt}, ${endsAt}, 'coffee_only',
            'free', true, 'church_member', false)
          RETURNING id, voucher_kinds, price_overrides`);

      const [win] = await insertWindow("2099-01-07 18:30+02", "2099-01-07 20:30+02");
      expect(win.voucher_kinds).toEqual([]);
      expect(win.price_overrides).toBeNull();
      await insertWindow("2099-01-07 18:00+02", "2099-01-08 18:00+02"); // exactly 24 h is allowed

      await expect(insertWindow("2099-01-07 18:00+02", null)).rejects.toThrow(/ends_at/);
      await expect(insertWindow("2099-01-07 18:00+02", "2099-01-08 18:00:01+02")).rejects.toThrow(
        /event_windows_max_24h/
      );
      await expect(insertWindow("2099-01-07 20:30+02", "2099-01-07 20:30+02")).rejects.toThrow(
        /event_windows_max_24h/
      );
      await expect(insertWindow("2099-01-07 20:30+02", "2099-01-07 18:30+02")).rejects.toThrow(
        /event_windows_max_24h/
      );

      // An unknown switch value is refused by its enum.
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO event_profiles (name, menu_scope, payment_posture, consumes_cup_lid,
            audience, extra_shot_surcharge)
          VALUES ('AT-204 bad', 'full', 'donation', true, 'both', true)`)
      ).rejects.toThrow(/event_payment_posture/);

      // opening_sessions.event_window_id references event_windows.
      await tx`
        INSERT INTO opening_sessions (session_date, opens_at, mode, event_window_id)
        VALUES ('2099-01-07', '18:15', 'event', ${win.id})`;
      await tx`UPDATE opening_sessions SET closed_at = now() WHERE event_window_id = ${win.id}`;
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO opening_sessions (session_date, opens_at, mode, event_window_id)
          VALUES ('2099-01-07', '19:00', 'event', 'no-such-window')`)
      ).rejects.toThrow(/opening_sessions_event_window_id_event_windows_id_fk/);
    });
  });
});
