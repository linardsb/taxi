import {
  RT,
  rideSchema,
  rideStatusEventSchema,
  type RideStatus,
} from '@taxi/shared';
import { useEffect, useState } from 'react';
import { useSession } from '@/features/auth';
import { createRiderSocket } from './socket';

/**
 * When the rider is told the search is still running. 60 s.
 *
 * `derived`, at HEAD: the cascade is `MAX_OFFER_ATTEMPTS = 5`
 * (`dispatch.policy.ts:35`) × `offerTimeoutSeconds`, whose configured default is
 * 20 s (`platform-config.ts:40`) — so a ride can sit in `requested` for up to
 * 5 × 20 = **100 s** before every driver has been asked. 60 s is three whole
 * offer windows (3 × 20), so by the time this fires at least three drivers have
 * already been asked and passed or timed out.
 *
 * Deliberately BELOW the 100 s worst case rather than above it. The plan's
 * first reading was to clear the whole cascade so the message could not fire
 * "while a driver is deciding" — but this message does not claim failure, and
 * 100 s of silence is the worse outcome for a rider with no visual spinner to
 * watch. What must never appear is "no drivers found": `dispatch:unclaimed`
 * goes to Dina's board, not to the ride room, and the app has no basis for it.
 */
export const STILL_SEARCHING_MS = 60_000;

export interface RideStatusState {
  status: RideStatus | null;
  previousStatus: RideStatus | null;
  stillSearching: boolean;
  connected: boolean;
}

/**
 * The live ride, over the socket, with the reconnect hole patched (D4).
 *
 * ON EVERY `connect` AFTER THE FIRST, the ride is refetched over REST.
 * `roomsOnConnect()` returns no ride room and `joinRideRoom()` only moved the
 * sockets that existed when it ran, so a socket that just reconnected is NOT in
 * the ride room — without the refetch the rider is deaf from the first blip
 * onward, and the "you have been matched" criterion would be true only for
 * someone whose network never drops.
 *
 * STATUS CAN MOVE BACKWARD (E8). #19's dispatcher release emits
 * `accepted → requested`. Nothing here ratchets: the newest event wins, whatever
 * direction it points.
 */
export function useRideStatus(rideId: string | null): RideStatusState {
  const { api, onBeforeSignOut, signOut, state: sessionState } = useSession();
  // Narrowed here so the effect depends on the token it uses rather than on the
  // whole context object, which changes identity on every state transition.
  const session =
    sessionState.status === 'signedIn' ? sessionState.session : null;
  const [state, setState] = useState<Omit<RideStatusState, 'stillSearching'>>({
    status: null,
    previousStatus: null,
    connected: false,
  });
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (rideId === null || session === null) return;

    const apply = (status: RideStatus, previousStatus: RideStatus | null) =>
      setState((s) => ({ ...s, status, previousStatus }));

    // The cold start: the REST read is also the FIRST frame, so the screen has
    // a status before any event arrives rather than an empty line.
    const refetch = () => {
      void api
        .request('GET', `/rides/${rideId}`, { schema: rideSchema })
        .then((ride) => apply(ride.status, null))
        .catch(() => undefined);
    };
    refetch();

    const socket = createRiderSocket(session.accessToken, {
      onUnauthorized: () => void signOut(),
    });
    let seenConnect = false;

    socket.on('connect', () => {
      setState((s) => ({ ...s, connected: true }));
      // Not on the first: `refetch()` above already ran, and a second read on
      // the opening connect would spend a round trip to learn what it knows.
      if (seenConnect) refetch();
      seenConnect = true;
    });
    socket.on('disconnect', () =>
      setState((s) => ({ ...s, connected: false })),
    );
    socket.on(RT.rideStatus, (payload) => {
      const parsed = rideStatusEventSchema.safeParse(payload);
      if (!parsed.success || parsed.data.rideId !== rideId) return;
      apply(parsed.data.status, parsed.data.previousStatus);
    });
    socket.connect();

    // Disconnect while the token is still valid — the same contract the
    // driver's presence layer registers for.
    const unhook = onBeforeSignOut(() => {
      socket.disconnect();
      return Promise.resolve();
    });

    return () => {
      unhook();
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [api, onBeforeSignOut, rideId, session, signOut]);

  // Elapsed time, not a dispatch event: the app has no `dispatch:unclaimed`, so
  // "still looking" is derived from how long `requested` has lasted.
  //
  // The reset lives in the CLEANUP rather than the effect body — partly because
  // `react-hooks/set-state-in-effect` forbids the body, and partly because the
  // cleanup is where it belongs: leaving `requested` is what makes the flag
  // stale, and status CAN move backward (E8), so a ride released back to
  // `requested` has to start its minute over rather than inherit the old one.
  const searching = state.status === 'requested';
  useEffect(() => {
    if (!searching) return;
    const timer = setTimeout(() => setElapsed(true), STILL_SEARCHING_MS);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [searching]);

  return { ...state, stillSearching: searching && elapsed };
}
