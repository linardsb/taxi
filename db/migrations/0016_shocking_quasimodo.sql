CREATE TYPE "public"."driver_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "approval_status" "driver_approval_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Every driver that existed before #20 was already driving; stranding them
-- offline at deploy would be an outage, not a safety gain. New rows default
-- to 'pending'.
UPDATE "drivers" SET "approval_status" = 'approved';
