import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * The SMS link shapes (#136). `TRACKING_PATH_BY_LANGUAGE` in `@taxi/shared`
   * is the source of truth for which character means which language, and
   * `src/app/t/tracking-rewrites.test.ts` matches a real minted link against
   * this table so the API's output and this app's routing cannot drift.
   *
   * REWRITES, NOT REDIRECTS: the rider keeps the short URL they were texted
   * and no round trip is spent on a 30x. `lv` needs no entry because
   * `/t/[token]` is a real route that already defaults to it (`page.tsx`'s
   * `langFrom`), which is also why `t` is the `lv` value in that record.
   *
   * The language travels in the path because `?lang=ru` cost 8 characters of
   * a 70-character UCS-2 segment, and the Russian `driver_assigned` template
   * has zero spare at the host ceiling.
   */
  async rewrites() {
    return [
      { source: '/r/:token', destination: '/t/:token?lang=ru' },
      { source: '/e/:token', destination: '/t/:token?lang=en' },
    ];
  },
};

export default nextConfig;
