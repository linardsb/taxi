import type { Ride } from '@taxi/shared';

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
 */
export type RiderVisibleRide = Omit<Ride, 'split'> & { split: null };
