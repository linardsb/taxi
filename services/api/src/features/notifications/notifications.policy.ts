import type {
  LatLng,
  RideStatus,
  RouteResult,
  TrackingPageState,
} from '@taxi/shared';

/**
 * How long a TERMINAL ride stays viewable on the tracking page, measured from
 * `rides.updated_at` — after that the token answers 410. "Expires with the
 * ride" left the grace unstated; 24 h lets an evening ride be shown to a
 * family member the next morning without keeping dead links alive forever
 * (plan resolution #3).
 */
export const TRACKING_TERMINAL_GRACE_SECONDS = 86_400;

/**
 * The FALLBACK ETA: straight-line metres ÷ this = minutes. 417 m/min ≈
 * 25 km/h, a city-traffic average.
 *
 * No longer what the tracking page shows — that runs through the maps seam
 * (#87) and reaches this only when the route call fails, which is why a crude
 * number is still the right one to keep: it needs no network and cannot fail.
 * The assigned-SMS estimate (`etaToPickup`) is still computed this way,
 * being one-shot per ride rather than polled.
 */
export const TRACKING_ETA_SPEED_METERS_PER_MINUTE = 417;

/**
 * Decimals the tracking page's route ORIGIN is snapped to before it reaches
 * the maps seam. At Rīga's ~57°N a 3-decimal cell is ~111 m of latitude ×
 * ~61 m of longitude — the ticket's "~100 m grid".
 *
 * It must stay COARSER than `CachingMapsProvider`'s `COORD_PRECISION = 4`:
 * that key renders coordinates through `toFixed(4)`, so every raw position
 * inside one cell yields identical key text and therefore one cache entry.
 * That is the whole design — the page polls every 5 s, and what costs a paid
 * call is a driver crossing a cell, not a poll.
 *
 * The cell is ANISOTROPIC, so one interval cannot describe it. At the speed
 * above (417 m/min) a crossing costs one call per ~16 s driving due N/S, per
 * ~8.8 s due E/W, and per ~7.7 s on the worst heading (~61° off north);
 * averaged over a uniform heading it is ~6.8 crossings/min, one per ~8.9 s.
 * Against 12 polls/min unquantized that is a ~2× reduction for a moving
 * driver — not the ~3× that the ~16 s figure alone implies, which is the due
 * N/S BEST case, not the worst.
 *
 * The larger win is the driver who is NOT moving — waiting at the kerb, in
 * `arrived`, stuck in traffic. Raw GPS jitter of ±10–20 m mints a fresh
 * 4-decimal key on nearly every poll, indefinitely; this grid collapses that
 * to the one to four cells the jitter spans, all cached after first visit.
 * That case is what the grid really rescues.
 *
 * 4 decimals is the key's own precision and would buy nothing; 2 (~1.1 km)
 * would put the ETA visibly wrong at the kerb.
 */
export const TRACKING_ETA_GRID_DECIMALS = 3;

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

/**
 * Snaps a position onto the grid above. For the CACHE KEY only: the page keeps
 * showing the raw position, because the map has to show where the car is, and
 * a snapped marker would visibly jump between cells.
 */
export function quantizeForEtaCache(point: LatLng): LatLng {
  return {
    lat: Number(point.lat.toFixed(TRACKING_ETA_GRID_DECIMALS)),
    lng: Number(point.lng.toFixed(TRACKING_ETA_GRID_DECIMALS)),
  };
}

/** Same never-0 policy as `estimateEtaMinutes`, applied to a routed leg. */
export function etaMinutesFromRoute(route: RouteResult): number {
  return Math.max(1, Math.ceil(route.durationSeconds / 60));
}
