import { describe, expect, it } from 'vitest';
import {
  TRACKING_PAGE_STATES,
  trackingTokenSchema,
  trackingViewSchema,
} from '../src/schemas/tracking';

const VALID_TOKEN = 'Ab3_-6qhTGplK0vwXz9y-Q'; // 22 base64url chars

const validView = {
  state: 'arriving',
  driverName: 'Jānis',
  driverPhotoUrl: null,
  vehiclePlate: 'AB-1234',
  position: { lat: 56.95, lng: 24.1, at: '2026-08-10T12:00:00.000Z' },
  etaMinutes: 4,
  dispatchPhone: '+37160000000',
  updatedAt: '2026-08-10T12:00:00.000Z',
};

describe('trackingTokenSchema', () => {
  it('accepts a 22-char base64url token (expected)', () => {
    expect(trackingTokenSchema.parse(VALID_TOKEN)).toBe(VALID_TOKEN);
  });

  it('rejects wrong lengths (edge)', () => {
    expect(trackingTokenSchema.safeParse(VALID_TOKEN.slice(1)).success).toBe(
      false,
    );
    expect(trackingTokenSchema.safeParse(`${VALID_TOKEN}A`).success).toBe(
      false,
    );
    expect(trackingTokenSchema.safeParse('').success).toBe(false);
  });

  it('rejects classic-base64 alphabet leaking in (failure)', () => {
    // + / = are base64, NOT base64url — a token built with the wrong encoder
    // must fail shape validation, not silently 404 later.
    expect(
      trackingTokenSchema.safeParse('Ab3+/6qhTGplK0vwXz9y=Q').success,
    ).toBe(false);
  });
});

describe('trackingViewSchema', () => {
  it('parses a full active-ride view (expected)', () => {
    const parsed = trackingViewSchema.parse(validView);
    expect(parsed.state).toBe('arriving');
    expect(parsed.position?.lat).toBe(56.95);
  });

  it('parses the pre-driver searching view with nulls (edge)', () => {
    const parsed = trackingViewSchema.parse({
      ...validView,
      state: 'searching',
      driverName: null,
      driverPhotoUrl: null,
      vehiclePlate: null,
      position: null,
      etaMinutes: null,
    });
    expect(parsed.driverName).toBeNull();
    expect(parsed.position).toBeNull();
  });

  it('rejects Date objects — wire timestamps are ISO strings (failure)', () => {
    expect(
      trackingViewSchema.safeParse({ ...validView, updatedAt: new Date() })
        .success,
    ).toBe(false);
    expect(
      trackingViewSchema.safeParse({
        ...validView,
        position: { lat: 56.95, lng: 24.1, at: new Date() },
      }).success,
    ).toBe(false);
  });

  it('pins the page-state set so a new state visits the renderer deliberately', () => {
    expect(TRACKING_PAGE_STATES).toEqual([
      'searching',
      'assigned',
      'arriving',
      'arrived',
      'in_progress',
      'completed',
      'cancelled',
      'expired',
    ]);
  });
});
