import type {
  DriverQueueEvent,
  MessageKey,
  PaymentMethodType,
  RideOffer,
} from '@taxi/shared';

/**
 * The card the driver is looking at. `paymentMethod` rides beside the offer
 * because the wire carries it and the offer row does not; `durationMs` is
 * `expiresAt − sentAt` — server-relative, so a phone clock minutes off still
 * counts down the right 20 s (config `offerTimeoutSeconds`), anchored at
 * local receipt. The residual error is one network latency.
 */
export interface PendingOffer {
  offer: RideOffer;
  paymentMethod: PaymentMethodType;
  receivedAtMs: number;
  durationMs: number;
  /**
   * How this card reached the phone. Only `'push'` can be genuinely late, and
   * only `'push'` is checked for it — see {@link deadOnArrival}.
   */
  source: 'socket' | 'push';
}

export type OfferPhase = 'idle' | 'pending' | 'accepting' | 'declining';
export type OfferBanner = 'taken' | 'expired' | 'cancelled' | 'error';

export interface OfferState {
  phase: OfferPhase;
  pending: PendingOffer | null;
  remainingMs: number;
  banner: OfferBanner | null;
  /** The api's snake code behind an `error` banner, for `errorMessageKey`. */
  errorCode: string | null;
  /** Newest OS speed, m/s — the glance-mode gate. null = unknown. */
  speedMps: number | null;
  /** The last `driver:queue` heard; shown on home and beside the card. */
  queue: DriverQueueEvent | null;
  /**
   * Ids of cards cleared through `cleared` — every path through it: accepted,
   * declined, expired, refused by the api (the 409 «taken» / error banner) or
   * revoked — newest first, capped at {@link ANSWERED_MEMORY}. `pending` alone
   * cannot dedupe: the api emits the socket event and the push together, so an
   * offer answered before Expo delivers its push would otherwise be re-shown
   * as a brand-new card over the active ride.
   *
   * A card REPLACED by a second live offer is deliberately not recorded here:
   * `dispatch.service.ts` (`findDriverIdsWithLiveOffers`) keeps one live card
   * per driver, so that branch has no reachable case to remember.
   *
   * A set rather than one id, because one id remembers only the last card:
   * declining A, being offered B and answering B would forget A, and A's slow
   * push then resurrects it inside the window `deadOnArrival` still tolerates.
   *
   * A re-offer of the same RIDE after a genuine expiry carries a new offer row
   * id, so it is never blocked by this.
   */
  answeredOfferIds: string[];
}

/**
 * How many answered cards to remember. `deadOnArrival` already drops anything
 * more than one full offer window past its deadline, and the server keeps one
 * live card per driver, so a handful covers every push that can still arrive.
 */
const ANSWERED_MEMORY = 8;

export const initialOffers: OfferState = {
  phase: 'idle',
  pending: null,
  remainingMs: 0,
  banner: null,
  errorCode: null,
  speedMps: null,
  queue: null,
  answeredOfferIds: [],
};

export type OfferEvent =
  | { type: 'offer_received'; pending: PendingOffer }
  | { type: 'tick'; nowMs: number }
  | { type: 'accept_pressed' }
  | { type: 'accepted'; rideId: string }
  | { type: 'decline_pressed' }
  | { type: 'declined' }
  | { type: 'rejected'; code: string }
  | {
      type: 'revoked';
      offerId: string;
      reason: 'expired' | 'taken' | 'cancelled';
    }
  | { type: 'queue'; event: DriverQueueEvent }
  | { type: 'speed'; mps: number | null }
  | { type: 'banner_dismissed' };

export type OfferEffect =
  | { type: 'post_accept'; offerId: string }
  | { type: 'post_decline'; offerId: string }
  | { type: 'open_ride'; rideId: string; paymentMethod: PaymentMethodType }
  | { type: 'route_offer' }
  | { type: 'route_home' }
  | { type: 'alert_start' }
  | { type: 'alert_stop' }
  | { type: 'announce'; key: MessageKey };

export interface OfferDecision {
  state: OfferState;
  effects: OfferEffect[];
}

const noop = (state: OfferState): OfferDecision => ({ state, effects: [] });

/** `remainingMs` for `pending` at `nowMs` — never negative. */
export function remainingFor(pending: PendingOffer, nowMs: number): number {
  return Math.max(0, pending.durationMs - (nowMs - pending.receivedAtMs));
}

/**
 * Already dead on arrival? A late push is the only way an expired offer
 * reaches the phone — the socket path is live by construction — so this is
 * asked of PUSHES ONLY. It compares the wire's absolute `expiresAt` against
 * the phone clock, and that is the whole reason for the restriction: the
 * countdown is deliberately server-relative to survive clock skew, and this
 * is the one check that is not.
 *
 * Two tolerances, because they are not the same number and the old docstring
 * gave one of them for both. Measured as LATENESS past the deadline it
 * tolerates one whole window (`durationMs`). Measured as CLOCK SKEW on a
 * fresh offer it tolerates two: the phone reads `receivedAtMs ≈ sentAt + skew`
 * while `expiresAtMs = sentAt + W` arrives unskewed, so the drop condition
 * reduces to `skew − W > W`, i.e. `skew > 2W` — 40 s at the default
 * `offerTimeoutSeconds: 20`. Applying it to the socket path meant a phone
 * 40 s fast silently dropped EVERY offer: no card, no banner, no log, and a
 * driver who reads as online on the dispatch board and never gets work.
 *
 * Anything inside the tolerance renders and is corrected by the server's 409
 * (`taken`) on accept — recoverable, never a crash (AC3).
 */
