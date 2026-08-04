DROP INDEX "ledger_accounts_owner_uix";--> statement-breakpoint
CREATE INDEX "ride_offers_driver_idx" ON "ride_offers" USING btree ("driver_id","status");--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_uix" UNIQUE NULLS NOT DISTINCT("owner_type","owner_id");