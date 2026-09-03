import { Logger } from '@nestjs/common';
import type {
  AddressPoint,
  AddressSearchOptions,
  AddressSuggestion,
  Language,
  MapsProvider,
} from '@taxi/shared';
import { z } from 'zod';

/**
 * The two methods this provider owns. It is NOT a `MapsProvider`: routes and
 * geocoding still belong to whatever `MAPS_PROVIDER_SOURCE` composes it with
 * (`StubMapsProvider` today, `OsrmMapsProvider` at #134). Declaring
 * the narrow shape is what makes that composition checkable.
 */
export type PlacesProvider = Pick<
  MapsProvider,
  'searchAddress' | 'resolvePlace'
>;

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';

/**
 * Autocomplete returns the id and the two display strings; nothing else is
 * requested, because a field mask is a price list — every extra field can move
 * the call into a dearer SKU.
 */
const AUTOCOMPLETE_FIELD_MASK =
  'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat';

/**
 * **Place Details ESSENTIALS**, and this exact mask is the cost model.
 *
 * `location` + `formattedAddress` sit in the Essentials SKU, which TERMINATES
 * the autocomplete session — the whole burst of keystrokes then bills as one
 * session instead of one request each. An IDs-Only mask (place id alone) is
 * free but VOIDS the session, so every keystroke bills individually: cheaper
 * per call and several times dearer per booking. Narrowing this mask is not an
 * optimization.
 */
const DETAILS_FIELD_MASK = 'location,formattedAddress';

/** Coordinate- and address-free, like every string this file throws. */
const PLACES_UNAVAILABLE = 'maps_places_unavailable';
const PLACES_TIMEOUT = 'maps_places_timeout';
const PLACES_CONTRACT_VIOLATION = 'maps_places_contract_violation';
/**
 * The key, not the weather (#125). Separate from `PLACES_UNAVAILABLE` because
 * the two need opposite responses: an outage is waited out, a rejected key is
 * an operator error that fails every call until someone changes it.
 */
const PLACES_KEY_REJECTED = 'maps_places_key_rejected';

/**
 * `structuredFormat` nests its text two levels deep, and a suggestion may carry
 * a `queryPrediction` instead of a `placePrediction` (a search term, not a
 * place) — those rows have no place id and are dropped rather than coerced.
 */
const autocompleteResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string().min(1),
            structuredFormat: z.object({
              mainText: z.object({ text: z.string().min(1) }),
              secondaryText: z.object({ text: z.string() }).optional(),
            }),
          })
          .optional(),
      }),
    )
    .optional(),
});

const placeDetailsSchema = z.object({
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  formattedAddress: z.string().min(1),
});

/**
 * Places API (New) over plain `fetch` — no SDK, because both calls are one
 * POST/GET with two headers and a `@googlemaps` dependency would earn nothing.
 *
 * Spend discipline lives in three places and only one of them is here: the
 * session token (this file), the minimum query length and rate limit (the
 * controller), and the debounce (the console). Predictions are never cached —
 * the Places policy permits storing the place ID and nothing else.
 */
