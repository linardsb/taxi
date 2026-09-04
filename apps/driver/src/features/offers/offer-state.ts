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
}

export const initialOffers: OfferState = {
  phase: 'idle',
  pending: null,
  remainingMs: 0,
  banner: null,
  errorCode: null,
  speedMps: null,
  queue: null,
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
 * reaches the phone (the socket path is live by construction). The check
 * uses the wire's absolute `expiresAt` against the phone clock, tolerating a
 * skew of one whole window: an offer more than `durationMs` past its
 * deadline is dropped, anything closer renders and is corrected by the
 * server's 409 (`taken`) on accept — recoverable, never a crash (AC3).
 */
function deadOnArrival(pending: PendingOffer): boolean {
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
      // Socket and push both deliver the same card; the second is a no-op.
      if (state.pending?.offer.id === incoming.offer.id) return noop(state);
      if (deadOnArrival(incoming)) return noop(state);
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
