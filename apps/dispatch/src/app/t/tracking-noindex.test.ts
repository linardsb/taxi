import { LANGUAGES, TRACKING_PATH_BY_LANGUAGE } from '@taxi/shared';
import { describe, expect, it } from 'vitest';
import robots from '../robots';

/**
 * THE CRAWLER-FACING HALF of #247. The tracking URL needs no login and its
 * token IS the authorization, so every public shape of it has to be disallowed
 * before a crawler requests it.
 *
 * WHY HERE and not beside `app/robots.ts`: the subject is the tracking routes,
 * which live in this directory — the same reason `tracking-rewrites.test.ts`
 * tests `next.config.ts` from here rather than from the app root.
 *
 * The page's own `robots` metadata is asserted in
 * `features/tracking/tracking-page.test.tsx`, where every other
 * `generateMetadata` assertion already lives.
 *
 * WHAT IS NOT COVERED: that Next serves this function at `/robots.txt`, and
 * that any crawler honours it. Library behaviour and third-party behaviour
 * respectively; a green run here is not evidence of either.
 */
type ObjectRules = { userAgent: string; disallow: string[]; allow?: unknown };

/**
 * `MetadataRoute.Robots['rules']` is legally `Rule | Rule[]`. Assert the
 * OBJECT form this route actually returns before narrowing to it, so a later
 * switch to the array form fails loudly here instead of reading `undefined`
 * off every property and passing. Same shape as `tracking-rewrites.test.ts`'s
 * `rewrites()`, for the same reason.
 */
function rules(): ObjectRules {
  const result = robots().rules;

  expect(Array.isArray(result)).toBe(false);
  return result as ObjectRules;
}

describe('robots.txt for the public tracking routes', () => {
  it('disallows every language shape of the tracking URL (expected)', () => {
    const { userAgent, disallow } = rules();

    // EVERY crawler, not one. Without this the file still passes with
    // `userAgent: 'Googlebot'`, while every other crawler is left unrestricted
    // — the exact property this file's header claims to hold.
    expect(userAgent).toBe('*');

    for (const language of LANGUAGES) {
      expect(disallow, language).toContain(
        `/${TRACKING_PATH_BY_LANGUAGE[language]}/`,
      );
    }
  });

  it('disallows nothing beyond them, and allows nothing back (edge)', () => {
    const { disallow, allow } = rules();

    // One entry per language and no more: a stale prefix is harmless, but a
    // list that has stopped tracking the record is the drift this file exists
    // to catch, in either direction.
    expect(disallow).toHaveLength(LANGUAGES.length);
    // An `allow` would re-open what the disallow above closes — Google reads
    // the most specific rule, not the first.
    expect(allow).toBeUndefined();
  });

  it('carries no prefix that is not a minted language path (failure)', () => {
    const { disallow } = rules();
    const minted = LANGUAGES.map((l) => TRACKING_PATH_BY_LANGUAGE[l]);

    for (const rule of disallow) {
      // The `/…/` WRAPPING is this file's business: a bare prefix would not
      // scope the rule to a path segment. That the prefix inside it is one
      // character is asserted where the constant lives
      // (`packages/shared/tests/tracking-link.test.ts`) — the same split
      // `tracking-rewrites.test.ts` records 40 lines away.
      expect(rule, rule).toMatch(/^\/.+\/$/);
      expect(minted, rule).toContain(rule.slice(1, -1));
    }
  });
});
