-- AT-60: Add partial unique index on loyalty_transactions(order_id) WHERE kind = 'earn'.
-- Prevents double-accrual if transitionOrder is retried on the same
-- in_progress -> ready transition. Redeem rows (kind != 'earn') are unrestricted.
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_txn_earn_order_unique"
ON "loyalty_transactions" ("order_id")
WHERE kind = 'earn';