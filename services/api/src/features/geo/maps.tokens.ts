/**
 * The cached facade every consumer injects. Bound to a `CachingMapsProvider`
 * wrapping whatever `MAPS_PROVIDER_SOURCE` resolves to.
 */
export const MAPS_PROVIDER = 'MAPS_PROVIDER';

/**
 * The underlying implementation the cache decorates — its own token so a test
 * can swap the provider and still exercise the cache path.
 *
 * Overriding `MAPS_PROVIDER` instead would bypass `CachingMapsProvider`
 * entirely, and the cache-hit assertion behind the <€100/mo guardrail would
 * prove nothing. #13/#16 drop the real Google Routes provider in here with the
 * caching untouched.
 */
export const MAPS_PROVIDER_SOURCE = 'MAPS_PROVIDER_SOURCE';
