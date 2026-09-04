import { rideOfferSchema, splitFare } from '@taxi/shared';
import {
  decide,
  initialOffers,
  type OfferEffect,
  type OfferState,
  type PendingOffer,
} from './offer-state';

const types = (effects: OfferEffect[]) => effects.map((e) => e.type);

const SENT_AT = '2026-09-04T10:00:00.000Z';
const EXPIRES_AT = '2026-09-04T10:00:20.000Z'; // offerTimeoutSeconds = 20
/** Local receipt, one latency after the server sent it. */
const T0 = Date.parse(SENT_AT) + 300;

const offer = (id = '7c6b5a49-3827-4160-9504-3f2e1d0c9b8a') =>
  rideOfferSchema.parse({
    id,
    rideId: '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
    driverId: 'd0000000-0000-4000-8000-000000000001',
    status: 'pending',
    source: 'auto_match',
    sentAt: SENT_AT,
    expiresAt: EXPIRES_AT,
    etaSeconds: 240,
    pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības 1' },
    destination: { location: { lat: 56.97, lng: 24.18 }, address: 'Teika' },
    quote: {
      model: 'upfront_fixed',
      currency: 'EUR',
      totalCents: 1240,
      breakdown: { baseCents: 300, distanceCents: 640, timeCents: 300 },
    },
    split: splitFare(1240, { pct: 15, source: 'platform_base' }),
  });

/** What the effect runner builds from a wire event, received at `receivedAtMs`. */
const pending = (
  over: Partial<PendingOffer> = {},
  receivedAtMs = Date.parse(SENT_AT) + 300, // one latency after the server sent it
): PendingOffer => {
  const o = over.offer ?? offer();
  return {
    offer: o,
    paymentMethod: 'cash',
    receivedAtMs,
    durationMs: o.expiresAt.getTime() - o.sentAt.getTime(),
    ...over,
  };
};

const received = (p = pending()) =>
  decide(initialOffers, { type: 'offer_received', pending: p });

describe('decide — receiving a card', () => {
  it('shows the card with the full server window and starts the alerts (expected)', () => {
    const p = pending();
    const { state, effects } = received(p);

    expect(state.phase).toBe('pending');
    expect(state.pending).toBe(p);
    expect(state.remainingMs).toBe(20_000);
    expect(types(effects)).toEqual(['alert_start', 'route_offer', 'announce']);
  });

  it('a duplicate delivery (socket + push, same id) is a no-op (edge)', () => {
    const first = received();
    const again = decide(first.state, {
      type: 'offer_received',
      pending: pending({}, Date.parse(SENT_AT) + 2_000),
    });
    expect(again.state).toBe(first.state);
    expect(again.effects).toEqual([]);
  });

  it('drops a late push for an offer already a full window past its deadline (edge)', () => {
    // Received 21 s after expiry: 20 s window + 1 s, so beyond the tolerated skew.
    const late = pending({}, Date.parse(EXPIRES_AT) + 21_000);
    const { state, effects } = received(late);
    expect(state).toBe(initialOffers);
    expect(effects).toEqual([]);
  });

  it('a different id replaces the pending card; one in flight is left alone (edge)', () => {
    const first = received();
    const other = pending({
      offer: offer('8d7c6b5a-4938-4271-8615-4a3b2c1d0e9f'),
    });
    const replaced = decide(first.state, {
      type: 'offer_received',
      pending: other,
    });
    expect(replaced.state.pending).toBe(other);

    const accepting = decide(first.state, { type: 'accept_pressed' }).state;
    const ignored = decide(accepting, {
      type: 'offer_received',
      pending: other,
    });
    expect(ignored.state).toBe(accepting);
  });
});

describe('decide — the countdown', () => {
  it('counts down server-relative from local receipt and clears at zero with NO decline (edge)', () => {
    const p = pending({}, T0);
    const shown = received(p).state;

    const mid = decide(shown, { type: 'tick', nowMs: T0 + 12_500 });
    expect(mid.state.remainingMs).toBe(7_500);
    expect(mid.effects).toEqual([]);

    const done = decide(mid.state, { type: 'tick', nowMs: T0 + 20_000 });
    expect(done.state.phase).toBe('idle');
    expect(done.state.pending).toBeNull();
    expect(done.state.banner).toBe('expired');
    // The sweeper owns expiry; a decline here would always meet a 409.
    expect(types(done.effects)).toEqual(['alert_stop', 'route_home']);
    expect(types(done.effects)).not.toContain('post_decline');
  });

  it('refuses an accept after zero — the dark-driver half the app owns (failure)', () => {
    const shown = received(pending({}, T0)).state;
    const expired = decide(shown, { type: 'tick', nowMs: T0 + 25_000 }).state;

    const pressed = decide(expired, { type: 'accept_pressed' });
    expect(pressed.effects).toEqual([]);
    expect(pressed.state.phase).toBe('idle');
  });

  it('keeps the clock moving but never clears while an answer is in flight (edge)', () => {
    const shown = received(pending({}, T0)).state;
    const accepting = decide(shown, { type: 'accept_pressed' }).state;
    const late = decide(accepting, { type: 'tick', nowMs: T0 + 30_000 });
    expect(late.state.phase).toBe('accepting');
    expect(late.state.remainingMs).toBe(0);
    expect(late.effects).toEqual([]);
  });
});

