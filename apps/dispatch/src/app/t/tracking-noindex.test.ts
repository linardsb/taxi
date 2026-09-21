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
describe('robots.txt for the public tracking routes', () => {
  it('disallows every language shape of the tracking URL (expected)', () => {
    const { disallow } = robots().rules as { disallow: string[] };

    for (const language of LANGUAGES) {
      expect(disallow, language).toContain(
        `/${TRACKING_PATH_BY_LANGUAGE[language]}/`,
      );
    }
  });

  it('disallows nothing beyond them, and allows nothing back (edge)', () => {
    const rules = robots().rules as { disallow: string[]; allow?: unknown };

    // One entry per language and no more: a stale prefix is harmless, but a
    // list that has stopped tracking the record is the drift this file exists
    // to catch, in either direction.
    expect(rules.disallow).toHaveLength(LANGUAGES.length);
    // An `allow` would re-open what the disallow above closes — Google reads
    // the most specific rule, not the first.
    expect(rules.allow).toBeUndefined();
  });

  it('carries no prefix that is not a minted language path (failure)', () => {
    const { disallow } = robots().rules as { disallow: string[] };
    const minted = LANGUAGES.map((l) => TRACKING_PATH_BY_LANGUAGE[l]);

    for (const rule of disallow) {
      // `/x/` — the shape the SMS budget pins at one character (#136). A rule
      // that is not this shape is not covering a tracking link.
      expect(rule, rule).toMatch(/^\/[a-z]\/$/);
      expect(minted, rule).toContain(rule.slice(1, -1));
    }
  });
});
