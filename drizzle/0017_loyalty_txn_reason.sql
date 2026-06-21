-- AT-128: add nullable reason column to loyalty_transactions
-- Reason can be set for manual adjustments / expiry entries.
ALTER TABLE "loyalty_transactions" ADD COLUMN IF NOT EXISTS "reason" text;
