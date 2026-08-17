'use client';

import {
  dispatchRosterSchema,
  type DispatchDriver,
  type MessageKey,
} from '@taxi/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { apiUrl, clearSession, loadSession } from '@/features/auth';
import { assignErrorKey } from './assign-state';

/**
 * The three writes Dina can make from the board, plus the roster read they
 * need. Effects live here; every decision they make lives in `assign-state`.
 *
 * The roster is fetched when the dialog OPENS, not on mount and never on the
 * board's cadence — see `dispatchRosterSchema`'s docblock for why it is not a
 * frame field.
 */

type Outcome = { ok: true } | { ok: false; key: MessageKey };

/** The api answers errors as `{ message: 'ride_not_assignable', ... }`. */
async function errorCodeOf(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const { message } = body as { message: unknown };
      return typeof message === 'string' ? message : undefined;
    }
  } catch {
    /* a body-less error is ordinary; the generic key covers it */
  }
  return undefined;
}

export function useAssign(): {
  roster: DispatchDriver[];
  loadingRoster: boolean;
  submitting: boolean;
  errorKey: MessageKey | null;
  loadRoster: () => Promise<void>;
  assign: (rideId: string, driverId: string, reason: string | null) => Promise<Outcome>;
  reassign: (rideId: string, driverId: string, reason: string | null) => Promise<Outcome>;
  cancel: (rideId: string, reason: string | null) => Promise<Outcome>;
  reset: () => void;
} {
  const router = useRouter();
  const [roster, setRoster] = useState<DispatchDriver[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  // A second submit while the first is in flight would post the same override
  // twice; the api has no idempotency key on this path, so the guard is here.
  const inFlight = useRef(false);

  /**
   * A 401/403 means the token died under us. Identical handling to
   * `use-board.ts:fetchSnapshot` — drop the session (which also drops the
   * board's PII cache) and bounce to /login rather than showing an error the
   * dispatcher cannot act on.
   */
  const handleAuthFailure = useCallback(() => {
    clearSession();
    router.replace('/login');
  }, [router]);

  const loadRoster = useCallback(async () => {
    const session = loadSession();
    if (session === null) return; // the layout guard is already redirecting
    setLoadingRoster(true);
    try {
      const res = await fetch(`${apiUrl()}/dispatch/drivers`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403) {
        handleAuthFailure();
        return;
      }
      if (!res.ok) {
        setErrorKey('console.assign_failed');
        return;
      }
      // Parsed, never trusted — the same rule the board applies to its frame.
      setRoster(dispatchRosterSchema.parse(await res.json()).drivers);
    } catch {
      setErrorKey('console.assign_failed');
    } finally {
      setLoadingRoster(false);
    }
  }, [handleAuthFailure]);

  const post = useCallback(
    async (path: string, body: unknown): Promise<Outcome> => {
      const session = loadSession();
      if (session === null) return { ok: false, key: 'console.assign_failed' };
      if (inFlight.current) return { ok: false, key: 'console.assign_failed' };

      inFlight.current = true;
      setSubmitting(true);
      setErrorKey(null);
      try {
        const res = await fetch(`${apiUrl()}${path}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (res.status === 401 || res.status === 403) {
          handleAuthFailure();
          return { ok: false, key: 'console.assign_failed' };
        }
        if (!res.ok) {
          const key = assignErrorKey(await errorCodeOf(res));
          setErrorKey(key);
          return { ok: false, key };
        }
        return { ok: true };
      } catch {
        setErrorKey('console.assign_failed');
        return { ok: false, key: 'console.assign_failed' };
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    [handleAuthFailure],
  );

  const assign = useCallback(
    (rideId: string, driverId: string, reason: string | null) =>
      post(`/dispatch/rides/${rideId}/assign`, { driverId, reason }),
    [post],
  );

  const reassign = useCallback(
    (rideId: string, driverId: string, reason: string | null) =>
      post(`/dispatch/rides/${rideId}/reassign`, { driverId, reason }),
    [post],
  );

  const cancel = useCallback(
    (rideId: string, reason: string | null) =>
      // The lifecycle route, not a dispatch one: `POST /rides/:id/cancel`
      // already accepts `dispatcher`/`admin`, so cancelling is UI-only work.
      post(`/rides/${rideId}/cancel`, { reason }).then((outcome) =>
        outcome.ok ? outcome : { ok: false as const, key: 'console.cancel_failed' as MessageKey },
      ),
    [post],
  );

  const reset = useCallback(() => setErrorKey(null), []);

  return {
    roster,
    loadingRoster,
    submitting,
    errorKey,
    loadRoster,
    assign,
    reassign,
    cancel,
    reset,
  };
}
