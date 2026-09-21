import { SMS_DRIVER_NAME_MAX_CHARS } from '@taxi/shared';

/**
 * Pure helpers between the catalog (`formatMessage`, @taxi/shared) and the
 * send path. No Nest, no I/O — `sms-templates.spec.ts` exercises these
 * directly.
 *
 * `trackingLink()` used to live here; #136 moved it to `@taxi/shared` because
 * the dispatch app has to ROUTE the link the API mints, and while the builder
 * sat API-side neither half could test the other.
 */

/**
 * First word only ("Jānis", never "Jānis Bērziņš") — the SMS and the page
 * identify the driver, they do not dox them. `—` when onboarding (#20) has
 * not set a name yet.
 *
 * DELIBERATELY UNBOUNDED, and left that way: the tracking page renders this
 * and has no character budget. `smsDriverName` is the bounded sibling.
 */
export function driverFirstName(displayName: string | null): string {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? first : '—';
}

/**
 * The SMS-safe driver name: the first name when it fits, `<initial>.` when it
 * does not. One of the four bounds that make #136's 1-segment property a
 * proof over all inputs rather than a sample — `users.display_name` is `text`
 * and `userSchema.displayName` allows 120 characters, so without this a
 * budgeted test proves nothing about a real rider's message.
 *
 * ABBREVIATION, NOT TRUNCATION. `Konstantīn` is a mangled name and reads as a
 * bug; `K.` is a form people already use, and the rider identifies the car by
 * plate anyway. It fires only above `SMS_DRIVER_NAME_MAX_CHARS`.
 */
export function smsDriverName(displayName: string | null): string {
  const first = driverFirstName(displayName);
  if (first.length <= SMS_DRIVER_NAME_MAX_CHARS) return first;
  // `[...first][0]`, not `first[0]` — slicing a surrogate pair leaves a lone
  // surrogate, which is a broken glyph on the handset for the same 1 code
  // unit a whole character would have cost.
  return `${[...first][0] ?? ''}.`;
}
