-- Migrate existing staff to admin
UPDATE staff SET role = 'admin' WHERE role IN ('roaster', 'manager', 'finance', 'owner');

-- Drop old check constraint on monthly_reports
ALTER TABLE monthly_reports DROP CONSTRAINT IF EXISTS monthly_report_closed_requires_both_sigs;

-- Drop finance_sig column
ALTER TABLE monthly_reports DROP COLUMN IF EXISTS finance_sig;

-- Add new single-admin-sig check constraint
ALTER TABLE monthly_reports ADD CONSTRAINT monthly_report_closed_requires_admin_sig
  CHECK (status != 'closed' OR admin_sig IS NOT NULL);

-- Recreate staff_role enum with only barista and admin
-- PostgreSQL: must use a temporary name
ALTER TYPE staff_role RENAME TO staff_role_old;
CREATE TYPE staff_role AS ENUM('barista', 'admin');
ALTER TABLE staff ALTER COLUMN role TYPE staff_role USING role::text::staff_role;
DROP TYPE staff_role_old;
