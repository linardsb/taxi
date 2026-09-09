/**
 * `formatEur` moved to `@taxi/shared` in #15: the api's offer push carries
 * the same money string as the card, and two «€ + truncation» implementations
 * would drift on the first brand-copy change. Re-exported so every consumer
 * keeps importing through `@/features/availability`, and `format-eur.test.ts`
 * keeps pinning the behaviour from this side.
 */
export { formatEur } from '@taxi/shared';
