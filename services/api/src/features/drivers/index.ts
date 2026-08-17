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
