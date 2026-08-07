ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'card_settlement' BEFORE 'payout';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "payment_customer_ref" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "payment_instrument_ref" text;--> statement-breakpoint
ALTER TABLE "platform_config" ADD COLUMN "driver_debt_limit_cents" integer NOT NULL DEFAULT 5000;--> statement-breakpoint
-- Config, not constant: the default exists only to backfill the seeded Rīga
-- row. Dropped immediately so no future city row gets a limit nobody set.
ALTER TABLE "platform_config" ALTER COLUMN "driver_debt_limit_cents" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "payment_provider_ref" text;--> statement-breakpoint
CREATE INDEX "ledger_entries_ride_idx" ON "ledger_entries" USING btree ("ride_id");