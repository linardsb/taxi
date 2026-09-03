import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  addressSearchQuerySchema,
  resolvePlaceBodySchema,
  type AddressPoint,
  type ApiErrorBody,
  type AddressSearchQuery,
  type AddressSuggestion,
  type JwtClaims,
  type MapsProvider,
  type ResolvePlaceBody,
  type UserRole,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import {
  ADDRESS_RESOLVE_MAX_PER_WINDOW,
  ADDRESS_SEARCH_MAX_PER_WINDOW,
  ADDRESS_SEARCH_WINDOW_SECONDS,
  RIDER_ADDRESS_RESOLVE_MAX_PER_WINDOW,
  RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW,
  addressResolveRateKey,
  addressSearchRateKey,
  riderAddressResolveRateKey,
  riderAddressSearchRateKey,
} from './address-search.policy';
import { MAPS_PROVIDER } from './maps.tokens';

/**
 * Rīga centre — the autocomplete bias origin. The pilot is single-city
 * (`DEFAULT_CITY_ID`), so this is a deployment constant rather than a per-call
 * parameter; the radius around it is `PLACES_BIAS_RADIUS_METERS`.
 */
const RIGA_CENTRE = { lat: 56.9496, lng: 24.1052 };

/**
 * The address typeahead, per ROUTE — the same rule as `DispatchController`.
 *
 * Dispatchers and admins (#19's console), and since #16 RIDERS, whose booking
 * screen has a dropoff field and no map. Riders are admitted with their OWN
 * caps and their OWN key namespaces — `RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW` (30
 * vs the dispatcher's 120) and `RIDER_ADDRESS_RESOLVE_MAX_PER_WINDOW` (10 vs
 * 30) — because the dispatcher numbers are sized for one human at a console
 * running a shift, and widening to a population without resizing would be a
 * regression rather than a feature.
 *
 * The spend argument is why those caps exist at all, and it did not go away when
 * the route widened: EVERY CALL THAT REACHES THE PROVIDER COSTS MONEY, so an
 * uncapped route is a bill with a public endpoint attached. What changed is the
 * actor, not the constraint.
 *
 * `GET /customers/lookup` and `GET /customers/venues` stay dispatcher/admin:
 * they return other people's PII, which no rider has any business reading.
 *
 * Injects `MAPS_PROVIDER` (the cached facade) rather than the source: place
 * resolutions are cached there, and a prefilled saved place must not re-pay on
 * every booking form.
 */
@Controller('geo')
export class AddressSearchController {
  private readonly logger = new Logger(AddressSearchController.name);

  constructor(
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * Below `PLACES_SEARCH_MIN_CHARS` this answers `[]` and spends nothing — a
   * dispatcher mid-word is not an error, and a 400 would make the console
   * render a failure on the way to a normal result.
   *
   * The short-circuit happens BEFORE the rate limit, deliberately: a request
   * that cannot spend should not consume the quota that exists to bound spend.
   * That matters more now than it did: a rider typing "Br" is the common case.
   */
  @Get('address-search')
  @Roles('dispatcher', 'admin', 'rider')
  async search(
    @CurrentUser() user: JwtClaims,
    @Query(new ZodValidationPipe(addressSearchQuerySchema))
    query: AddressSearchQuery,
  ): Promise<AddressSuggestion[]> {
    const trimmed = query.q.trim();
    if (trimmed.length < this.env.PLACES_SEARCH_MIN_CHARS) return [];

    const isRider = user.role === 'rider';
    await this.assertWithinRateLimit(
      isRider
        ? riderAddressSearchRateKey(user.sub)
        : addressSearchRateKey(user.sub),
      isRider
        ? RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW
        : ADDRESS_SEARCH_MAX_PER_WINDOW,
      'geo.search.throttled',
      user,
    );

    return this.maps.searchAddress(trimmed, 'lv', {
      bias: {
        center: RIGA_CENTRE,
        radiusMeters: this.env.PLACES_BIAS_RADIUS_METERS,
      },
      sessionToken: query.session,
    });
  }

  /**
   * Terminates the session the search opened, and is the only call that returns
   * a bookable point — `rideRequestSchema` needs a `location`, which a
   * suggestion does not carry.
   *
   * Rate-limited on its OWN key, not the search's. Sharing one meant the cap
   * fell on whichever call came last, and a resolve is always last — so the cap
   * refused precisely the call that closes the billed session and makes the
   * preceding searches free. See `ADDRESS_RESOLVE_MAX_PER_WINDOW`.
   */
  @Post('places/:placeId/resolve')
  @Roles('dispatcher', 'admin', 'rider')
  async resolve(
    @CurrentUser() user: JwtClaims,
    @Param('placeId') placeId: string,
    @Body(new ZodValidationPipe(resolvePlaceBodySchema)) body: ResolvePlaceBody,
  ): Promise<AddressPoint> {
    const isRider = user.role === 'rider';
    await this.assertWithinRateLimit(
      isRider
        ? riderAddressResolveRateKey(user.sub)
        : addressResolveRateKey(user.sub),
      isRider
        ? RIDER_ADDRESS_RESOLVE_MAX_PER_WINDOW
        : ADDRESS_RESOLVE_MAX_PER_WINDOW,
      'geo.resolve.throttled',
      user,
    );

    const point = await this.maps.resolvePlace(placeId, 'lv', body.session);
    // 404, not an empty 200: the console must be able to tell "this place is
    // gone, search again" from "here is your address".
    if (point === null) {
      throw new HttpException('place_not_found', HttpStatus.NOT_FOUND);
    }
    return point;
  }

  /**
   * MIRRORS `RidesService.assertWithinRateLimit`, including the 429 shape and
   * the `Math.max(1, …)` floor — a `retryAfterSeconds` of 0 reads as "retry
   * now" to the client that just got throttled.
   *
   * The warn line names `actorId` and `role`, not `dispatcherId`: since #16 the
   * throttled caller may be a rider, and a line that says `dispatcherId` for one
   * is a FALSE LOG. The whole point of the field is naming the actor that was
   * actually throttled — the same reasoning `rides.service.ts` writes out for
   * the booking cap.
   */
  private async assertWithinRateLimit(
    key: string,
    maxPerWindow: number,
    event: 'geo.search.throttled' | 'geo.resolve.throttled',
    actor: { sub: string; role: UserRole },
  ): Promise<void> {
    const attempts = await this.kv.incrWithTtl(
      key,
      ADDRESS_SEARCH_WINDOW_SECONDS,
    );
    if (attempts <= maxPerWindow) return;

    const retryAfterSeconds = Math.max(1, await this.kv.ttl(key));
    this.logger.warn({
      event,
      actorId: actor.sub,
      role: actor.role,
      attempts,
      at: new Date().toISOString(),
    });
    throw new HttpException(
      {
        message: 'too_many_requests',
        retryAfterSeconds,
      } satisfies ApiErrorBody,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
