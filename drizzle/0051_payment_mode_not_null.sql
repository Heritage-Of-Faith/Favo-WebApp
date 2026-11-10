-- favo:requires-approval rewrites orders.payment_mode: backfills every NULL to 'yoco' and sets the column NOT NULL (PRD §10.3 L2499, §10.6)
-- orders.payment_mode is never NULL.
-- Spec: docs/FAVO_PRD_v7.md §10.3 ("payment_mode → NOT NULL, backfilling NULLs
-- to 'yoco' — the column is nullable today and NULL means 'yoco' by
-- convention, which silently mis-buckets every per-mode query in §07"),
-- §10.6 ("orders.payment_mode is never null"), REQ-134. Owner-approved (Mia).
--
-- The writers already name the mode (createOrder, declineFreeCoffee and
-- removeVoucher write 'yoco' or keep a chosen tender; never NULL), so after
-- this no NULL can arrive. No DEFAULT: a writer that forgets the mode must
-- fail, not be filed as a card sale.
--
-- Re-runnable: the UPDATE touches only NULL rows and SET NOT NULL on a column
-- that already has it is a no-op. payment_mode is text with no DB enum and no
-- CHECK on its values (0046 relied on that); that is unchanged here.
--
-- The reverse is drizzle/down/0051_payment_mode_not_null.down.sql.

UPDATE "orders" SET "payment_mode" = 'yoco' WHERE "payment_mode" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "payment_mode" SET NOT NULL;
