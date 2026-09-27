import type { MessageKey, RideStatus } from '@taxi/shared';
import { useCallback, useRef, useState } from 'react';
import { ApiError, useSession } from '@/features/auth';
import { errorMessageKey } from '@/features/i18n';

/**
 * What the last request came to, tagged with the status it was sent at, so
 * the screen can drop it the moment the ride moves on — derived in render,
 * no effect, no reset. `'sent'` means SENT, never delivered: the driver's
 * voice is the acknowledgement.
 */
export interface AnnounceResult {
  forStatus: RideStatus | null;
  value: 'sent' | MessageKey;
}

export interface AnnounceRequest {
  send(status: RideStatus | null): Promise<void>;
  busy: boolean;
  result: AnnounceResult | null;
}

/**
 * `POST /rides/:rideId/announce-request` (#259): ask the driver to get out
 * and call «Sakta».
 *
 * `send` CLEARS THE RESULT FIRST (PR #282 review H3). `Banner` speaks from an
 * effect keyed on its text, so a second success — or a second 429 — would
 * store the same text, change nothing and say nothing. For this rider the
 * spoken confirmation is the only feedback, so the Banner unmounts for the
 * round trip and the settled result mounts a new one, which speaks.
 *
 * A press while one is in flight is ignored.
 */
export function useAnnounceRequest(rideId: string | null): AnnounceRequest {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnnounceResult | null>(null);
  const inFlight = useRef(false);

  const send = useCallback(
    async (status: RideStatus | null) => {
      if (rideId === null || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setResult(null);
      try {
        await api.request('POST', `/rides/${rideId}/announce-request`);
        setResult({ forStatus: status, value: 'sent' });
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        setResult({
          forStatus: status,
          value: errorMessageKey(err?.code ?? 'generic'),
        });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [api, rideId],
  );

  return { send, busy, result };
}
