-- #316 (architecture K1, option E1): Autopārvadājumu likums 35.² (5) forbids
-- deleting or correcting records of accepted, refused and provided trips,
-- drivers and vehicles. Every guard raises SQLSTATE P0001 with the message
-- prefix `protected_record:` so tests and logs can tell it from an FK error.
-- Superuser `taxi` can still DISABLE TRIGGER; option E2 (least-privilege role)
-- is deferred (K1). Trigger names are mirrored in `db/src/protected-tables.ts`,
-- whose test checks each one exists and is enabled.

CREATE OR REPLACE FUNCTION protected_record_refuse() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'protected_record: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;

--> statement-breakpoint
-- ride_events: append-only.
DROP TRIGGER IF EXISTS ride_events_protect ON ride_events;
--> statement-breakpoint
CREATE TRIGGER ride_events_protect BEFORE UPDATE OR DELETE ON ride_events FOR EACH ROW EXECUTE FUNCTION protected_record_refuse();
--> statement-breakpoint
DROP TRIGGER IF EXISTS ride_events_protect_truncate ON ride_events;
--> statement-breakpoint
-- Row triggers do not fire on TRUNCATE.
CREATE TRIGGER ride_events_protect_truncate BEFORE TRUNCATE ON ride_events FOR EACH STATEMENT EXECUTE FUNCTION protected_record_refuse();
--> statement-breakpoint
DROP TRIGGER IF EXISTS rides_no_delete ON rides;
--> statement-breakpoint
CREATE TRIGGER rides_no_delete BEFORE DELETE ON rides FOR EACH ROW EXECUTE FUNCTION protected_record_refuse();
--> statement-breakpoint
DROP TRIGGER IF EXISTS rides_no_truncate ON rides;
--> statement-breakpoint
-- Row triggers do not fire on TRUNCATE.
CREATE TRIGGER rides_no_truncate BEFORE TRUNCATE ON rides FOR EACH STATEMENT EXECUTE FUNCTION protected_record_refuse();
--> statement-breakpoint
DROP TRIGGER IF EXISTS drivers_no_delete ON drivers;
--> statement-breakpoint
CREATE TRIGGER drivers_no_delete BEFORE DELETE ON drivers FOR EACH ROW EXECUTE FUNCTION protected_record_refuse();
--> statement-breakpoint
DROP TRIGGER IF EXISTS drivers_no_truncate ON drivers;
--> statement-breakpoint
-- Row triggers do not fire on TRUNCATE.
CREATE TRIGGER drivers_no_truncate BEFORE TRUNCATE ON drivers FOR EACH STATEMENT EXECUTE FUNCTION protected_record_refuse();
--> statement-breakpoint
DROP TRIGGER IF EXISTS vehicles_no_delete ON vehicles;
--> statement-breakpoint
CREATE TRIGGER vehicles_no_delete BEFORE DELETE ON vehicles FOR EACH ROW EXECUTE FUNCTION protected_record_refuse();
--> statement-breakpoint
DROP TRIGGER IF EXISTS vehicles_no_truncate ON vehicles;
--> statement-breakpoint
-- Row triggers do not fire on TRUNCATE.
CREATE TRIGGER vehicles_no_truncate BEFORE TRUNCATE ON vehicles FOR EACH STATEMENT EXECUTE FUNCTION protected_record_refuse();
--> statement-breakpoint
-- ride_offers: only the moves the code makes. Every column except the three
-- mutable ones is frozen, so a column added later is frozen by default.
CREATE OR REPLACE FUNCTION ride_offers_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'protected_record: DELETE on ride_offers is not allowed';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'responded_at' - 'decline_reason')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'responded_at' - 'decline_reason') THEN
    RAISE EXCEPTION 'protected_record: ride_offers % may only change status, responded_at, decline_reason', OLD.id;
  END IF;
  IF NOT ((OLD.status = 'pending' AND NEW.status IN ('accepted','declined','expired','revoked'))
       OR (OLD.status = 'accepted' AND NEW.status = 'revoked')) THEN
    RAISE EXCEPTION 'protected_record: ride_offers % % -> % is not allowed', OLD.id, OLD.status, NEW.status;
  END IF;
  IF OLD.responded_at IS NOT NULL AND NEW.responded_at IS DISTINCT FROM OLD.responded_at THEN
    RAISE EXCEPTION 'protected_record: ride_offers.responded_at is written once';
  END IF;
  IF OLD.decline_reason IS NOT NULL AND NEW.decline_reason IS DISTINCT FROM OLD.decline_reason THEN
    RAISE EXCEPTION 'protected_record: ride_offers.decline_reason is written once';
  END IF;
  IF NEW.decline_reason IS NOT NULL AND NEW.status <> 'declined' THEN
    RAISE EXCEPTION 'protected_record: decline_reason only on a declined offer';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ride_offers_guard ON ride_offers;
--> statement-breakpoint
CREATE TRIGGER ride_offers_guard BEFORE UPDATE OR DELETE ON ride_offers FOR EACH ROW EXECUTE FUNCTION ride_offers_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS ride_offers_protect_truncate ON ride_offers;
--> statement-breakpoint
CREATE TRIGGER ride_offers_protect_truncate BEFORE TRUNCATE ON ride_offers FOR EACH STATEMENT EXECUTE FUNCTION protected_record_refuse();
