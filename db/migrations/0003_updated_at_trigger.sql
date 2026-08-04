-- The database owns `updated_at`, on both insert (DEFAULT now()) and update
-- (this trigger). Previously the update value came from Drizzle's
-- `.$onUpdate(() => new Date())` — the APPLICATION's clock — while the insert
-- value came from `DEFAULT now()`, the DATABASE's clock. Any skew between the
-- two made `updated_at` land BEFORE `created_at`: reproduced locally, where
-- Docker Desktop holds the VM clock ~65 ms ahead of the host, and equally
-- reachable in production from two api nodes whose clocks disagree.
--
-- Postgres has no MySQL-style ON UPDATE clause, so a BEFORE UPDATE trigger is
-- the only way to keep one clock authoritative.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS rides_set_updated_at ON rides;
--> statement-breakpoint
CREATE TRIGGER rides_set_updated_at
  BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS platform_config_set_updated_at ON platform_config;
--> statement-breakpoint
CREATE TRIGGER platform_config_set_updated_at
  BEFORE UPDATE ON platform_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
