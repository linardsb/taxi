CREATE TYPE "public"."ride_event_actor" AS ENUM('rider', 'driver', 'dispatcher', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."ride_event_kind" AS ENUM('created', 'status', 'assigned', 'released');--> statement-breakpoint
CREATE TYPE "public"."ride_reason_code" AS ENUM('rider_changed_plans', 'rider_wait_too_long', 'rider_booked_by_mistake', 'rider_other', 'driver_rider_no_show', 'driver_vehicle_problem', 'driver_safety_concern', 'driver_other', 'dispatcher_rider_request', 'dispatcher_duplicate_booking', 'dispatcher_no_driver_available', 'dispatcher_rider_no_show', 'dispatcher_other', 'system_no_driver_found', 'decline_too_far', 'decline_unwanted_destination', 'decline_vehicle_unsuitable', 'decline_on_break', 'decline_other');--> statement-breakpoint
CREATE TABLE "ride_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "ride_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ride_id" uuid NOT NULL,
	"kind" "ride_event_kind" NOT NULL,
	"from_status" "ride_status",
	"to_status" "ride_status" NOT NULL,
	"actor_kind" "ride_event_actor" NOT NULL,
	"actor_id" uuid,
	"reason_code" "ride_reason_code",
	"reason_text" text,
	"driver_id" uuid,
	"vehicle_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ride_events_seq_unique" UNIQUE("seq"),
	CONSTRAINT "ride_events_actor_id_ck" CHECK (("ride_events"."actor_kind" = 'system') = ("ride_events"."actor_id" IS NULL)),
	CONSTRAINT "ride_events_status_kind_ck" CHECK (("ride_events"."kind" = 'status') = ("ride_events"."from_status" IS NOT NULL)),
	CONSTRAINT "ride_events_driver_kind_ck" CHECK ("ride_events"."kind" NOT IN ('assigned', 'released') OR "ride_events"."driver_id" IS NOT NULL),
	CONSTRAINT "ride_events_reason_text_ck" CHECK ("ride_events"."reason_text" IS NULL OR char_length("ride_events"."reason_text") <= 280)
);
--> statement-breakpoint
ALTER TABLE "ride_fare_lines" DROP CONSTRAINT "ride_fare_lines_ride_id_rides_id_fk";
--> statement-breakpoint
ALTER TABLE "rides" DROP CONSTRAINT "rides_vehicle_id_vehicles_id_fk";
--> statement-breakpoint
DROP INDEX "vehicles_plate_uix";--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD COLUMN "responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD COLUMN "decline_reason" "ride_reason_code";--> statement-breakpoint
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_driver_id_drivers_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ride_events_ride_seq_idx" ON "ride_events" USING btree ("ride_id","seq");--> statement-breakpoint
CREATE INDEX "ride_events_driver_idx" ON "ride_events" USING btree ("driver_id","occurred_at");--> statement-breakpoint
ALTER TABLE "ride_fare_lines" ADD CONSTRAINT "ride_fare_lines_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_uix" ON "vehicles" USING btree (upper("plate")) WHERE "vehicles"."retired_at" IS NULL;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_decline_reason_ck" CHECK ("ride_offers"."decline_reason" IS NULL OR "ride_offers"."decline_reason"::text LIKE 'decline\_%');