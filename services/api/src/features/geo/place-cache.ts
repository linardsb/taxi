import { addressPointSchema, type AddressPoint } from '@taxi/shared';

/**
 * The ONE Places result this codebase is allowed to keep — and, separately,
 * the one it is allowed to SERVE. The two conditions are not the same, and
 * `CachingMapsProvider.resolvePlace` owns the second one: an entry written here
 * is only read back when no autocomplete session is open, because answering a
 * session-bearing resolve from cache abandons that session and bills its
 * keystrokes individually. The arithmetic is in that method's docblock.
 *
 * Autocomplete predictions are Places content and are not cached at all
 * (`CachingMapsProvider.searchAddress` passes straight through) — the policy
 * permits storing the place ID indefinitely and nothing else. What is stored
 * here is the RESOLUTION of a place id: a coordinate and a formatted address,
 * held under a TTL (`MAPS_PLACE_CACHE_TTL_SECONDS`, default 30 days) rather
 * than forever, because those two fields ARE content.
 *
 * `expected`, not verified: the 30-day figure comes from the Places policy page
 * pointing at the Maps Service Terms for the duration, and the terms page was
 * not readable in full on 2026-08-17 (plan Q6). The knob exists so correcting
 * it is one env change, not a deploy.
 *
 * Keyed by LANGUAGE as well as place id: `formattedAddress` comes back
 * localized, so one entry per place would serve a Russian caller a Latvian
 * street name — or worse, pin whichever language asked first.
 *
 * NOT namespaced by `MapsCaller`, unlike the route keys. The route namespaces
 * exist so a 24 h pricing write cannot pin a tracking read to 24 h staleness;
 * here both facades read the same TTL from the same env knob, so there is no
 * asymmetry to protect and sharing the entry is the point.
 */
export function placeCacheKey(language: string, placeId: string): string {
  return `maps:place:v1:${language}:${placeId}`;
}

/**
 * Same rule as the route cache's `parseEntry`: a cache entry is untrusted
 * input, so it is parsed rather than cast, and both a JSON fault and a shape
 * fault mean "treat as absent and re-resolve".
 */
export function parsePlaceEntry(raw: string): AddressPoint | null {
  try {
    const parsed = addressPointSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
