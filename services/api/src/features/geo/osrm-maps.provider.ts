import type { LatLng, MapsProvider, RouteResult } from '@taxi/shared';
import { z } from 'zod';

/**
 * The one method this provider owns. OSRM routes and does nothing else — it
 * has no geocoder and no address search — so, like `PlacesProvider`, it
 * declares the narrow shape and `mapsProviderSourceFactory` composes it with
 * whatever owns the rest of the seam.
 */
export type RoutesProvider = Pick<MapsProvider, 'route'>;

/**
 * How far OSRM may move a point to reach a road before the answer is refused.
 *
 * OSRM never says "no road here": it snaps every coordinate to the NEAREST
 * road in the graph, however far away, and answers `Ok`. `observed` 2026-09-29
 * against the Latvia graph (local run, `osrm-backend` v26.4.0): `0,0 → 0.1,0.1`
 * snapped both ends ~6 540 km to the same Lithuanian street and returned
 * `distance: 0` — a free ride, priced silently. Refusing is the honest shape.
 *
 * 1 000 m is `expected`, not measured: a pickup from the LV-restricted
 * typeahead or from coarse GPS sits on or beside a street, so a real booking is
 * tens of metres from its snap point, and a kilometre is a generous margin
 * before "this point is not on the Latvian road network". A provider internal,
 * not business config — nothing prices off it.
 */
export const MAX_SNAP_METERS = 1_000;

/**
 * Coordinate-free, like every string this file throws: `CachingMapsProvider`
 * logs only a closed `reason` and the error's NAME, and `PricingService` and
 * `TrackingService` are both downstream of the message. OSRM's own `message`
 * field quotes the query string — the coordinates — so it is never read.
 */
const OSRM_UNAVAILABLE = 'maps_osrm_unavailable';
const OSRM_NO_ROUTE = 'maps_osrm_no_route';
const OSRM_OFF_NETWORK = 'maps_osrm_off_network';
const OSRM_CONTRACT_VIOLATION = 'maps_osrm_contract_violation';
const OSRM_TIMEOUT = 'maps_osrm_timeout';

/**
 * Letters only, so `CachingMapsProvider`'s `safeErrorName` passes each one
 * through to `geo.maps.route_failed`'s `errorName` — a CLOSED set of names that
 * says which of these it was, where a bare `Error` would say nothing.
 */
type OsrmErrorName =
  | 'OsrmUnavailable'
  | 'OsrmNoRoute'
  | 'OsrmOffNetwork'
  | 'OsrmContractViolation'
  | 'OsrmTimeout';

function osrmError(name: OsrmErrorName, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/**
 * `code` is checked separately from the body shape: every OSRM answer carries
 * one, and a non-`Ok` code is a routing answer ("no route"), not a broken
 * contract.
 */
const codeSchema = z.object({ code: z.string() });

const routeResponseSchema = z.object({
  code: z.literal('Ok'),
  routes: z
    .array(
      z.object({
        distance: z.number().nonnegative(),
        duration: z.number().nonnegative(),
        geometry: z.string(),
      }),
    )
    .min(1),
  waypoints: z.array(z.object({ distance: z.number().nonnegative() })),
});

/**
 * Codes that mean "this query has no route", as opposed to "the server is
 * unwell". Both still throw — the seam has no "no route" result — but under
 * different names, because one is a data problem and the other is an outage.
 */
const NO_ROUTE_CODES = new Set(['NoRoute', 'NoSegment']);

/**
 * Self-hosted OSRM (#134) over its HTTP `route` service, on the Latvia OSM
 * extract (`compose.prod.yml`, runbook §5.5). Plain `fetch`, no client
 * library: one GET per route.
 *
 * Sits BEHIND both `CachingMapsProvider` facades exactly as the stub did —
 * those own caching, the negative cache, the latency race and the
 * `geo.maps.route_failed` taxonomy. This class owns only what they cannot
 * know: OSRM's wire format, its error shapes, and cancelling its request.
 *
 * Never logs. The facades log every outcome already, and the request URL is a
 * pair of coordinates — the one thing `.claude/references/logging-standard.md`
 * forbids in a log line.
 */
export class OsrmMapsProvider implements RoutesProvider {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly timeoutMs: number,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async route(
    from: LatLng,
    to: LatLng,
    stops: LatLng[] = [],
  ): Promise<RouteResult> {
    // OSRM takes LONGITUDE first, `;`-separated — the same order trap as
    // PostGIS's `ST_MakePoint(lng, lat)`.
    const coordinates = [from, ...stops, to]
      .map((p) => `${p.lng},${p.lat}`)
      .join(';');
    // `overview=full`: the polyline is for drawing, and a simplified one cuts
    // corners through buildings. `geometries=polyline` is Google's precision-5
    // encoding, which is what `RouteResult.polyline` means.
    const url = `${this.baseUrl}/route/v1/driving/${coordinates}?overview=full&geometries=polyline&steps=false&alternatives=false`;

    const body = await this.request(url);

    const parsed = routeResponseSchema.safeParse(body);
    if (!parsed.success) {
      const code = codeSchema.safeParse(body);
      if (code.success && NO_ROUTE_CODES.has(code.data.code)) {
        throw osrmError('OsrmNoRoute', OSRM_NO_ROUTE);
      }
      // NOT the ZodError: `CachingMapsProvider.classify` reads a ZodError as
      // its OWN write-path parse failing. This name says whose contract broke.
      throw osrmError('OsrmContractViolation', OSRM_CONTRACT_VIOLATION);
    }

    if (parsed.data.waypoints.some((w) => w.distance > MAX_SNAP_METERS)) {
      throw osrmError('OsrmOffNetwork', OSRM_OFF_NETWORK);
    }

    const route = parsed.data.routes[0]!;
    return {
      // OSRM answers in float metres and seconds; the seam (and the cache's
      // write-path schema) is integers.
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      polyline: route.geometry,
    };
  }

  /**
   * `AbortController` so a hung OSRM request is actually CANCELLED — the
   * facade's `Promise.race` bounds the caller's latency but leaves the loser
   * running. Same budget (`MAPS_ROUTE_TIMEOUT_MS`), so the two fire together.
   * The timer is cleared in a `finally`: a stubbed `fetch` resolves at once in
   * tests, and a dangling timer per call is an open handle.
   *
   * A 4xx still returns its body: OSRM answers "no route" as a 400 with a
   * JSON `code`, and that is a routing answer, not an outage.
   */
  private async request(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status >= 500) {
        throw osrmError('OsrmUnavailable', OSRM_UNAVAILABLE);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.name.startsWith('Osrm')) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw osrmError('OsrmTimeout', OSRM_TIMEOUT);
      }
      // A refused connection, a DNS failure, a body that is not JSON. The
      // original is dropped on purpose: undici's `cause` can carry the URL.
      throw osrmError('OsrmUnavailable', OSRM_UNAVAILABLE);
    } finally {
      clearTimeout(timer);
    }
  }
}
