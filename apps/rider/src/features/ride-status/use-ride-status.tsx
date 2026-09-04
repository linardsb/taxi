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

/**
 * How long a FAILED read waits before trying again, and the ceiling it doubles
 * up to. 1 s → 30 s.
 *
 * The read is not a refresh — it is the JOIN (`RidesService.findForRider`). A
 * read that fails therefore leaves the socket connected and DEAF: `connect` has
 * already fired and will not fire again while the connection holds, so without
 * a retry the screen sits silent for the life of that socket while reporting
 * itself live. The ceiling matches `socket.ts`'s `reconnectionDelayMax`: both
 * are recovering from the same outage, and there is no reason for one to hammer
 * while the other backs off.
 */
const READ_RETRY_MS = 1_000;
const READ_RETRY_MAX_MS = 30_000;

export interface RideStatusState {
  status: RideStatus | null;
  previousStatus: RideStatus | null;
  stillSearching: boolean;
  connected: boolean;
  /**
   * Whether THIS socket is in the ride room — that is, whether a read issued
   * after the current `connect` has come back.
   *
   * `connected` cannot answer it. The join is a separate HTTP request
   * (`GET /rides/:rideId`), so a socket can be perfectly connected and hear
   * nothing because that one request failed. Keeping the two apart is what
   * stops the screen reassuring a rider it is live while no event can reach it.
   */
  joined: boolean;
}

/**
 * The live ride, over the socket, with the room hole patched (D4).
 *
 * ON EVERY `connect`, INCLUDING THE FIRST, the ride is refetched over REST —
 * and that read is what puts THIS socket in the ride room, server-side, in
 * `RidesService.findForRider`. `roomsOnConnect()` returns no ride room and
 * `joinRideRoom()` only moves the sockets that exist at the instant it runs, so
 * a socket the server has not been asked about is in no ride room and hears
 * nothing.
 *
 * THE FIRST CONNECT IS THE ONE THAT NEEDS IT MOST, which an earlier
 * `if (seenConnect)` guard here got backwards. `notifyRider`'s `joinRideRoom`
 * runs inside `POST /rides` — strictly BEFORE `booking-screen.tsx` replaces the
 * route and this hook mounts and creates a socket — so the socket that renders
 * the ride was never in its room, and the screen sat on its first frame
 * reporting itself connected. Every later connect needs it for the original
 * reason: a three-second tunnel or a backgrounded app replaces the socket, and
 * the old membership does not follow it.
 *
 * THE READ CAN FAIL, AND THEN NOTHING ELSE WOULD TRY. `connect` fires once per
 * connection, so a single failed read used to mean a socket that stayed up and
 * deaf forever. Failures are retried with backoff for as long as the connection
 * they belong to lasts, and `joined` — set only by a read issued after the
 * current `connect` — is what the screen shows the rider, because `connected`
 * is a claim about the transport and delivery is a claim about the read.
 *
 * TWO READS ON A COLD START, deliberately. The mount read is the first frame
 * and it still runs when the socket never connects at all; the connect read is
 * the join. They are different jobs, and collapsing them would trade a round
 * trip for a race between the response and the socket's handshake.
 *
 * BOTH OF THOSE READS ARE IN FLIGHT AT ONCE, so they are ordered against each
 * other by `issued`/`newestRead` and not only against events. `applied` counts
 * EVENTS; two reads with no event between them both pass an `applied` check, so
 * the later-arriving response would win even when it holds the older snapshot —
 * and the screen would fall back to «Meklējam auto…» on an accepted ride, and
 * announce it. `booking-draft.ts`'s `quoteRequestId` is the monotonic-id half
 * of this rule; `applied` is the event half. Both are needed.
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
    joined: false,
  });
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (rideId === null || session === null) return;

    const apply = (status: RideStatus, previousStatus: RideStatus | null) =>
      setState((s) => ({ ...s, status, previousStatus }));

    /**
     * How many `ride:status` events this socket has applied. A read that
     * resolves AFTER one of them is stale and is dropped: the snapshot was
     * taken before the event, and status can move BACKWARD (E8), so which of
     * the two is newer cannot be decided from the statuses themselves.
     */
    let applied = 0;
    /**
     * A monotonic READ id, which is what orders two reads against each other.
     * `applied` cannot: it counts events, and the pair that overlaps on a cold
     * start usually has no event between them.
     */
    let issued = 0;
    let newestRead = 0;
    /**
     * Which connection a read belongs to. `0` is the mount read, which happens
     * before any socket exists — it is a first frame, never a join, so it must
     * not set `joined`.
     */
    let epoch = 0;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = READ_RETRY_MS;

    const refetch = (readEpoch: number) => {
      const at = applied;
      const id = ++issued;
      void api
        .request('GET', `/rides/${rideId}`, { schema: rideSchema })
        .then((ride) => {
          if (disposed) return;
          retryDelay = READ_RETRY_MS;
          // The join only happened for a socket that was already connected when
          // the server ran it, which is exactly a read from the live epoch.
          if (readEpoch !== 0 && readEpoch === epoch) {
            setState((s) => ({ ...s, joined: true }));
          }
          if (applied !== at || id < newestRead) return;
          newestRead = id;
          apply(ride.status, null);
        })
        .catch(() => {
          // A read from a superseded connection is not retried — the `connect`
          // that superseded it has already issued its own.
          if (disposed || readEpoch !== epoch) return;
          retryTimer = setTimeout(() => refetch(readEpoch), retryDelay);
          retryDelay = Math.min(retryDelay * 2, READ_RETRY_MAX_MS);
        });
    };

    // The cold start: the REST read is also the FIRST frame, so the screen has
    // a status before any event arrives rather than an empty line — and it is
    // the only frame a rider whose socket never connects will ever get.
    refetch(epoch);

    const socket = createRiderSocket(session.accessToken, {
      onUnauthorized: () => void signOut(),
    });

    socket.on('connect', () => {
      epoch += 1;
      clearTimeout(retryTimer);
      retryDelay = READ_RETRY_MS;
      setState((s) => ({ ...s, connected: true }));
      // ON EVERY connect, the first included: this read is what joins this
      // socket to the ride room server-side, so skipping it leaves the socket
      // deaf rather than merely un-refreshed. See the docblock above.
      refetch(epoch);
    });
    socket.on('disconnect', () =>
      // `joined` goes with the connection: room membership does not follow a
      // socket the transport replaced.
      setState((s) => ({ ...s, connected: false, joined: false })),
    );
    socket.on(RT.rideStatus, (payload) => {
      const parsed = rideStatusEventSchema.safeParse(payload);
      if (!parsed.success || parsed.data.rideId !== rideId) return;
      applied += 1;
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
      disposed = true;
      clearTimeout(retryTimer);
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