describe('decide — answering', () => {
  it('accept posts once, and the answer carries the card`s payment method into open_ride (expected)', () => {
    const shown = received(pending({ paymentMethod: 'card' })).state;

    const pressed = decide(shown, { type: 'accept_pressed' });
    expect(pressed.state.phase).toBe('accepting');
    expect(pressed.effects).toEqual([
      { type: 'post_accept', offerId: offer().id },
    ]);
    // A second tap while in flight posts nothing.
    expect(decide(pressed.state, { type: 'accept_pressed' }).effects).toEqual(
      [],
    );

    const rideId = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
    const done = decide(pressed.state, { type: 'accepted', rideId });
    expect(done.state.phase).toBe('idle');
    expect(done.state.pending).toBeNull();
    expect(done.effects).toEqual([
      { type: 'alert_stop' },
      { type: 'open_ride', rideId, paymentMethod: 'card' },
    ]);
  });

  it('a 409 offer_not_pending reads as `taken`; any other code as a recoverable error (failure)', () => {
    const accepting = decide(received().state, {
      type: 'accept_pressed',
    }).state;

    const taken = decide(accepting, {
      type: 'rejected',
      code: 'offer_not_pending',
    });
    expect(taken.state.phase).toBe('idle');
    expect(taken.state.banner).toBe('taken');
    expect(types(taken.effects)).toEqual(['alert_stop', 'route_home']);

    const offline = decide(accepting, { type: 'rejected', code: 'offline' });
    expect(offline.state.banner).toBe('error');
    expect(offline.state.errorCode).toBe('offline');
  });

  it('decline stops the alerts, posts, and the card is gone whatever the answer (expected)', () => {
    const shown = received().state;
    const pressed = decide(shown, { type: 'decline_pressed' });
    expect(pressed.state.phase).toBe('declining');
    expect(types(pressed.effects)).toEqual(['alert_stop', 'post_decline']);

    const done = decide(pressed.state, { type: 'declined' });
    expect(done.state).toMatchObject({
      phase: 'idle',
      pending: null,
      banner: null,
    });
    expect(types(done.effects)).toContain('route_home');
  });
});

describe('decide — revocation and the rest', () => {
  it('a revoke for the pending id clears with the matching banner; another id is ignored (edge)', () => {
    const shown = received().state;
    const other = decide(shown, {
      type: 'revoked',
      offerId: '8d7c6b5a-4938-4271-8615-4a3b2c1d0e9f',
      reason: 'taken',
    });
    expect(other.state).toBe(shown);

    for (const reason of ['expired', 'taken', 'cancelled'] as const) {
      const revoked = decide(shown, {
        type: 'revoked',
        offerId: offer().id,
        reason,
      });
      expect(revoked.state.phase).toBe('idle');
      expect(revoked.state.banner).toBe(reason);
      expect(types(revoked.effects)).toEqual(['alert_stop', 'route_home']);
    }
  });

  it('a revoke racing an in-flight accept is ignored — the REST answer wins (Q3, edge)', () => {
    const accepting = decide(received().state, {
      type: 'accept_pressed',
    }).state;
    const raced = decide(accepting, {
      type: 'revoked',
      offerId: offer().id,
      reason: 'taken',
    });
    expect(raced.state).toBe(accepting);
    expect(raced.effects).toEqual([]);
  });

  it('queue, speed and banner dismissal are plain state, no effects (expected)', () => {
    const queue = {
      driverId: 'd0000000-0000-4000-8000-000000000001',
      geozoneId: '00000000-0000-4000-8000-000000000102',
      geozoneSlug: 'rix',
      position: 2,
      size: 5,
      at: SENT_AT,
    };
    const withQueue = decide(initialOffers, { type: 'queue', event: queue });
    expect(withQueue.state.queue).toBe(queue);
    expect(withQueue.effects).toEqual([]);

    const moving = decide(withQueue.state, { type: 'speed', mps: 4.2 });
    expect(moving.state.speedMps).toBe(4.2);

    const errored: OfferState = {
      ...moving.state,
      banner: 'error',
      errorCode: 'offline',
    };
    const dismissed = decide(errored, { type: 'banner_dismissed' });
    expect(dismissed.state.banner).toBeNull();
    expect(dismissed.state.errorCode).toBeNull();
    expect(dismissed.effects).toEqual([]);
  });
});
