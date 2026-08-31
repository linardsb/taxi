/**
 * The drivers slice's public API — nothing outside imports past this file.
 *
 * #10 (dispatch) consumes exactly two things through it:
 * `DriverLocationService.findNearest()` for raw proximity, and
 * `DriversService.findMatchAttributes()` for the attributes it filters that
 * list by. Everything else here is the slice's own wiring.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - No verification of a vehicle's `category` (#20). A driver self-declares
 *   `vip`/`limo`, which is what puts their car in a higher pricing tier.
 *   Driver approval is #20's, and this is the hook it will need.
 * - DARK DETECTION (#14) CLOSES REVIEW FINDING L7 — a driver whose socket
 *   stays up but whose GPS goes silent is offline within
 *   `PRESENCE_DARK_AFTER_SECONDS + PRESENCE_SWEEP_INTERVAL_MS` = 75 s of the
 *   last proof of life (`derived`, ticks on schedule). Proof of life is an
 *   accepted fix OR a `PUT status online` re-assert (`markOnline` re-seeds
 *   `seen`), so a GPS-dead phone that re-asserts inside the window is never
 *   dark. The residual ghost is a driver `online` in a Redis set that
 *   survived a deploy with no `seen` score: the sweep marks it dark (unknown
 *   = dark) when Postgres also says `online`, and drops the member when
 *   Postgres says `offline`. An `online` row with NO member (a Postgres
 *   write that failed after the Redis one) is invisible to the sweep and
 *   heals on the driver's next re-assert. `on_ride` drivers are never swept.
 */
export { DriversModule } from './drivers.module';
export { DriversService } from './drivers.service';
export type {
  DriverBoardContact,
  DriverMatchAttributes,
  DriverRosterContact,
} from './drivers.repository';
export { DriverLocationService } from './location/driver-location.service';
export { DRIVER_LOCATION_STORE } from './location/driver-location.store';
export type {
  DriverLocationStore,
  NearbyDriver,
  OnlineDriver,
} from './location/driver-location.store';
