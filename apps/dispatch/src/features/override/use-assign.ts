'use client';

import {
  apiErrorBodySchema,
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

/**
 * The api answers errors as `{ message: 'ride_not_assignable', ... }` — read
 * with the shared envelope, the same schema the api types its producers with.
 * A hand-rolled twin here degraded Dina's override errors to the generic key
 * mid-shift if the envelope ever moved, instead of failing loudly (review
 * F26/F45).
 */
async function errorCodeOf(res: Response): Promise<string | undefined> {
  try {
    const parsed = apiErrorBodySchema.safeParse(await res.json());
    if (parsed.success) return parsed.data.message;
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

  /**
   * `fallback` is the CALLER's generic message, and it is threaded this far in
   * on purpose. The screen renders `errorKey` — this hook's state — and discards
   * the returned `Outcome`, so rewriting the outcome afterwards changes nothing
   * Dina sees (#120 review H2). The state write is the only one that counts, so
   * the verb has to be known where it happens.
   */
  const post = useCallback(
    async (
      path: string,
      body: unknown,
      fallback: MessageKey = 'console.assign_failed',
    ): Promise<Outcome> => {
      const fail = (key: MessageKey = fallback): Outcome => ({
        ok: false,
        key,
      });
      const session = loadSession();
      if (session === null) return fail();
      if (inFlight.current) return fail();

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
          return fail();
        }
        if (!res.ok) {
          const key = assignErrorKey(await errorCodeOf(res), fallback);
          setErrorKey(key);
          return fail(key);
        }
        return { ok: true };
      } catch {
        setErrorKey(fallback);
        return fail();
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
      post(`/rides/${rideId}/cancel`, { reason }, 'console.cancel_failed'),
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
