CREATE TYPE "public"."assignment_source" AS ENUM('auto_match', 'geozone_queue', 'dispatcher');--> statement-breakpoint
CREATE TYPE "public"."commission_source" AS ENUM('platform_base', 'driver_override');--> statement-breakpoint
CREATE TYPE "public"."dispatch_mode" AS ENUM('auto_match', 'geozone_queue');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('offline', 'online', 'on_ride');--> statement-breakpoint
CREATE TYPE "public"."fare_line_type" AS ENUM('base', 'distance', 'time', 'discount');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('ride_fare', 'commission', 'cash_settlement', 'payout', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."ledger_owner_type" AS ENUM('platform', 'driver', 'rider');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('cash', 'card', 'balance', 'corporate');--> statement-breakpoint
CREATE TYPE "public"."pricing_model" AS ENUM('upfront_fixed', 'taximeter', 'rider_bid');--> statement-breakpoint
CREATE TYPE "public"."ride_category" AS ENUM('standard', 'fastest', 'limo', 'vip');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('scheduled', 'requested', 'offered', 'queued', 'accepted', 'arriving', 'arrived', 'in_progress', 'completed', 'settled', 'cancelled_by_rider', 'cancelled_by_driver', 'cancelled_by_dispatcher', 'cancelled_by_system');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('rider', 'driver', 'dispatcher', 'admin');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"role" "user_role" NOT NULL,
	"language" text DEFAULT 'lv' NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" "driver_status" DEFAULT 'offline' NOT NULL,
	"spoken_languages" text[] DEFAULT '{"lv"}' NOT NULL,
	"is_female" boolean,
	"fleet_id" uuid,
	"rating" double precision,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"commission_pct_override" double precision
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"plate" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"category" "ride_category" DEFAULT 'standard' NOT NULL,
	"passenger_seats" integer NOT NULL,
	"has_child_seat" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country_code" text DEFAULT 'LV' NOT NULL,
	"timezone" text DEFAULT 'Europe/Riga' NOT NULL,
	CONSTRAINT "cities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "geozones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"polygon" geometry(Polygon,4326) NOT NULL,
	"queue_mode_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"commission_pct" double precision NOT NULL,
	"hourly_guarantee_cents" integer,
	"weekly_guarantee_cents" integer,
	"default_dispatch_mode" "dispatch_mode" DEFAULT 'auto_match' NOT NULL,
	"offer_timeout_seconds" integer DEFAULT 20 NOT NULL,
	"unclaimed_alert_seconds" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_config_city_id_unique" UNIQUE("city_id")
);
--> statement-breakpoint
CREATE TABLE "ride_fare_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"line_type" "fare_line_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"status" "offer_status" NOT NULL,
	"source" "assignment_source" NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"eta_seconds" integer NOT NULL,
	"pickup" jsonb NOT NULL,
	"destination" jsonb NOT NULL,
	"quote" jsonb NOT NULL,
	"split" jsonb NOT NULL,
	"queue_position" integer
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "ride_status" NOT NULL,
	"rider_id" uuid NOT NULL,
	"driver_id" uuid,
	"geozone_id" uuid,
	"request" jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"payment_method" "payment_method_type" NOT NULL,
	"category" "ride_category" NOT NULL,
	"pricing_model" "pricing_model",
	"total_cents" integer,
	"commission_pct" double precision,
	"commission_source" "commission_source",
	"commission_cents" integer,
	"driver_net_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "ledger_owner_type" NOT NULL,
	"owner_id" uuid,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"ride_id" uuid,
	"entry_type" "ledger_entry_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid,
	"source" "assignment_source" NOT NULL,
	"dispatcher_id" uuid,
	"reason" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_drivers_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geozones" ADD CONSTRAINT "geozones_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_config" ADD CONSTRAINT "platform_config_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_fare_lines" ADD CONSTRAINT "ride_fare_lines_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_driver_id_drivers_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_rider_id_users_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_drivers_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_geozone_id_geozones_id_fk" FOREIGN KEY ("geozone_id") REFERENCES "public"."geozones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_audit_log" ADD CONSTRAINT "dispatch_audit_log_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_audit_log" ADD CONSTRAINT "dispatch_audit_log_driver_id_drivers_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_audit_log" ADD CONSTRAINT "dispatch_audit_log_dispatcher_id_users_id_fk" FOREIGN KEY ("dispatcher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "geozones_city_slug_uix" ON "geozones" USING btree ("city_id","slug");--> statement-breakpoint
CREATE INDEX "geozones_polygon_gix" ON "geozones" USING gist ("polygon");--> statement-breakpoint
CREATE INDEX "ride_fare_lines_ride_idx" ON "ride_fare_lines" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "ride_offers_ride_idx" ON "ride_offers" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "rides_rider_idx" ON "rides" USING btree ("rider_id");--> statement-breakpoint
CREATE INDEX "rides_driver_idx" ON "rides" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "rides_status_idx" ON "rides" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rides_order_idx" ON "rides" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_owner_uix" ON "ledger_accounts" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "dispatch_audit_log_ride_idx" ON "dispatch_audit_log" USING btree ("ride_id");