export class GooglePlacesProvider implements PlacesProvider {
  private readonly logger = new Logger(GooglePlacesProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async searchAddress(
    query: string,
    language: Language,
    options: AddressSearchOptions,
  ): Promise<AddressSuggestion[]> {
    const body = {
      input: query,
      languageCode: language,
      // Latvia only. A restriction rather than a bias at the country level:
      // the pilot cannot serve a ride to Vilnius, so offering one is a
      // mis-booking waiting to happen.
      includedRegionCodes: ['lv'],
      locationBias: {
        circle: {
          center: {
            latitude: options.bias.center.lat,
            longitude: options.bias.center.lng,
          },
          radius: options.bias.radiusMeters,
        },
      },
      sessionToken: options.sessionToken,
    };

    const raw = await this.request(
      AUTOCOMPLETE_URL,
      AUTOCOMPLETE_FIELD_MASK,
      'autocomplete',
      { method: 'POST', body: JSON.stringify(body) },
    );

    const parsed = autocompleteResponseSchema.safeParse(raw);
    if (!parsed.success) throw new Error(PLACES_CONTRACT_VIOLATION);

    return (parsed.data.suggestions ?? []).flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      if (prediction === undefined) return [];
      return [
        {
          placeId: prediction.placeId,
          primaryText: prediction.structuredFormat.mainText.text,
          secondaryText: prediction.structuredFormat.secondaryText?.text ?? '',
        },
      ];
    });
  }

  async resolvePlace(
    placeId: string,
    language: Language,
    sessionToken: string | null,
  ): Promise<AddressPoint | null> {
    // No token, no `sessionToken` param: a saved-place re-resolve has no
    // session to terminate, and sending an unknown token would be a request
    // Google bills against nothing.
    const session =
      sessionToken === null
        ? ''
        : `&sessionToken=${encodeURIComponent(sessionToken)}`;
    const url = `${DETAILS_BASE_URL}/${encodeURIComponent(placeId)}?languageCode=${language}${session}`;

    const raw = await this.request(url, DETAILS_FIELD_MASK, 'details', {
      method: 'GET',
    });
    // A `null` body is how `request` reports 404 — a place id the provider no
    // longer knows. Not an error: a saved place outlived its place, and the
    // caller re-searches.
    if (raw === null) return null;

    const parsed = placeDetailsSchema.safeParse(raw);
    if (!parsed.success) throw new Error(PLACES_CONTRACT_VIOLATION);

    return {
      location: {
        lat: parsed.data.location.latitude,
        lng: parsed.data.location.longitude,
      },
      address: parsed.data.formattedAddress,
    };
  }

  /**
   * One request path for both SKUs, so the paid-call log line cannot exist for
   * one and not the other.
   *
   * `AbortController` rather than `Promise.race`: unlike the Routes path, this
   * one can actually cancel, and a cancelled request may not bill. The timer is
   * cleared in a `finally` — a stubbed `fetch` resolves synchronously in tests,
   * and a dangling timer per call is how a suite reports open handles.
   */
  private async request(
    url: string,
    fieldMask: string,
    sku: 'autocomplete' | 'details',
    init: { method: string; body?: string },
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: init.method,
        ...(init.body === undefined ? {} : { body: init.body }),
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': fieldMask,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      // THE paid-call counter — one line per call THAT RETURNED A STATUS,
      // which is not the same set as "every call that cost money": a timeout or
      // a network fault throws before this line, and an aborted request may
      // still have billed. So the counter UNDER-reports exactly when Google is
      // degraded, and the spend model read off it is a floor, not a total.
      // Pair it with `geo.places.request_failed` to see the whole picture.
      //
      // Emitted before the body is read, because the money is spent by the time
      // the status arrives. No query text and no address: the input to this
      // call is where a caller lives (`.claude/references/logging-standard.md`).
      this.logger.log({
        event: 'geo.places.request_completed',
        sku,
        status: response.status,
        at: new Date().toISOString(),
      });

      if (response.status === 404) return null;
      // `error`, not `warn`, and its own reason: 401/403 is a key that is
      // missing a service, restricted to another referrer, or simply wrong, and
      // nothing about it self-heals. Folded into `PLACES_UNAVAILABLE` it read
      // as "Google is degraded" — the misconfiguration that `env.schema.ts`
      // flags as one to learn about from a failed deploy rather than a support
      // call, arriving instead as a support call.
      if (response.status === 401 || response.status === 403) {
        this.logger.error({
          event: 'geo.places.request_failed',
          sku,
          reason: 'key_rejected',
          status: response.status,
          at: new Date().toISOString(),
        });
        throw new Error(PLACES_KEY_REJECTED);
      }
      if (!response.ok) throw new Error(PLACES_UNAVAILABLE);
      return await response.json();
    } catch (error) {
      // The provider's own message never propagates — it can contain the query,
      // which is an address. Reduced to the two closed reasons this file owns.
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn({
          event: 'geo.places.request_failed',
          sku,
          reason: 'timeout',
          at: new Date().toISOString(),
        });
        throw new Error(PLACES_TIMEOUT);
      }
      if (
        error instanceof Error &&
        (error.message === PLACES_UNAVAILABLE ||
          error.message === PLACES_CONTRACT_VIOLATION ||
          error.message === PLACES_KEY_REJECTED)
      ) {
        throw error;
      }
      this.logger.warn({
        event: 'geo.places.request_failed',
        sku,
        reason: 'source_rejected',
        at: new Date().toISOString(),
      });
      throw new Error(PLACES_UNAVAILABLE);
    } finally {
      clearTimeout(timer);
    }
  }
}
