import { describe, expect, it } from 'vitest';
import {
  DRAFT_POINT_MAX_AGE_MS,
  deserializeDraft,
  emptyDraft,
  expireStalePoints,
  isBookable,
  isEmptyDraft,
  serializeDraft,
  setAddressPoint,
  setAddressText,
  type BookingDraft,
} from './booking-draft';

const NOW = Date.parse('2026-08-17T12:00:00Z');

const PICKUP = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Kaļķu iela 28, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9236, lng: 23.9711 },
  address: 'Lidosta Rīga',
};

/** A draft one keystroke away from bookable — the fixture every case starts from. */
function bookableDraft(): BookingDraft {
  let draft = emptyDraft('idem-1');
  draft = { ...draft, phone: '+37129999000' };
  draft = setAddressPoint(draft, 'pickup', PICKUP, 'place-1', NOW);
  draft = setAddressPoint(draft, 'destination', DESTINATION, 'place-2', NOW);
  return draft;
}

describe('booking draft', () => {
  it('is bookable once both points and a valid phone are present (expected)', () => {
    expect(isBookable(bookableDraft())).toBe(true);
  });

  it('is not bookable on an unresolved address (edge)', () => {
    const draft = setAddressText(bookableDraft(), 'destination', 'Lidosta');

    // The text survives; only the coordinate went. That pairing is the point.
    expect(draft.destination.text).toBe('Lidosta');
    expect(draft.destination.point).toBeNull();
    expect(isBookable(draft)).toBe(false);
  });

  it('is not bookable on a malformed phone (edge)', () => {
    const draft = { ...bookableDraft(), phone: '2999' };
    expect(isBookable(draft)).toBe(false);
  });

  it('keeps one idempotency key across the whole draft (expected)', () => {
    let draft = emptyDraft('idem-1');
    draft = setAddressText(draft, 'pickup', 'Kaļķu');
    draft = { ...draft, phone: '+37129999000', note: 'zvana no bāra' };

    // A key minted per submit attempt would make every retry a new ride —
    // which is the bug idempotency exists to prevent.
    expect(draft.idempotencyKey).toBe('idem-1');
  });

  it('round-trips through storage with its resolved points (expected)', () => {
    const draft = bookableDraft();

    const restored = deserializeDraft(serializeDraft(draft), NOW);

    expect(restored).toEqual(draft);
  });

  it('drops a resolved point older than the window, keeping the text (edge)', () => {
    const draft = bookableDraft();
    const later = NOW + DRAFT_POINT_MAX_AGE_MS + 1;

    const expired = expireStalePoints(draft, later);

    expect(expired.pickup.point).toBeNull();
    expect(expired.pickup.placeId).toBeNull();
    // Never book a coordinate whose provenance expired — but never silently
    // wipe what the dispatcher typed either.
    expect(expired.pickup.text).toBe('Kaļķu iela 28, Rīga');
    expect(isBookable(expired)).toBe(false);
  });

  it('keeps a point exactly at the age boundary (edge)', () => {
    const draft = bookableDraft();

    const kept = expireStalePoints(draft, NOW + DRAFT_POINT_MAX_AGE_MS);

    expect(kept.pickup.point).toEqual(PICKUP);
  });

  it('expires stale points on restore, not only on demand (edge)', () => {
    const raw = serializeDraft(bookableDraft());

    const restored = deserializeDraft(raw, NOW + DRAFT_POINT_MAX_AGE_MS + 1);

    expect(restored?.pickup.point).toBeNull();
    expect(restored?.pickup.text).toBe('Kaļķu iela 28, Rīga');
  });

  it('rejects a draft written by an older build rather than half-loading it (failure)', () => {
    expect(deserializeDraft('{"phone":"+37129999000"}', NOW)).toBeNull();
  });

  it('rejects unparseable storage bytes (failure)', () => {
    expect(deserializeDraft('not json', NOW)).toBeNull();
  });

  it('reports an untouched draft as empty (edge)', () => {
    expect(isEmptyDraft(emptyDraft('idem-1'))).toBe(true);
    expect(isEmptyDraft(bookableDraft())).toBe(false);
  });
});
