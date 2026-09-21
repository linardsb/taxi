import { LANGUAGES, TRACKING_PATH_BY_LANGUAGE } from '@taxi/shared';
import type { MetadataRoute } from 'next';

/**
 * `/robots.txt` — the half of #247 that acts BEFORE a crawler fetches
 * anything. The `robots` metadata on `t/[token]/page.tsx` is the other half,
 * and it can only be read by a crawler that has already requested the URL with
 * the rider's token in the path; a `Disallow` stops the request itself, so the
 * token never reaches that crawler's logs.
 *
 * ONE ENTRY PER LANGUAGE, DERIVED. `TRACKING_PATH_BY_LANGUAGE` is the same
 * record the SMS link builder and the rewrites in `next.config.ts` read, so a
 * fourth language is disallowed here the moment it can be minted — the drift
 * this file would otherwise have is a public tracking shape nobody remembered
 * to add.
 *
 * SCOPED TO THE TRACKING PREFIXES, not the whole app. `/dispatch` and `/admin`
 * are behind a login and have nothing to leak to a crawler; a blanket
 * `Disallow: /` would be a larger claim than this ticket examined.
 *
 * NEITHER CONTROL IS ENFORCEMENT. Both are requests a crawler may ignore. What
 * actually bounds the damage is the token's own TTL and the service keeping it
 * out of logs and referrers.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: LANGUAGES.map((l) => `/${TRACKING_PATH_BY_LANGUAGE[l]}/`),
    },
  };
}
