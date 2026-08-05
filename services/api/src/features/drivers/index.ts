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
 * - No presence clearing on disconnect (#38). A driver who force-quits or
 *   loses the network stays `status = 'online'` in Postgres and a member of
 *   the three `drivers:*:<city>` keys until they toggle again. Dispatch is
 *   unaffected — `DRIVER_LOCATION_TTL_SECONDS` drops a stale position from
 *   `findNearest`, so a ghost can never be offered a ride — but
 *   `findMatchAttributes` still reports them `online`, which #18's board and
 *   #20's stats will read. Deferred because a driver may hold several sockets,
 *   so a correct `handleDisconnect` needs a last-socket check.
 * - No verification of a vehicle's `category` (#20). A driver self-declares
 *   `vip`/`limo`, which is what puts their car in a higher pricing tier.
 *   Driver approval is #20's, and this is the hook it will need.
 */
export { DriversModule } from './drivers.module';
export { DriversService } from './drivers.service';
export type { DriverMatchAttributes } from './drivers.repository';
export { DriverLocationService } from './location/driver-location.service';
export { DRIVER_LOCATION_STORE } from './location/driver-location.store';
export type {
  DriverLocationStore,
  NearbyDriver,
} from './location/driver-location.store';
