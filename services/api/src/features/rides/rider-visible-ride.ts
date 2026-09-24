import type { PickupPin, Ride } from '@taxi/shared';

/**
 * What `GET /rides/:rideId` hands a rider: the ride row with `split` FORCED
 * NULL, never merely absent.
 *
 * A `Promise<Ride>` signature let a future edit `return found.ride` and
 * typecheck cleanly — `rideSchema.split` is `fareSplitSchema.nullable()`, so the
 * commission line is a legal value there and only an integration test stood
 * between it and a rider surface. Saying it in the type makes the guarantee
 * structural instead of a docblock.
 *
 * NOT a cross-surface contract, so it does not belong in `@taxi/shared`: the
 * wire schema is still `rideSchema`, which the app already imports. This
 * narrows the api's own return type and nothing else.
 *
 * `pickupPin` goes the opposite way (#258): ADDED here, and absent from `Ride`
 * by construction, so this is the only api type that carries it. The wire
 * schema for this read is `riderRideSchema`.
 */
export type RiderVisibleRide = Omit<Ride, 'split'> & {
  split: null;
  pickupPin: PickupPin | null;
};
