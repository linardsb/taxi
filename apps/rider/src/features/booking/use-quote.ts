import { formatEur, rideQuotePreviewSchema } from '@taxi/shared';
import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import { ApiError, useSession } from '@/features/auth';
import { useT } from '@/features/i18n';
import type { BookingAction, BookingDraft } from './booking-draft';

/**
 * Fires `POST /rides/quote` as soon as both ends are known, and announces the
 * result — the quote arriving is the one moment on this screen where something
 * changes without the rider touching anything, so it has to be spoken.
 *
 * NEVER RETRIES. A 429 here carries `retryAfterSeconds` and is shown as copy;
 * retrying is what produced the throttle, and the cap it hit is a money control.
 *
 * The stale-response race is handled in the reducer, not here: every request
 * carries the id `quoteRequested` minted, and `quoteArrived` drops anything that
 * does not match the current one. A rider who edits the dropoff twice in quick
 * succession must not end up looking at the first corridor's price.
 */
export function useQuote(
  draft: BookingDraft,
  dispatch: (action: BookingAction) => void,
): void {
  const { api } = useSession();
  const t = useT();
  const { pickup, dropoff, quoteState } = draft;
  const shouldQuote =
    pickup !== null && dropoff !== null && quoteState === 'idle';

  useEffect(() => {
    if (!shouldQuote || pickup === null || dropoff === null) return;
    dispatch({ type: 'quoteRequested' });
    // `+ 1` because the reducer increments as it handles `quoteRequested`, and
    // this closure was built from the state before that.
    const requestId = draft.quoteRequestId + 1;

    void api
      .request('POST', '/rides/quote', {
        body: { pickup, destination: dropoff },
        schema: rideQuotePreviewSchema,
      })
      .then(({ quote }) => {
        dispatch({ type: 'quoteArrived', quote, requestId });
        AccessibilityInfo.announceForAccessibility(
          t('rider.a11y.quote_arrived', { total: formatEur(quote.totalCents) }),
        );
      })
      .catch((e: unknown) => {
        const err = e instanceof ApiError ? e : null;
        dispatch({
          type: 'quoteFailed',
          code: err?.code ?? 'generic',
          requestId,
        });
        AccessibilityInfo.announceForAccessibility(
          t('rider.a11y.quote_failed'),
        );
      });
    // NO cleanup flag here, deliberately. `shouldQuote` flips to false the
    // instant this effect dispatches `quoteRequested`, so an effect-scoped
    // `cancelled` would tear down before ANY response arrived and drop every
    // quote. The request id is the staleness guard, and it lives in the reducer
    // where it can compare against the state that actually moved on.
    //
    // `draft.quoteRequestId` is read, not depended on: including it would
    // re-fire this effect on the very increment it causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, dispatch, dropoff, pickup, shouldQuote, t]);
}
