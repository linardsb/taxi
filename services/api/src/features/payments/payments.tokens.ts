/**
 * The charge facade every consumer injects — bound to `StripePaymentsProvider`
 * when a test-mode key is configured, and to `StubPaymentsProvider` otherwise
 * (which refuses to boot in production). Consumers see the `PaymentsProvider`
 * seam from `@taxi/shared` and never a Stripe type.
 */
export const PAYMENTS_PROVIDER = 'PAYMENTS_PROVIDER';

/**
 * The Stripe SDK handle, as its own token so `StripePaymentsProvider` can be
 * unit-tested against a fake client instead of the network — the same reasoning
 * `MAPS_PROVIDER_SOURCE` records for the maps cache.
 *
 * `null` when no `STRIPE_SECRET_KEY` is set; the provider factory is what turns
 * that into either the stub or a boot refusal.
 */
export const STRIPE_CLIENT = 'STRIPE_CLIENT';
