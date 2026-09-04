import { Logger } from '@nestjs/common';
import {
  formatMessage,
  rideOfferEventSchema,
  splitFare,
  type Language,
  type PushMessage,
  type RideOffer,
} from '@taxi/shared';
import type { DriversService } from '../drivers';
import type { RealtimeService } from '../realtime';
import type { RideTransitionService } from '../rides';
import {
  DispatchNotifier,
  OFFER_PUSH_PAYLOAD_MAX_BYTES,
} from './dispatch-notifier';

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const OFFER_ID = '7c6b5a49-3827-4160-9504-3f2e1d0c9b8a';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';

/** A 15% split built through `splitFare`, as the offer builder does — never a hand-typed net. */
const offer = (over: Partial<RideOffer> = {}): RideOffer => ({
  id: OFFER_ID,
  rideId: RIDE_ID,
  driverId: DRIVER_ID,
  status: 'pending',
  source: 'auto_match',
  sentAt: new Date('2026-09-04T10:00:00.000Z'),
  expiresAt: new Date('2026-09-04T10:00:20.000Z'),
  etaSeconds: 240,
  pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības iela 1' },
  destination: { location: { lat: 56.97, lng: 24.18 }, address: 'Teika' },
  quote: {
    model: 'upfront_fixed',
    currency: 'EUR',
    totalCents: 1240,
    breakdown: {
      baseCents: 300,
      distanceCents: 640,
      timeCents: 300,
      discountCents: 0,
    },
  },
  split: splitFare(1240, { pct: 15, source: 'platform_base' }),
  ...over,
});

type SendPush = DriversService['sendPush'];

function build(over: { sendPush?: jest.Mock; emitToDriver?: jest.Mock } = {}) {
  const sendPush = over.sendPush ?? jest.fn(() => Promise.resolve());
  const emitToDriver = over.emitToDriver ?? jest.fn();
  const notifier = new DispatchNotifier(
    {
      emitToDriver,
      emitToRide: jest.fn(),
      joinRideRoom: jest.fn(),
    } as unknown as RealtimeService,
    { emitStatus: jest.fn() } as unknown as RideTransitionService,
    { sendPush } as unknown as DriversService,
  );
  return { notifier, emitToDriver, sendPush };
}

/** The message `sendPush` would build for `language` — the builder is what the notifier hands over. */
function messageOf(
  sendPush: jest.Mock,
  language: Language = 'lv',
): PushMessage {
  const call = sendPush.mock.calls[0] as Parameters<SendPush> | undefined;
  if (!call) throw new Error('sendPush was not called');
  return call[1](language);
}

/** Let the fire-and-forget `.catch` settle before asserting nothing escaped. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('DispatchNotifier.emitOffer (#15)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emits the wire offer with the payment method and pushes the same offer as data (expected)', async () => {
    const { notifier, emitToDriver, sendPush } = build();

    notifier.emitOffer(offer(), 'card');

    expect(emitToDriver).toHaveBeenCalledWith(
      DRIVER_ID,
      'ride:offer',
      expect.objectContaining({
        id: OFFER_ID,
        paymentMethod: 'card',
        sentAt: '2026-09-04T10:00:00.000Z',
        expiresAt: '2026-09-04T10:00:20.000Z',
      }),
    );

    expect(sendPush).toHaveBeenCalledWith(
      DRIVER_ID,
      expect.any(Function),
      'dispatch.offer.push',
    );
    const message = messageOf(sendPush);
    expect(message.title).toBe(formatMessage('lv', 'push.offer_title'));
    // The body carries the driver's NET — 1240 − round(1240 × 15 / 100) = 1054.
    expect(message.body).toBe(
      formatMessage('lv', 'push.offer_body', { amount: '€10.54' }),
    );
    expect(message.data).toMatchObject({
      kind: 'offer',
      offerId: OFFER_ID,
      rideId: RIDE_ID,
      expiresAt: '2026-09-04T10:00:20.000Z',
    });
    // The payload IS the wire event: a cold-started app renders the card from it.
    const carried = rideOfferEventSchema.parse(
      JSON.parse(message.data!.offer!),
    );
    expect(carried.id).toBe(OFFER_ID);
    expect(carried.paymentMethod).toBe('card');
    expect(carried.split.driverNetCents).toBe(1054);
    await flush();
  });

  it('builds the copy in the driver`s language (expected)', () => {
    const { notifier, sendPush } = build();
    notifier.emitOffer(offer(), 'cash');
    expect(messageOf(sendPush, 'ru').title).toBe(
      formatMessage('ru', 'push.offer_title'),
    );
  });

  it('drops the offer body but keeps the ids when the JSON would not fit (edge)', async () => {
    const { notifier, sendPush } = build();
    const address = 'x'.repeat(OFFER_PUSH_PAYLOAD_MAX_BYTES + 52); // 2,100 B on its own

    notifier.emitOffer(
      offer({ pickup: { location: { lat: 56.95, lng: 24.11 }, address } }),
      'cash',
    );

    const { data } = messageOf(sendPush);
    expect(data).toEqual({
      kind: 'offer',
      offerId: OFFER_ID,
      rideId: RIDE_ID,
      expiresAt: '2026-09-04T10:00:20.000Z',
    });
    expect(data).not.toHaveProperty('offer');
    await flush();
  });

  it('never throws when the push rejects or the socket emit throws (failure)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { notifier, sendPush } = build({
      sendPush: jest.fn(() => Promise.reject(new Error('expo down'))),
      emitToDriver: jest.fn(() => {
        throw new Error('socket down');
      }),
    });

    expect(() => notifier.emitOffer(offer(), 'cash')).not.toThrow();
    await flush();

    // The socket failure is logged; the push was still attempted — the two
    // channels are independent by design.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'dispatch.offer.notify_failed' }),
    );
    expect(sendPush).toHaveBeenCalledTimes(1);
  });
});
