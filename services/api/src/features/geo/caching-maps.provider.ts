import { Logger } from '@nestjs/common';
import type {
  AddressPoint,
  AddressSearchOptions,
  AddressSuggestion,
  GeocodeResult,
  Language,
  LatLng,
  MapsProvider,
  RouteResult,
} from '@taxi/shared';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { KeyValueStore } from '../../common/kv/kv.store';
import { parsePlaceEntry, placeCacheKey } from './place-cache';

/**
 * ~11 m. The hit-rate/accuracy knob: 3 decimals (~111 m) would raise the hit
 * rate and cost a few cents of fare accuracy. Real hit rates are unmeasurable
 * until there is traffic — revisit when the first Google bill exists.
 *
 * Exported because it is also the unit the `mint:ride` instrument derives its
 * sub-cell jitter step from (#108) — the smallest move that mints a distinct
 * cache key here is the smallest move an unquantized pass pays for. Moving this
 * number moves that jitter with it, rather than leaving a stale literal behind.
 */
export const COORD_PRECISION = 4;

/**
 * Who this instance routes for. Construction-time configuration, NOT per-call
 * data: there are exactly two call sites (`pricing.service.ts`,
 * `tracking.service.ts`) and neither varies its caller at runtime, which is
 * why this is a constructor argument rather than a fourth parameter on
 * `MapsProvider.route()` — that would be a cross-surface contract change in
 * `packages/shared` for attribution a second bound instance gives for free.
 *
 * It buys three things at once: the `caller` field on every log payload, cache
 * namespaces that cannot collide (so a 24 h pricing write cannot pin a
 * tracking read to 24 h staleness), and the ability to run the negative cache
 * ON for `eta` and OFF for `quote` — see `geo.module.ts`.
 */
export type MapsCaller = 'quote' | 'eta';

/**
 * Why a route call did not produce a route. A CLOSED enum, and that is the
 * whole point: a provider's free-text `error.message` never reaches a log line
 * or a Redis value, so a message that embedded coordinates could not echo one
 * into a log `.claude/references/logging-standard.md:14` forbids. Structural,
 * not a regex scrubber a future provider's format could slip past.
 */
export type MapsFailureReason =
  'timeout' | 'source_rejected' | 'contract_violation' | 'negative_cached';

/**
 * The race timer's message, and the only way `route()` tells a timeout from a
 * provider rejection. Coordinate-free by construction, like every string this
 * file throws — `TrackingService` and `PricingService` are both downstream.
 */
const ROUTE_TIMEOUT_MESSAGE = 'maps_route_timeout';

/** What a negative-cache hit throws. Same coordinate-free rule. */
const ROUTE_UNAVAILABLE_MESSAGE = 'maps_route_unavailable';

/**
 * Coordinates are rounded to fixed text, never `JSON.stringify`ed — the float
 * text is not rounded, so `24.1` and `24.100000000000001` would otherwise be
 * two different cache entries for the same corner.
 *
 * Shared by both key builders so the success key and the failure key cannot
 * drift apart and start describing different corridors.
 */
function renderPoints(from: LatLng, to: LatLng, stops: LatLng[]): string {
  return [from, ...stops, to]
    .map(
      (p) =>
        `${p.lat.toFixed(COORD_PRECISION)},${p.lng.toFixed(COORD_PRECISION)}`,
    )
    .join('|');
}

/**
 * The `v1` segment is deliberate: a change to `RouteResult`'s shape bumps it
 * rather than poisoning live cache entries mid-deploy.
 *
 * It stays `v1` through the caller namespacing added here — `RouteResult`'s
 * shape did not change, and inserting the segment already makes every
 * pre-existing key unreachable. They age out, which is exactly the outcome the
 * paragraph above describes.
 */
export function routeCacheKey(
  caller: MapsCaller,
  from: LatLng,
  to: LatLng,
  stops: LatLng[] = [],
): string {
  return `maps:route:v1:${caller}:${renderPoints(from, to, stops)}`;
}

/**
 * The negative cache's sibling key. A separate key rather than a sentinel
 * VALUE under the route key, so a cached success and a cached failure can
 * coexist and the success can win — which is what keeps a corridor that routed
 * before an outage serving until its own TTL.
 */
export function routeFailureKey(
  caller: MapsCaller,
  from: LatLng,
  to: LatLng,
  stops: LatLng[] = [],
): string {
  return `maps:route:fail:v1:${caller}:${renderPoints(from, to, stops)}`;
}

/**
 * A cache entry is untrusted input like any other boundary, so reads are
 * PARSED, not cast: a shape change mid-deploy fails loudly instead of feeding
 * `NaN` cents into a fare.
 */
export const routeResultSchema = z.object({
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  polyline: z.string(),
});

