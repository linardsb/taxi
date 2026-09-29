'use client';

import { dispatcherPickupPinSchema, type MessageKey } from '@taxi/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { apiUrl, clearSession, loadSession } from '@/features/auth';
import { errorCodeOf } from './use-assign';

export type PinState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'shown'; pin: string }
  | { kind: 'error'; key: MessageKey };

/**
 * Dina's read of a phone caller's pickup PIN (#275, PR #277 L2).
 *
 * The PIN lives in this hook's state ONLY: never in the board frame, so never
 * in `localStorage`, and `clear()` drops it when the dialog closes.
 *
 * The fetch runs from the click handler (`reveal`), not a mount effect.
 *
 * A STALE RESPONSE NEVER WINS: Dina can close the dialog and open another
 * ride's while the first fetch is in flight. Without the `requestId` guard
 * the first ride's PIN would land under the second ride's dialog, and she
 * would read the wrong PIN to the caller.
 */
export function usePickupPin(): {
  state: PinState;
  reveal: (rideId: string) => Promise<void>;
  clear: () => void;
} {
  const router = useRouter();
  const [state, setState] = useState<PinState>({ kind: 'idle' });
  const latest = useRef(0);

  const reveal = useCallback(
    async (rideId: string) => {
      const session = loadSession();
      if (session === null) return; // the layout guard is already redirecting
      const requestId = ++latest.current;
      const settle = (next: PinState) => {
        if (requestId === latest.current) setState(next);
      };
      setState({ kind: 'loading' });
      try {
        const res = await fetch(`${apiUrl()}/rides/${rideId}/pickup-pin`, {
          headers: { authorization: `Bearer ${session.accessToken}` },
          cache: 'no-store',
        });
        if (res.status === 401 || res.status === 403) {
          clearSession();
          router.replace('/login');
          return;
        }
        if (!res.ok) {
          const code = await errorCodeOf(res);
          settle({
            kind: 'error',
            key:
              code === 'ride_not_arrived'
                ? 'console.pin_error_not_arrived'
                : 'console.pin_failed',
          });
          return;
        }
        // Parsed, never trusted — the same rule the board applies to its frame.
        const { pin } = dispatcherPickupPinSchema.parse(await res.json());
        settle({ kind: 'shown', pin });
      } catch {
        settle({ kind: 'error', key: 'console.pin_failed' });
      }
    },
    [router],
  );

  const clear = useCallback(() => {
    // Also orphans an in-flight read, so it cannot repaint a closed dialog.
    latest.current += 1;
    setState({ kind: 'idle' });
  }, []);

  return { state, reveal, clear };
}
