import { z } from 'zod';

/**
 * One typeahead row in the dispatcher's booking form (#19).
 *
 * A suggestion is NOT bookable: `rideRequestSchema` needs an `AddressPoint`,
 * which carries a resolved `location`. Choosing a row is what buys the
 * coordinate — see `MapsProvider.resolvePlace`.
 */
export const addressSuggestionSchema = z.object({
  /**
   * Provider place id — the ONLY field here that may be stored indefinitely.
   * The Places policy exempts place IDs from its caching restrictions; every
   * other field on this object is Places content and is not persisted.
   */
  placeId: z.string().min(1),
  /** What the dispatcher reads: "Brīvības iela 45". */
  primaryText: z.string().min(1),
  /** Disambiguator: "Rīga, Latvija". Empty for a result with no context. */
  secondaryText: z.string(),
});
export type AddressSuggestion = z.infer<typeof addressSuggestionSchema>;

/**
 * A search that returned nothing is an empty array, never an error — a
 * dispatcher mid-word is not a failure, and `GET /geo/address-search` answers
 * 200 with `[]` below the minimum query length.
 */
export const addressSuggestionsSchema = z.array(addressSuggestionSchema);

/**
 * `GET /geo/address-search`. The session token is a uuid BY CONTRACT, not by
 * habit: it is interpolated into the provider's URL, and a free-form string
 * there is a request-forgery surface on a route that spends money.
 *
 * One token per address FIELD, minted client-side and reused across that
 * field's keystrokes — that is what collapses a burst into one billed session.
 */
export const addressSearchQuerySchema = z.object({
  q: z.string().max(200),
  session: z.string().uuid(),
});
export type AddressSearchQuery = z.infer<typeof addressSearchQuerySchema>;

/** `POST /geo/places/:placeId/resolve` — terminates the session above. */
export const resolvePlaceBodySchema = z.object({
  session: z.string().uuid(),
});
export type ResolvePlaceBody = z.infer<typeof resolvePlaceBodySchema>;
