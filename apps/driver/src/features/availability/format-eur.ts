/**
 * `formatEur` moved to `@taxi/shared` in #15: the api's offer push carries
 * the same money string as the card, and two «€ + truncation» implementations
 * would drift on the first brand-copy change.
 *
 * What the re-export is actually for, stated honestly (F14): it is THIS
 * slice's import (`earnings-body.ts`), plus the anchor for
 * `format-eur.test.ts`, which pins the behaviour from the driver's side.
 * Other slices take `formatEur` straight from `@taxi/shared` and always have —
 * `offers/offer-card-props.ts`, `active-ride/receipt.tsx` and
 * `active-ride/active-ride-screen.tsx` all do, so the older claim that every
 * consumer routes through here was never true.
 */
export { formatEur } from '@taxi/shared';
