import {
  formatMessage,
  LANGUAGES,
  trackingViewSchema,
  type Language,
  type TrackingView,
} from '@taxi/shared';
import type { Metadata } from 'next';
import { TrackingLive } from '@/features/tracking/tracking-map';
import { StatusScreen } from '@/features/tracking/states';

/**
 * The no-login live-tracking page (#63) — deliberately boring: server-rendered
 * status, one client island (map + 5 s poll), one interactive element (call
 * dispatch). One page serves phone-booked riders, share-trip (#17) and blind
 * riders' sighted assistants.
 *
 * Friction audit (plan UX section): intent→done = 1 tap (open the SMS link);
 * zero decisions on the page itself.
 */

type Params = Promise<{ token: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** `?lang` values are `string | string[] | undefined` — normalize, default lv. */
function langFrom(searchParams: Awaited<SearchParams>): Language {
  const raw = Array.isArray(searchParams.lang)
    ? searchParams.lang[0]
    : searchParams.lang;
  return LANGUAGES.find((l) => l === raw) ?? 'lv';
}

const API_URL = () => process.env.API_URL ?? 'http://localhost:3001';

export async function generateMetadata({
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  return { title: formatMessage(langFrom(await searchParams), 'page.title') };
}

export default async function TrackingPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { token } = await params;
  const lang = langFrom(await searchParams);

  let view: TrackingView | null = null;
  let failure: 'not_found' | 'expired' | 'api_down' | null = null;
  try {
    const res = await fetch(
      `${API_URL()}/track/${encodeURIComponent(token)}`,
      { cache: 'no-store' }, // per-request freshness — this page is live data
    );
    if (res.status === 404) failure = 'not_found';
    else if (res.status === 410) failure = 'expired';
    else if (!res.ok) failure = 'api_down';
    else view = trackingViewSchema.parse(await res.json());
  } catch {
    failure = 'api_down';
  }

  if (failure === 'not_found' || failure === 'expired') {
    return (
      <StatusScreen
        lang={lang}
        message={formatMessage(
          lang,
          failure === 'expired' ? 'page.expired' : 'page.not_found',
        )}
      />
    );
  }
  if (failure !== null || view === null) {
    // API down: the page cannot know anything — one line and a retry link
    // (a full reload IS the retry; there is no client state to preserve).
    return (
      <main
        lang={lang}
        className="tracking"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--spacing-md)',
          padding: 'var(--spacing-lg)',
          background: 'var(--color-bg)',
          color: 'var(--color-fg)',
        }}
      >
        <h1 style={{ fontSize: 'var(--font-size-lg)', textAlign: 'center' }}>
          {formatMessage(lang, 'page.connection_lost', { time: '—' })}
        </h1>
        <a
          href=""
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 44,
            padding: 'var(--spacing-sm) var(--spacing-lg)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            textDecoration: 'none',
            fontSize: 'var(--font-size-md)',
          }}
        >
          ↻
        </a>
      </main>
    );
  }

  return (
    <main
      lang={lang}
      className="tracking"
      style={{
        maxWidth: 480,
        margin: '0 auto',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-lg)',
        padding: 'var(--spacing-lg)',
        background: 'var(--color-bg)',
        color: 'var(--color-fg)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--spacing-md)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>
          {formatMessage(lang, 'page.title')}
        </h1>
        <nav style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          {LANGUAGES.filter((l) => l !== lang).map((l) => (
            <a
              key={l}
              href={`/t/${token}?lang=${l}`}
              lang={l}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 44,
                minHeight: 44,
                color: 'var(--color-fg-muted)',
                fontSize: 'var(--font-size-sm)',
                textTransform: 'uppercase',
              }}
            >
              {l}
            </a>
          ))}
        </nav>
      </header>

      <TrackingLive token={token} lang={lang} initial={view} />

      <a
        href={`tel:${view.dispatchPhone}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 48, // ≥44 px hard rule, with margin
          padding: 'var(--spacing-sm) var(--spacing-lg)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-accent)',
          color: 'var(--color-accent-fg)',
          textDecoration: 'none',
          fontSize: 'var(--font-size-md)',
          fontWeight: 600,
        }}
      >
        {formatMessage(lang, 'page.call_dispatch')}
      </a>
    </main>
  );
}
