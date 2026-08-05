-- A plate is the identity a rider matches at the kerb, and nothing stopped two
-- drivers registering the same one. Indexed on `upper(plate)` rather than the
-- raw column: a plain unique index is defeated by a single lowercase letter,
-- which leaves the constraint in place and the guarantee gone.
--
-- Deliberately NOT scoped to the driver. The point is that no two drivers can
-- hold one plate, and a per-driver index would permit exactly the collision
-- this exists to stop.

CREATE UNIQUE INDEX "vehicles_plate_uix" ON "vehicles" USING btree (upper("plate"));