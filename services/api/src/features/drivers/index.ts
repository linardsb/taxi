/**
 * The drivers slice's public API — nothing outside imports past this file.
 *
 * #10 (dispatch) consumes exactly two things through it:
 * `DriverLocationService.findNearest()` for raw proximity, and
 * `DriversService.findMatchAttributes()` for the attributes it filters that
 * list by. Everything else here is the slice's own wiring.
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
