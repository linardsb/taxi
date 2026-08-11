CREATE TYPE "public"."booking_channel" AS ENUM('app', 'phone');--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "platform_config" ADD COLUMN "dispatch_phone" text NOT NULL DEFAULT '+37160000000';--> statement-breakpoint
-- Config, not constant: the default exists only to backfill the seeded Rīga
-- row (the 0006 driver_debt_limit_cents precedent). Dropped immediately so no
-- future city row gets a dispatch number nobody set; the seed supplies the
-- real value.
ALTER TABLE "platform_config" ALTER COLUMN "dispatch_phone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "booking_channel" "booking_channel" DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "tracking_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "rides_tracking_token_idx" ON "rides" USING btree ("tracking_token");
