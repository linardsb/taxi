CREATE TABLE "ride_tariffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"category" "ride_category" NOT NULL,
	"base_cents" integer NOT NULL,
	"per_km_cents" integer NOT NULL,
	"per_minute_cents" integer NOT NULL,
	"minimum_fare_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ride_tariffs" ADD CONSTRAINT "ride_tariffs_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ride_tariffs_city_category_uix" ON "ride_tariffs" USING btree ("city_id","category");