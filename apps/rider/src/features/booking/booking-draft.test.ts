import type { AddressPoint, FareQuote } from '@taxi/shared';
import {
  bookingDraftReducer,
  initialDraft,
  isBookable,
  type BookingAction,
  type BookingDraft,
} from './booking-draft';

const point = (address: string): AddressPoint => ({
  location: { lat: 56.9496, lng: 24.1052 },
  address,
});

const QUOTE: FareQuote = {
  model: 'upfront_fixed',
  currency: 'EUR',
  totalCents: 840,
  breakdown: {
    baseCents: 200,
    distanceCents: 540,
    timeCents: 100,
    discountCents: 0,
  },
};

/** Counted, so a rotation is visible rather than merely probable. */
function keys() {
  let n = 0;
  return () => {
    n += 1;
    return `key-${n}`;
  };
}

function run(actions: BookingAction[], newKey = keys()): BookingDraft {
  return actions.reduce(
    (state, action) => bookingDraftReducer(state, action, newKey),
    initialDraft(newKey()),
  );
}

describe('bookingDraftReducer', () => {
  it('fills both ends and takes a quote (expected)', () => {
    const draft = run([
      { type: 'setPickup', point: point('Brīvības 1') },
      { type: 'setDropoff', point: point('Lidosta RIX'), placeId: 'p-1' },
      { type: 'quoteRequested' },
      { type: 'quoteArrived', quote: QUOTE, requestId: 1 },
    ]);

    expect(draft.quoteState).toBe('ready');
    expect(draft.quote).toEqual(QUOTE);
    expect(draft.dropoffPlaceId).toBe('p-1');
    expect(isBookable(draft)).toBe(true);
  });

  it('discards the quote AND mints a fresh key when the dropoff changes (edge — E1)', () => {
    const newKey = keys();
    const before = run(
      [
        { type: 'setPickup', point: point('Brīvības 1') },
        { type: 'setDropoff', point: point('Lidosta RIX'), placeId: 'p-1' },
        { type: 'quoteRequested' },
        { type: 'quoteArrived', quote: QUOTE, requestId: 1 },
      ],
      newKey,
    );

    const after = bookingDraftReducer(
      before,
      { type: 'setDropoff', point: point('Centrāltirgus'), placeId: 'p-2' },
      newKey,
    );

    expect(after.quote).toBeNull();
    expect(after.quoteState).toBe('idle');
    // The key is the whole contract: reusing it would return the ride the OLD
    // body created, and the server does not re-read the body to catch that.
    expect(after.idempotencyKey).not.toBe(before.idempotencyKey);
    expect(isBookable(after)).toBe(false);
  });

  it('changing the pickup rotates the key for the same reason (edge — E1)', () => {
    const newKey = keys();
    const before = run(
      [{ type: 'setDropoff', point: point('Lidosta RIX'), placeId: null }],
      newKey,
    );

    const after = bookingDraftReducer(
      before,
      { type: 'setPickup', point: point('Brīvības 1') },
      newKey,
    );

    expect(after.idempotencyKey).not.toBe(before.idempotencyKey);
  });

  it('changing the payment method keeps BOTH the quote and the key (edge)', () => {
    const newKey = keys();
    const before = run(
      [
        { type: 'setPickup', point: point('Brīvības 1') },
        { type: 'setDropoff', point: point('Lidosta RIX'), placeId: null },
        { type: 'quoteRequested' },
        { type: 'quoteArrived', quote: QUOTE, requestId: 1 },
      ],
      newKey,
    );

    const after = bookingDraftReducer(
      before,
      { type: 'setPaymentMethod', paymentMethod: 'card' },
      newKey,
    );

    // Cash and card are ONE identical price (evidence §7), so there is nothing
    // to re-quote; and the key covers the ATTEMPT, so rotating it here would
    // turn a retry into a second car.
    expect(after.quote).toEqual(QUOTE);
    expect(after.quoteState).toBe('ready');
    expect(after.idempotencyKey).toBe(before.idempotencyKey);
    expect(after.paymentMethod).toBe('card');
  });

  it('drops a late response from a superseded request (failure — the stale-quote race)', () => {
    const newKey = keys();
    const draft = run(
      [
        { type: 'setPickup', point: point('Brīvības 1') },
        { type: 'setDropoff', point: point('Lidosta RIX'), placeId: null },
        { type: 'quoteRequested' },
        { type: 'quoteRequested' },
      ],
      newKey,
    );
    expect(draft.quoteRequestId).toBe(2);

    const stale = bookingDraftReducer(
      draft,
      { type: 'quoteArrived', quote: QUOTE, requestId: 1 },
      newKey,
    );

    // A rider who edits twice quickly must not end up looking at the FIRST
    // corridor's price.
    expect(stale.quote).toBeNull();
    expect(stale.quoteState).toBe('loading');

    const fresh = bookingDraftReducer(
      draft,
      { type: 'quoteArrived', quote: QUOTE, requestId: 2 },
      newKey,
    );
    expect(fresh.quote).toEqual(QUOTE);
  });

  it('a failed quote blocks Book and carries the api code (failure — E2)', () => {
    const newKey = keys();
    const draft = run(
      [
        { type: 'setPickup', point: point('Brīvības 1') },
        { type: 'setDropoff', point: point('Lidosta RIX'), placeId: null },
        { type: 'quoteRequested' },
      ],
      newKey,
    );

    const failed = bookingDraftReducer(
      draft,
      { type: 'quoteFailed', code: 'too_many_requests', requestId: 1 },
      newKey,
    );

    expect(failed.quoteState).toBe('failed');
    expect(failed.quoteErrorCode).toBe('too_many_requests');
    expect(isBookable(failed)).toBe(false);
  });

  it('is not bookable with one end missing, however good the quote (edge)', () => {
    const draft = run([
      { type: 'setDropoff', point: point('RIX'), placeId: null },
    ]);
    expect(isBookable(draft)).toBe(false);
  });

  it('lets a failed quote be retried on the SAME key (failure — H1)', () => {
    const newKey = keys();
    const failed = run(
      [
        { type: 'setPickup', point: point('Brīvības 1') },
        { type: 'setDropoff', point: point('Lidosta RIX'), placeId: null },
        { type: 'quoteRequested' },
        { type: 'quoteFailed', code: 'offline', requestId: 1 },
      ],
      newKey,
    );

    const retried = bookingDraftReducer(failed, { type: 'quoteRetry' }, newKey);

    // `idle` is the only state `useQuote` fires out of — without this the
    // failure is terminal and the rider's only escape is a DIFFERENT
    // destination or killing the app.
    expect(retried.quoteState).toBe('idle');
    expect(retried.quoteErrorCode).toBeNull();
    // The corridor did not change, so rule 1 does not apply: a fresh key here
    // would turn one attempt's retry into a second car.
    expect(retried.idempotencyKey).toBe(failed.idempotencyKey);
  });

  it('ignores a retry that is not out of a failure (edge — H1)', () => {
    const newKey = keys();
    const loading = run(
      [
        { type: 'setPickup', point: point('Brīvības 1') },
        { type: 'setDropoff', point: point('Lidosta RIX'), placeId: null },
        { type: 'quoteRequested' },
      ],
      newKey,
    );

    expect(bookingDraftReducer(loading, { type: 'quoteRetry' }, newKey)).toBe(
      loading,
    );
  });

  it('never lets a late GPS fix overwrite a pickup the rider chose (failure — H2)', () => {
    const newKey = keys();
    const chosen = run(
      [
        { type: 'setPickup', point: point('Stacijas laukums 1') },
        { type: 'setDropoff', point: point('Lidosta RIX'), placeId: null },
        { type: 'quoteRequested' },
        { type: 'quoteArrived', quote: QUOTE, requestId: 1 },
      ],
      newKey,
    );

    // The device's fix, landing minutes later: `/book` is pushed over rather
    // than unmounted while the rider picks an address, so the mount effect's
    // `cancelled` flag never fires.
    const after = bookingDraftReducer(
      chosen,
      { type: 'setPickupIfEmpty', point: point('Brīvības iela 45') },
      newKey,
    );

    expect(after.pickup?.address).toBe('Stacijas laukums 1');
    // And none of `setPickup`'s side effects: the quote the rider is looking at
    // survives, and the key is not rotated under a body nobody edited.
    expect(after.quote).toEqual(QUOTE);
    expect(after.quoteState).toBe('ready');
    expect(after.idempotencyKey).toBe(chosen.idempotencyKey);
  });

  it('still fills an EMPTY pickup from the device (expected — H2)', () => {
    const draft = run([
      { type: 'setPickupIfEmpty', point: point('Brīvības iela 45') },
    ]);

    expect(draft.pickup?.address).toBe('Brīvības iela 45');
  });
});