/**
 * A cache entry is recoverable, not fatal: malformed bytes throw from
 * `JSON.parse` and a rejected value throws from zod, and both mean the same
 * thing to the caller — treat the entry as absent and re-route.
 */
function parseEntry(raw: string): RouteResult | null {
  try {
    const parsed = routeResultSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * A correlation id for a corridor, structurally free of coordinates. Stable
 * per cache key, so "this cell keeps failing" is answerable from the logs
 * without any line ever rendering a position.
 */
function cellOf(key: string): string {
  return createHash('sha256').update(key).digest('base64url').slice(0, 10);
}

/**
 * `error.name` is a class name BY CONVENTION ONLY — it is a writable own
 * property on every `Error` instance, so an adapter that sets
 * `err.name = 'route 56.9,24.1 failed'` would put a coordinate straight into a
 * log line `.claude/references/logging-standard.md:14` forbids. Letters only,
 * length-capped: every class name actually in play (`Error`, `TypeError`,
 * `ZodError`, ioredis' `ReplyError`) passes, and nothing carrying a digit, a
 * dot or a comma can.
 *
 * That makes the sanitization STRUCTURAL, matching the closed `reason` enum
 * beside it — the alternative was a docblock asserting a guarantee the type
 * system does not give, which is what this rule exists to stop.
 */
const SAFE_ERROR_NAME = /^[A-Za-z]{1,40}$/;

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  return SAFE_ERROR_NAME.test(error.name) ? error.name : 'unsafe_name';
}

/** A ZodError can only come from this file's own write-path `parse()`. */
function classify(
  error: unknown,
): Exclude<MapsFailureReason, 'negative_cached'> {
  if (error instanceof z.ZodError) return 'contract_violation';
  if (error instanceof Error && error.message === ROUTE_TIMEOUT_MESSAGE) {
    return 'timeout';
  }
  return 'source_rejected';
}

/**
 * Memoizes `route()` in Redis. Implements the same seam it wraps, so the cache
 * is invisible to every consumer and the real Google provider drops into
 * `MAPS_PROVIDER_SOURCE` (#13/#16) with the caching untouched.
 *
 * The seam's docblock says implementations MUST cache aggressively; this is
 * where that happens, and it is the <€100/mo guardrail in code — an uncached
 * Routes call per ride request, re-quote and price refresh is exactly how a
 * €100/mo budget becomes a €400 bill.
 *
 * TWO instances are bound over ONE source (`geo.module.ts`), differing in
 * caller, TTL and whether they negative-cache. What is still ABSENT is
 * in-flight coalescing: requests arriving before the first `setWithTtl` lands
 * all miss and all reach the source. The tracking page's throttle BOUNDS that
 * path; nothing here closes it. Deferred to #13/#16, where the real
 * concurrency shape is measurable.
 */
export class CachingMapsProvider implements MapsProvider {
  private readonly logger = new Logger(CachingMapsProvider.name);

  /**
   * `failureTtlSeconds: 0` disables the negative cache entirely, and a
   * disabled caller then pays no extra round trip — neither the fail-key read
   * nor the fail-key write happens at all.
   */
  private readonly negativeCache: boolean;

  constructor(
    private readonly inner: MapsProvider,
    private readonly kv: KeyValueStore,
    private readonly caller: MapsCaller,
    private readonly ttlSeconds: number,
    private readonly failureTtlSeconds: number,
    private readonly timeoutMs: number,
    /**
     * Place resolutions, unlike routes, are cached identically by both bound
     * facades — see `place-cache.ts` for why there is no caller namespace.
     */
    private readonly placeTtlSeconds: number,
  ) {
    this.negativeCache = failureTtlSeconds > 0;
  }

  async route(
    from: LatLng,
    to: LatLng,
    stops: LatLng[] = [],
  ): Promise<RouteResult> {
    const key = routeCacheKey(this.caller, from, to, stops);
    const failKey = routeFailureKey(this.caller, from, to, stops);

    // One round trip on the miss path, not two: the fail key is only worth
    // reading for a caller that writes one.
    const [hit, failed]: [string | null, string | null] = this.negativeCache
      ? await Promise.all([this.kv.get(key), this.kv.get(failKey)])
      : [await this.kv.get(key), null];

    if (hit !== null) {
      const cached = parseEntry(hit);
      // A cached SUCCESS always outranks a cached failure — checked first, so
      // a corridor that routed before an outage keeps serving until its own
      // TTL rather than going dark with everything else.
      if (cached !== null) return cached;
      // A value the write path accepted and this parse rejects. Without the
      // delete, every later request for this corridor throws until the TTL
      // runs out — and the busiest routes are exactly the ones that cached.
      await this.kv.del(key);
    }

    if (failed !== null) {
      // Deliberately does NOT refresh the fail key: `setWithTtl` resets the
      // expiry, so writing here would let a 5 s poll hold a 60 s memory open
      // forever and turn a transient blip into a permanent outage.
      this.logFailure('negative_cached', key);
      throw new Error(ROUTE_UNAVAILABLE_MESSAGE);
    }

    try {
      const result = await this.fetchWithTimeout(from, to, stops);
      // ROUNDED, then parsed. Google's Routes API documents `duration` as a
      // fractional-seconds string (`"1187.400s"`), so fractional is the
      // documented shape, not an edge case. Left unrounded it threw on every
      // call, was swallowed by `roadEta`'s catch, and pinned every ETA on the
      // platform to haversine permanently while the page kept answering 200.
      // Rounding costs sub-metre and sub-second accuracy — nothing. `parse()`
      // still rejects NaN, negatives, missing fields and wrong types, which is
      // what it was actually for.
      const validated = routeResultSchema.parse({
        ...result,
        distanceMeters: Math.round(result.distanceMeters),
        durationSeconds: Math.round(result.durationSeconds),
      });
      // THE paid-call counter: one line per call that would have cost money.
      // Before this existed, the only counter in the codebase was a test fake.
      //
      // Emitted BEFORE the cache write, not after: the money is already spent
      // by this point, so whether the call gets counted must not depend on
      // Redis accepting a write. Ordered the other way, the counter
      // under-reported spend precisely when Redis was unhealthy.
      this.logger.log({
        event: 'geo.maps.route_fetched',
        caller: this.caller,
        cell: cellOf(key),
        distanceMeters: validated.distanceMeters,
        durationSeconds: validated.durationSeconds,
        at: new Date().toISOString(),
      });
      await this.kv
        .setWithTtl(key, JSON.stringify(validated), this.ttlSeconds)
        .catch((error: unknown) => this.cacheWriteFailed('route', key, error));
      return validated;
    } catch (error) {
      const reason = classify(error);
      // Logged BEFORE the fail-key write. This line is the only production
      // signal that the provider is failing, and a write that threw here used
      // to lose it exactly when it mattered — while also replacing the real
      // error with a Redis one on its way out.
      this.logFailure(reason, key, error);
      // All three kinds are remembered, including `contract_violation`: a
      // systematically broken adapter fails identically next time, and each
      // retry costs money.
      if (this.negativeCache) {
        await this.kv
          .setWithTtl(failKey, reason, this.failureTtlSeconds)
          .catch((cacheError: unknown) =>
            this.cacheWriteFailed('failure', key, cacheError),
          );
      }
      throw error;
    }
  }

  /**
   * Bounds LATENCY, not spend: `Promise.race` does not cancel the loser, so
   * the upstream call keeps running and still bills. What it buys is that a
   * hung Routes call cannot hang `GET /track/:token`.
   *
   * `clearTimeout` in a `finally` is load-bearing, not tidiness:
   * `StubMapsProvider` resolves synchronously, so an uncleared timer would
   * dangle for the full timeout on every single test in the suite and Jest
   * would report open handles.
   */
  private async fetchWithTimeout(
    from: LatLng,
    to: LatLng,
    stops: LatLng[],
  ): Promise<RouteResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.inner.route(from, to, stops),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(ROUTE_TIMEOUT_MESSAGE)),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `reason` is a closed enum and `errorName` goes through `safeErrorName`, so
   * neither CAN contain a coordinate — enforced, not asserted. The provider's
   * own message is deliberately absent: that detail belongs to the Google
   * adapter (#13/#16), the only code that knows its own error shapes well
   * enough to sanitize them knowingly.
   */
  private logFailure(
    reason: MapsFailureReason,
    key: string,
    error?: unknown,
  ): void {
    const payload = {
      event: 'geo.maps.route_failed',
      caller: this.caller,
      cell: cellOf(key),
      reason,
      ...(reason === 'source_rejected' && error instanceof Error
        ? { errorName: safeErrorName(error) }
        : {}),
      at: new Date().toISOString(),
    };
    // `error`, not `warn`: a contract violation means a systematically broken
    // adapter, and it is the failure mode that silently degrades the whole
    // platform to haversine while every page still answers 200.
    if (reason === 'contract_violation') this.logger.error(payload);
    else this.logger.warn(payload);
  }

  /**
   * Both cache WRITES are best-effort, and this is what "best-effort" costs.
   *
   * Scope, stated exactly: the two `setWithTtl` calls in `route()`. The `get`s
   * and the `del` above them are NOT covered — they still propagate, as they
   * did before this. So this is not "a cache fault can never fail a route
   * call"; it is "a failed cache WRITE cannot".
   *
   * Why those two specifically: each is pure memoization. The success write
   * only saves the NEXT caller a paid call, and the fail write only saves it
   * during an outage — neither is part of answering the call in hand. Letting
   * them throw meant a partial Redis fault (writes rejected, reads fine — OOM
   * under `noeviction`, a `READONLY` replica, `MISCONF`) turned a route that
   * had already succeeded AND BILLED into a `source_rejected` failure: a false
   * attribution, an uncounted paid call, and for `eta` a corridor negative-
   * cached dark for the whole failure TTL.
   *
   * NOT silent, deliberately: a cache that has quietly stopped writing means
   * every later call for that corridor re-pays, which is the exact spend this
   * class exists to prevent. `cell` is hashed from the SUCCESS key for both
   * kinds, so a failed fail-key write still correlates with the corridor's
   * other lines. `safeErrorName`, never the message — a Redis error's text is
   * free-form and the key it names carries coordinates.
   */
  private cacheWriteFailed(
    kind: 'route' | 'failure' | 'place',
    key: string,
    error: unknown,
  ): void {
    this.logger.warn({
      event: 'geo.maps.cache_write_failed',
      caller: this.caller,
      cell: cellOf(key),
      kind,
      errorName: safeErrorName(error),
      at: new Date().toISOString(),
    });
  }

  // Uncached, straight through: nothing calls these yet, and caching a call
  // that throws is dead code.
  geocode(query: string, language: Language): Promise<GeocodeResult[]> {
    return this.inner.geocode(query, language);
  }

  reverseGeocode(
    location: LatLng,
    language: Language,
  ): Promise<GeocodeResult | null> {
    return this.inner.reverseGeocode(location, language);
  }

  /**
   * UNCACHED BY POLICY, not by omission. Predictions are Places content and the
   * caching exception covers place IDs only. The spend controls on this path
   * are the session token (which bills a burst of keystrokes as one session),
   * the client's 300 ms debounce, the minimum query length and the controller's
   * rate limit — not a cache.
   */
  searchAddress(
    query: string,
    language: Language,
    options: AddressSearchOptions,
  ): Promise<AddressSuggestion[]> {
    return this.inner.searchAddress(query, language, options);
  }

  /**
   * Cached ONLY when no session is open — and that condition is the whole
   * design, not a special case.
   *
   * Serving a SESSION-BEARING resolve from cache is a spend REGRESSION, which
   * is the opposite of what a cache is for here. Walk the money (`derived`,
   * from the prices plan Q5 recorded on 2026-08-17: Autocomplete Requests
   * $2.83/1,000, Place Details Essentials $5.00/1,000, Autocomplete Session
   * Usage free):
   *
   * - MISS, session terminated: N keystroke requests + 1 details call bill as
   *   one session + $5.00/1,000 — the N requests cost nothing.
   * - HIT, session abandoned: no details call, so the session never terminates
   *   and those same N requests bill individually at $2.83/1,000 each.
   *
   * Break-even is N < 5.00 ÷ 2.83 ≈ 1.77, i.e. one request; at the plan's
   * expected 5 per field a cache hit costs 5 × $2.83 = $14.15/1,000 against
   * $5.00/1,000 for the miss — roughly 3× worse. So a typed lookup ALWAYS
   * reaches the provider and terminates its session.
   *
   * `sessionToken === null` is the case the cache exists for: re-resolving a
   * saved place, where nobody typed and no autocomplete request was billed.
   * Nothing calls that path yet — the saved-place refresh is future work — so
   * the read below is inert today while the write keeps entries warm for it.
   * Stated rather than implied, because an inert cache that looks live is
   * exactly the kind of claim this repo has shipped before.
   */
  async resolvePlace(
    placeId: string,
    language: Language,
    sessionToken: string | null,
  ): Promise<AddressPoint | null> {
    const key = placeCacheKey(language, placeId);
    const hit = sessionToken === null ? await this.kv.get(key) : null;
    if (hit !== null) {
      const cached = parsePlaceEntry(hit);
      if (cached !== null) return cached;
      await this.kv.del(key);
    }

    const resolved = await this.inner.resolvePlace(
      placeId,
      language,
      sessionToken,
    );
    // A null is NOT cached: it means the provider no longer knows the id, and
    // remembering that would keep a since-corrected place dark for 30 days.
    if (resolved === null) return null;

    this.logger.log({
      event: 'geo.maps.place_resolved',
      caller: this.caller,
      cell: cellOf(key),
      at: new Date().toISOString(),
    });
    await this.kv
      .setWithTtl(key, JSON.stringify(resolved), this.placeTtlSeconds)
      .catch((error: unknown) => this.cacheWriteFailed('place', key, error));
    return resolved;
  }
}