function deadOnArrival(pending: PendingOffer): boolean {
  if (pending.source !== 'push') return false;
  const expiresAtMs = pending.offer.expiresAt.getTime();
  return pending.receivedAtMs - expiresAtMs > pending.durationMs;
}

const cleared = (
  state: OfferState,
  banner: OfferBanner | null,
  errorCode: string | null = null,
): OfferState => ({
  ...state,
  phase: 'idle',
  pending: null,
  remainingMs: 0,
  banner,
  errorCode,
  // Every clearing path runs through here, so this is the one place that has
  // to remember the id. A `cleared` with no card on screen adds nothing and
  // forgets nothing.
  answeredOfferIds: state.pending
    ? [state.pending.offer.id, ...state.answeredOfferIds].slice(
        0,
        ANSWERED_MEMORY,
      )
    : state.answeredOfferIds,
});

/**
 * The offer card's whole policy as a pure reducer: one card at a time,
 * server-relative countdown, no accept after zero, no decline on expiry (the
 * sweeper owns that), the REST answer authoritative over a racing revoke.
 * Time arrives on `tick`; nothing here reads a clock.
 */
export function decide(state: OfferState, event: OfferEvent): OfferDecision {
  switch (event.type) {
    case 'offer_received': {
      const incoming = event.pending;
      // Socket and push both deliver the same card; the second is a no-op —
      // whether the first is still on screen or has already been answered.
      if (state.pending?.offer.id === incoming.offer.id) return noop(state);
      if (state.answeredOfferIds.includes(incoming.offer.id)) {
        return noop(state);
      }
      if (deadOnArrival(incoming)) {
        // The one drop with no user-visible trace; without this it is
        // indistinguishable from the api never having offered at all.
        console.warn(
          'offer dropped: push arrived more than one window past its deadline',
          incoming.offer.id,
        );
        return noop(state);
      }
      // An answer is in flight for the card on screen: the server has one
      // live card per driver, so a second one cannot be live — leave it.
      if (state.phase === 'accepting' || state.phase === 'declining') {
        return noop(state);
      }
      return {
        state: {
          ...state,
          phase: 'pending',
          pending: incoming,
          remainingMs: incoming.durationMs,
          banner: null,
          errorCode: null,
        },
        effects: [
          { type: 'alert_start' },
          { type: 'route_offer' },
          { type: 'announce', key: 'driver.offer.title' },
        ],
      };
    }

    case 'tick': {
      if (!state.pending || state.phase === 'idle') return noop(state);
      const remainingMs = remainingFor(state.pending, event.nowMs);
      if (remainingMs === 0 && state.phase === 'pending') {
        // No decline call: the local clock ends ≥ the server's by one latency,
        // so a decline would always meet an already-expired offer.
        return {
          state: cleared(state, 'expired'),
          effects: [{ type: 'alert_stop' }, { type: 'route_home' }],
        };
      }
      // While an answer is in flight the number keeps moving; the REST
      // answer, not the clock, decides how the card ends.
      return noop({ ...state, remainingMs });
    }

    case 'accept_pressed':
      if (
        state.phase !== 'pending' ||
        !state.pending ||
        state.remainingMs <= 0
      ) {
        return noop(state);
      }
      return {
        state: { ...state, phase: 'accepting' },
        effects: [{ type: 'post_accept', offerId: state.pending.offer.id }],
      };

    case 'accepted':
      if (!state.pending) return noop(state);
      return {
        state: cleared(state, null),
        effects: [
          { type: 'alert_stop' },
          {
            type: 'open_ride',
            rideId: event.rideId,
            paymentMethod: state.pending.paymentMethod,
          },
        ],
      };

    case 'decline_pressed':
      if (state.phase !== 'pending' || !state.pending) return noop(state);
      return {
        state: { ...state, phase: 'declining' },
        effects: [
          { type: 'alert_stop' },
          { type: 'post_decline', offerId: state.pending.offer.id },
        ],
      };

    case 'declined':
      return {
        state: cleared(state, null),
        effects: [{ type: 'alert_stop' }, { type: 'route_home' }],
      };

    case 'rejected':
      // 409 `offer_not_pending` = someone else took it, or it expired
      // server-side first — the same thing to the driver.
      return {
        state: cleared(
          state,
          event.code === 'offer_not_pending' ? 'taken' : 'error',
          event.code,
        ),
        effects: [{ type: 'alert_stop' }, { type: 'route_home' }],
      };

    case 'revoked':
      if (state.pending?.offer.id !== event.offerId) return noop(state);
      // Accept vs revoke: the REST answer wins (Q3). A revoke landing while
      // the accept is in flight is answered by that accept's 409 or 201.
      if (state.phase === 'accepting') return noop(state);
      return {
        state: cleared(state, event.reason),
        effects: [{ type: 'alert_stop' }, { type: 'route_home' }],
      };

    case 'queue':
      return noop({ ...state, queue: event.event });

    case 'speed':
      return noop({ ...state, speedMps: event.mps });

    case 'banner_dismissed':
      return noop({ ...state, banner: null, errorCode: null });
  }
}
