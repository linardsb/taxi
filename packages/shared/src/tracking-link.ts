import type { Language } from './enums';

/**
 * The rider-facing tracking URL, and the four constants that make the two
 * linked SMS fit ONE billed segment (#136).
 *
 * WHY HERE and not in the API that mints it: this is a cross-surface contract
 * (root CLAUDE.md). `services/api` builds the link; `apps/dispatch` routes it.
 * While the builder lived API-side neither half could test the other — apps do
 * not import the API — so the two agreed only by inspection.
 *
 * ── THE CHARACTER BUDGET (one calculation, four constants) ──
 *
 * Latvian diacritics and Cyrillic force UCS-2, so a single segment is 70
 * UTF-16 code units (TS 23.038 §6.2.3: 140 octets / 2), not 160. The rendered
 * length is strictly ADDITIVE and monotone in each term:
 *
 *   fixed text + |driver| + |plate| + |eta| + |host| + 3 + |token|
 *
 * The binding case is RU `sms.driver_assigned`, whose fixed text is the
 * longest of the six at 19 characters. Solving it for the host:
 *
 *   70 − (19 fixed + 10 name + 10 plate + 2 eta + 3 path + 16 token)
 *     = 70 − 60
 *     = 10 characters of host
 *
 * Every term above is BOUNDED, which is what makes the 1-segment property a
 * proof over all inputs rather than a sample at chosen ones:
 *
 *   driver  `SMS_DRIVER_NAME_MAX_CHARS`, enforced by `smsDriverName()`
 *   plate   `vehicleSchema.plate` is `.min(2).max(10)`
 *   eta     `SMS_ETA_MAX_DISPLAY_MINUTES`, clamped on the send path
 *   host    `TRACKING_LINK_HOST_MAX_CHARS`, refused at production boot
 *   path    `TRACKING_PATH_BY_LANGUAGE`, one character, asserted in its test
 *   token   16 base64url chars — `randomBytes(12)`, 12 ÷ 3 × 4
 *
 * The executable form of all of it is `tests/sms-budget.test.ts`. Change a
 * constant here and that test reddens on an exact length, not just a segment
 * count, so widening the budget cannot pass as fixing it.
 */

/**
 * The URL path segment that carries the rider's language, replacing the
 * `?lang=` query the SMS used to spend 8 characters on. `apps/dispatch`
 * rewrites `/r/:token` and `/e/:token` onto the real `/t/[token]` route;
 * `lv` needs no rewrite because that route already defaults to it.
 *
 * Compile-pinned to `Language` (the `TRACKING_STATE_BY_STATUS` precedent), so
 * a fourth language fails typecheck here AND fails the dispatch rewrite test.
 *
 * VALUES ARE ONE CHARACTER EACH AND THE BUDGET DEPENDS ON IT: `/ru/` instead
 * of `/r/` puts RU `driver_assigned` at 71 against a 70 limit. Do not lengthen
 * one for readability without re-deriving `TRACKING_LINK_HOST_MAX_CHARS`.
 */
export const TRACKING_PATH_BY_LANGUAGE: Record<Language, string> = {
  lv: 't',
  ru: 'r',
  en: 'e',
};

/**
 * The longest `PUBLIC_TRACKING_BASE_URL` host the SMS budget permits, refused
 * at production boot (`env.schema.ts`). `sakta.lv` is 8; `saktacab.lv` is 11
 * and does not fit.
 */
export const TRACKING_LINK_HOST_MAX_CHARS = 10;

/** Above this, `smsDriverName()` renders `<initial>.` instead of the name. */
export const SMS_DRIVER_NAME_MAX_CHARS = 10;

/** The send path clamps the DISPLAYED ETA here; the value is an estimate. */
export const SMS_ETA_MAX_DISPLAY_MINUTES = 99;

/**
 * The part of `PUBLIC_TRACKING_BASE_URL` that reaches the SMS — what
 * `TRACKING_LINK_HOST_MAX_CHARS` is a budget ON.
 *
 * Exported so the production boot gate measures exactly what `trackingLink`
 * emits rather than its own approximation of it; two regexes that must agree
 * are a way to be off by one and refuse a domain that fits.
 *
 * `baseUrl` is a validated `z.string().url()`, so it always carries a scheme
 * and may carry a trailing slash. Both strips are load-bearing;
 * `new URL(baseUrl).host` would silently drop a configured path prefix, which
 * the rider's SMS would then have to pay for unbudgeted.
 *
 * The trailing slashes come off in a LOOP, not in `.replace(/\/+$/, '')`.
 * That regex backtracks quadratically (`js/polynomial-redos`, CodeQL alert #1
 * on PR #245) whenever a slash run is followed by a non-slash, so every start
 * position consumes the run and then fails at `$`. `observed` on node 20 over
 * `'https://a' + '/'.repeat(n) + 'x'`, regex vs this loop: 10k 86.9 ms vs
 * 0.104 ms, 40k 1.39 s vs 0.010 ms, 80k 5.60 s vs 0.008 ms, 100k 8.75 s vs
 * 0.012 ms. Not reachable from rider input here — both call sites pass the
 * operator-set `PUBLIC_TRACKING_BASE_URL` — but this is a public export of
 * `@taxi/shared`, so its parameter is a library-input taint source and the
 * alert blocks the merge gate.
 *
 * The loop is output-identical, not merely equivalent on the happy path:
 * `observed`, 200,028 inputs (28 hand-picked plus a fuzz over `h t p s : / a
 * . # ? @`), zero mismatches. It is LINEAR, not uniformly faster — on 100k
 * genuine trailing slashes the regex matches on its first attempt in 0.121 ms
 * and the loop walks all of them in 2.23 ms (`observed`). Both are noise
 * against a host this budget caps at 10 characters.
 */
export function trackingLinkHost(baseUrl: string): string {
  const stripped = baseUrl.replace(/^https?:\/\//, '');
  let end = stripped.length;
  while (end > 0 && stripped.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return stripped.slice(0, end);
}

/**
 * `sakta.lv/r/<token>` — no scheme, no query.
 *
 * The scheme is 8 of 70 characters for information every SMS client infers,
 * and there is no configuration where it survives on `driver_assigned`.
 */
export function trackingLink(
  baseUrl: string,
  token: string,
  language: Language,
): string {
  const path = TRACKING_PATH_BY_LANGUAGE[language];
  return `${trackingLinkHost(baseUrl)}/${path}/${token}`;
}
