ALTER TABLE "rides" ADD COLUMN "pickup_pin" text;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "pickup_pin_failures" integer DEFAULT 0 NOT NULL;