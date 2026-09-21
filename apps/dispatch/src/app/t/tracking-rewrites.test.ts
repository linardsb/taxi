import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES, TRACKING_PATH_BY_LANGUAGE, trackingLink } from '@taxi/shared';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';

/**
 * THE api↔dispatch ROUND TRIP (#136). The API mints a link; this app has to
 * route it. Before `trackingLink` moved into `@taxi/shared` these were two
 * halves nobody compared — an app cannot import `services/api` — so the only
 * thing pinning them together was inspection.
 *
 * WHAT IS STILL NOT COVERED: Next's own `:param` matching and the running
 * server. That is library behaviour and a manual step (Level 4.3), not this
 * file. Do not read a green run here as coverage of the runtime.
 */

const HOST = 'sakta.lv';
const TOKEN = 't'.repeat(16);

type Rewrite = { source: string; destination: string };

async function rewrites(): Promise<Rewrite[]> {
  const result = await nextConfig.rewrites?.();
  // `rewrites()` may legally return `{ beforeFiles, afterFiles, fallback }`.
  // Assert the ARRAY form the config actually returns, so a later switch to
  // the object form fails loudly here instead of silently matching nothing.
  expect(Array.isArray(result)).toBe(true);
  return result as Rewrite[];
}

/** `/r/:token` → a regex matching one path segment in the param's place. */
const sourceMatcher = (source: string) =>
  new RegExp(`^${source.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);

describe('the SMS link shapes the tracking rewrites serve', () => {
  it('routes every non-lv language through exactly one rewrite (expected)', async () => {
    const table = await rewrites();

    for (const language of LANGUAGES.filter((l) => l !== 'lv')) {
      const path = trackingLink(`https://${HOST}`, TOKEN, language).slice(
        HOST.length,
      );
      const matching = table.filter((r) => sourceMatcher(r.source).test(path));

      expect(matching, `${language} → ${path}`).toHaveLength(1);
      expect(matching[0]!.destination).toContain(`lang=${language}`);
      expect(matching[0]!.destination).toContain('/t/:token');
    }
  });

  it('serves the lv link from the real route, with no rewrite (expected)', async () => {
    const table = await rewrites();
    const path = trackingLink(`https://${HOST}`, TOKEN, 'lv').slice(
      HOST.length,
    );

    expect(table.filter((r) => sourceMatcher(r.source).test(path))).toEqual([]);
    // What makes the absence of a rewrite correct rather than an omission: a
    // real route directory named by the lv path itself.
    //
    // The path is BUILT from `TRACKING_PATH_BY_LANGUAGE.lv`, not hardcoded.
    // This was `join(__dirname, '[token]', 'page.tsx')`, and `__dirname` is
    // already `…/app/t` — so `t` appeared on both sides and the check could
    // not fail (PR #245 F7). Going up one level and back down through the
    // constant is what makes changing `lv` redden this file.
    const lvRoute = join(
      __dirname,
      '..',
      TRACKING_PATH_BY_LANGUAGE.lv,
      '[token]',
      'page.tsx',
    );
    expect(existsSync(lvRoute), lvRoute).toBe(true);
  });

  it('carries no rewrite for a language the enum does not list (failure)', async () => {
    const table = await rewrites();
    const served = table.map((r) => {
      const lang = /lang=([a-z]+)/.exec(r.destination)?.[1];
      return lang;
    });

    for (const lang of served) {
      expect(LANGUAGES).toContain(lang);
    }
    // One entry per non-lv language, no more: a stale rewrite for a dropped
    // language would still match and quietly serve the wrong copy.
    expect(table).toHaveLength(LANGUAGES.length - 1);
  });

  it('keeps every source one character wide in the language slot (failure)', async () => {
    const table = await rewrites();

    for (const { source } of table) {
      // `/x/:token` — the budget's path term is exactly 3 characters.
      // Only the REWRITE SOURCES are this file's business; that every value in
      // `TRACKING_PATH_BY_LANGUAGE` is one character is asserted where the
      // constant lives (`packages/shared/tests/tracking-link.test.ts`), and
      // was re-asserted here for no added coverage.
      expect(source, source).toMatch(/^\/[a-z]\/:token$/);
    }
  });
});
