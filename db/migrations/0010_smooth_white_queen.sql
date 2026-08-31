ALTER TABLE "drivers" ADD COLUMN "push_token" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "offline_nudge_due_at" timestamp with time zone;