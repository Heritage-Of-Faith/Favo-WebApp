-- AT-204 Wave 2: DOWN for drizzle/0037_at204_vouchers.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0037-vouchers.test.ts (up -> down -> up).
--
-- PROVISIONAL NUMBER — renumber with the up file (see its header).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads: the
-- migrator applies only the files named in drizzle/meta/_journal.json.
-- Run it by hand, in a transaction, against a database at 0037.
--
-- Schema only. Dropping voucher_redemptions discards every redemption row —
-- the record each session's slip count reconciles against — so take a
-- verified backup first (§13.3). Dropping app_config discards every config
-- value, including any an Admin changed. opening_sessions'
-- voucher_redemptions_recorded belongs to 0036 and is not touched.
--
-- The last statement forgets 0037 in drizzle's own ledger, so a later
-- migrate re-applies it. 1793013530305 is 0037's `when` in the journal.

DROP TABLE "voucher_redemptions";--> statement-breakpoint
DROP TABLE "app_config";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793013530305;
  END IF;
END $$;
