-- AT-204 prerequisite: DOWN for drizzle/0036_at204_event_sessions.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0036-event-sessions.test.ts (up -> down -> up).
--
-- PROVISIONAL NUMBER — renumber with the up file (see its header).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads: the
-- migrator applies only the files named in drizzle/meta/_journal.json.
-- Run it by hand, in a transaction, against a database at 0036.
--
-- Schema only. Dropping event_profiles / event_windows discards their rows
-- (including the two seeded profiles — re-seed after up). The closed_at
-- values 0036 back-filled on past-day sessions go with the column.
-- UNIQUE(session_date, opens_at) is not touched in either direction.
--
-- The last statement forgets 0036 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793002925317 is 0036's `when` in the
-- journal.

DROP INDEX "opening_sessions_one_open";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP CONSTRAINT "opening_sessions_event_window_id_event_windows_id_fk";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "closed_at";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "voucher_kinds_active";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "voucher_redemptions_recorded";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "voucher_slips_counted";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "event_window_id";--> statement-breakpoint
DROP TABLE "event_windows";--> statement-breakpoint
DROP TABLE "event_profiles";--> statement-breakpoint
DROP TYPE "public"."event_payment_posture";--> statement-breakpoint
DROP TYPE "public"."event_menu_scope";--> statement-breakpoint
DROP TYPE "public"."event_audience";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793002925317;
  END IF;
END $$;
