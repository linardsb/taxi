import type { LatLng, RideStatus, TrackingPageState } from '@taxi/shared';

/**
 * How long a TERMINAL ride stays viewable on the tracking page, measured from
 * `rides.updated_at` — after that the token answers 410. "Expires with the
 * ride" left the grace unstated; 24 h lets an evening ride be shown to a
 * family member the next morning without keeping dead links alive forever
 * (plan resolution #3).
 */
export const TRACKING_TERMINAL_GRACE_SECONDS = 86_400;

/**
 * v1 ETA: straight-line metres ÷ this = minutes. 417 m/min ≈ 25 km/h, a
 * city-traffic average — deliberately NOT a maps call: the page polls every
 * 5 s and a paid route per poll would torch the <€100/mo guardrail. Upgrade
 * path: the maps seam with a quantized-coordinate cache, as a later ticket.
 */
export const TRACKING_ETA_SPEED_METERS_PER_MINUTE = 417;

/**
 * What the page shows per machine status — coarser on purpose: the rider at
 * the kerb does not care which of four parties cancelled, and every
 * pre-driver status reads as "searching". `expired` is absent because it is
 * not a ride status: the page derives it from the endpoint's 410.
 */
export const TRACKING_STATE_BY_STATUS: Readonly<
  Record<RideStatus, Exclude<TrackingPageState, 'expired'>>
> = {
  scheduled: 'searching',
  requested: 'searching',
  offered: 'searching',
  queued: 'searching',
  accepted: 'assigned',
  arriving: 'arriving',
  arrived: 'arrived',
  in_progress: 'in_progress',
  completed: 'completed',
  settled: 'completed',
  cancelled_by_rider: 'cancelled',
  cancelled_by_driver: 'cancelled',
  cancelled_by_dispatcher: 'cancelled',
  cancelled_by_system: 'cancelled',
};

const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Slice-local great-circle distance, feeding ONLY the ETA estimate above.
 * Deliberately not imported from `features/geo` — its haversine is a stub
 * internal ("nothing outside this slice may price off it") and dies with
 * `StubMapsProvider`; this one survives it, because the estimate here is the
 * documented v1 policy, not a stand-in for a road distance.
 */
function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** Never 0: "arriving in ~0 min" reads as a bug to the person at the kerb. */
export function estimateEtaMinutes(from: LatLng, to: LatLng): number {
  return Math.max(
    1,
    Math.ceil(haversineMeters(from, to) / TRACKING_ETA_SPEED_METERS_PER_MINUTE),
  );
}
