import { trackingTokenSchema } from '@taxi/shared';
import type { NextRequest } from 'next/server';

/**
 * Same-origin polling proxy for the tracking island (#63): the browser polls
 * HERE every 5 s, this hop calls the API server-side. Keeps the page
 * origin-only (zero CORS work), hides the API base from the client, and costs
 * one extra hop — irrelevant at pilot scale (plan NOTES).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  // Shape-check before the API hop: a junk token (`/t/%2E%2E/data` decodes to
  // `..`, which encodeURIComponent leaves intact and URL-normalization folds
  // into the API root) answers 404 locally instead of costing a fetch.
  if (!trackingTokenSchema.safeParse(token).success) {
    return Response.json(
      { message: 'tracking_token_unknown' },
      { status: 404 },
    );
  }

  try {
    const res = await fetch(
      `${apiUrl}/track/${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    return new Response(await res.text(), {
      status: res.status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch {
    // API unreachable — the island renders its offline banner off any non-OK.
    return Response.json({ message: 'api_unreachable' }, { status: 502 });
  }
}
