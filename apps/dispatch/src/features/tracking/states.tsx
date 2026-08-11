import {
  formatMessage,
  type Language,
  type MessageKey,
  type TrackingPageState,
} from '@taxi/shared';

/**
 * Every page state's copy comes from the shared catalog — one key per state,
 * so a new `TRACKING_PAGE_STATES` member fails the type below until it gets
 * catalog copy.
 */
const STATUS_KEY: Record<TrackingPageState, MessageKey> = {
  searching: 'page.searching',
  assigned: 'page.assigned',
  arriving: 'page.arriving',
  arrived: 'page.arrived',
  in_progress: 'page.in_progress',
  completed: 'page.completed',
  cancelled: 'page.cancelled',
  expired: 'page.expired',
};

export function statusLine(lang: Language, state: TrackingPageState): string {
  return formatMessage(lang, STATUS_KEY[state]);
}

/**
 * Terminal / error screen: one line, centred, nothing to interact with —
 * the flow ends in place (plan breadboard).
 */
export function StatusScreen({
  lang,
  message,
}: Readonly<{ lang: Language; message: string }>) {
  return (
    <main
      lang={lang}
      className="tracking"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--spacing-lg)',
        background: 'var(--color-bg)',
        color: 'var(--color-fg)',
      }}
    >
      <h1 style={{ fontSize: 'var(--font-size-lg)', textAlign: 'center' }}>
        {message}
      </h1>
    </main>
  );
}
