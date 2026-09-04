import {
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  type MessageKey,
} from '@taxi/shared';
import { useCallback, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { ApiError, useSession } from '@/features/auth';
import { errorMessageKey, useT } from '@/features/i18n';
import type { BookingDraft } from './booking-draft';

/**
 * How long to wait before retrying a 409. The first request is still running —
 * it is spending a route call and writing two tables — so this is short enough
 * to feel like the same tap and long enough to let an ordinary one finish.
 * `expected`, not measured.
 */
const RETRY_DELAY_MS = 800;

/** One automatic retry. Beyond that the rider is told, and taps again if they
 *  want to: a silent retry loop against a booking route is how you dispatch
 *  cars nobody asked for. */
const MAX_RETRIES = 1;

export interface BookRide {
  book(): Promise<string | null>;
  busy: boolean;
  error: MessageKey | null;
}

/**
 * `POST /rides`, with the idempotency rule the whole feature rests on.
 *
 * THE KEY COMES FROM THE DRAFT AND IS NEVER MINTED HERE. The draft rotates it
 * when the corridor changes and only then, so every retry of one attempt —
 * including the 409 retry below — carries the key the first try used.
 *
 * A 409 `idempotent_request_in_progress` means the FIRST request is still in
 * flight. Retrying with the SAME key resolves to the ride it created. Minting a
 * new one would book a second car, which is precisely the failure
 * `RIDE_IDEMPOTENCY_PENDING` exists to prevent.
 */
export function useBookRide(draft: BookingDraft): BookRide {
  const { api } = useSession();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const book = useCallback(async (): Promise<string | null> => {
    if (draft.pickup === null || draft.dropoff === null) return null;
    setBusy(true);
    setError(null);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const { ride } = await api.request('POST', '/rides', {
            body: {
              pickup: draft.pickup,
              destination: draft.dropoff,
              paymentMethod: draft.paymentMethod,
            },
            headers: { [IDEMPOTENCY_KEY_HEADER]: draft.idempotencyKey },
            schema: rideCreatedSchema,
          });
          AccessibilityInfo.announceForAccessibility(
            t('rider.a11y.ride_requested'),
          );
          return ride.id;
        } catch (e) {
          const err = e instanceof ApiError ? e : null;
          if (err?.status !== 409 || attempt >= MAX_RETRIES) {
            setError(errorMessageKey(err?.code ?? 'generic'));
            return null;
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    } finally {
      setBusy(false);
    }
  }, [api, draft, t]);

  return { book, busy, error };
}
