-- audit_log is append-only.
-- This trigger fires BEFORE any UPDATE or DELETE and raises an exception.
-- It cannot be bypassed by application code.

CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % on row % is not allowed', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
