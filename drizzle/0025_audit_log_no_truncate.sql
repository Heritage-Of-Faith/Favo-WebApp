-- F1 / L08 · L12: close the TRUNCATE gap in the append-only audit_log.
--
-- The row-level BEFORE UPDATE / BEFORE DELETE triggers from 0021 do NOT fire on
-- TRUNCATE TABLE — Postgres TRUNCATE is a statement-level operation that bypasses
-- row triggers entirely. So a role holding the TRUNCATE privilege could still
-- wipe the entire audit trail. This adds a statement-level BEFORE TRUNCATE guard
-- that raises, so no role (owner included) can truncate audit_log.
--
-- Idempotent: safe to re-run (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS).

CREATE OR REPLACE FUNCTION audit_log_truncate_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: TRUNCATE is not allowed';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
--> statement-breakpoint

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_truncate_guard();
