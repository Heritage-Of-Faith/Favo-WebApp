-- F1 / L08 · L12: audit_log is append-only, trigger-enforced.
-- Fires BEFORE any UPDATE or DELETE on audit_log and raises, so no role
-- (including the owner/app role) can mutate or delete an audit row.
-- Idempotent: safe to re-run (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).
-- Source of truth was db/sql/audit-trigger.sql (never-applied orphan); this
-- migration is now the canonical applied definition.

CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % on row % is not allowed', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
--> statement-breakpoint

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
--> statement-breakpoint

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
