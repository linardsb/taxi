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
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import {
  ADDRESS_RESOLVE_MAX_PER_WINDOW,
  ADDRESS_SEARCH_MAX_PER_WINDOW,
  ADDRESS_SEARCH_WINDOW_SECONDS,
  addressResolveRateKey,
  addressSearchRateKey,
} from './address-search.policy';
import { MAPS_PROVIDER } from './maps.tokens';

/**
 * Rīga centre — the autocomplete bias origin. The pilot is single-city
 * (`DEFAULT_CITY_ID`), so this is a deployment constant rather than a per-call
 * parameter; the radius around it is `PLACES_BIAS_RADIUS_METERS`.
 */
const RIGA_CENTRE = { lat: 56.9496, lng: 24.1052 };

/**
 * The dispatcher's typeahead (#19). Dispatcher/admin only, per ROUTE — the same
 * rule as `DispatchController`, and here it also matters for spend: every call
 * that reaches the provider costs money, so an open route would be a bill with
 * a public endpoint attached.
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
   */
  @Get('address-search')
  @Roles('dispatcher', 'admin')
  async search(
    @CurrentUser() user: JwtClaims,
    @Query(new ZodValidationPipe(addressSearchQuerySchema))
    query: AddressSearchQuery,
  ): Promise<AddressSuggestion[]> {
    const trimmed = query.q.trim();
    if (trimmed.length < this.env.PLACES_SEARCH_MIN_CHARS) return [];

    await this.assertWithinRateLimit(
      addressSearchRateKey(user.sub),
      ADDRESS_SEARCH_MAX_PER_WINDOW,
      'geo.search.throttled',
      user.sub,
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
  @Roles('dispatcher', 'admin')
  async resolve(
    @CurrentUser() user: JwtClaims,
    @Param('placeId') placeId: string,
    @Body(new ZodValidationPipe(resolvePlaceBodySchema)) body: ResolvePlaceBody,
  ): Promise<AddressPoint> {
    await this.assertWithinRateLimit(
      addressResolveRateKey(user.sub),
      ADDRESS_RESOLVE_MAX_PER_WINDOW,
      'geo.resolve.throttled',
      user.sub,
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
   */
  private async assertWithinRateLimit(
    key: string,
    maxPerWindow: number,
    event: 'geo.search.throttled' | 'geo.resolve.throttled',
    dispatcherId: string,
  ): Promise<void> {
    const attempts = await this.kv.incrWithTtl(
      key,
      ADDRESS_SEARCH_WINDOW_SECONDS,
    );
    if (attempts <= maxPerWindow) return;

    const retryAfterSeconds = Math.max(1, await this.kv.ttl(key));
    this.logger.warn({
      event,
      dispatcherId,
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
