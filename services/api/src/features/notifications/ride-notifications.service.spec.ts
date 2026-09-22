import { Logger } from '@nestjs/common';
import {
  SMS_DRIVER_NAME_MAX_CHARS,
  SMS_ETA_MAX_DISPLAY_MINUTES,
  TRACKING_LINK_HOST_MAX_CHARS,
  type Ride,
  type RideStatus,
  type SmsProvider,
} from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import type { DriverLocationStore } from '../drivers';
import type { RealtimeService } from '../realtime';
import type { TransitionedRide } from '../rides';
import { RideNotificationsService } from './ride-notifications.service';
import type {
  NotifiableRide,
  NotificationsRepository,
} from './notifications.repository';

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const RIDER_ID = '99999999-8888-4777-8666-555555555555';
const DRIVER_ID = 'bb1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e12';
const VEHICLE_ID = 'cc2e3d4f-5a6b-4c7d-8e9f-1b2c3d4e5f01';
const TOKEN = 'Ab3_-6qhTGplK0vw'; // 16 base64url chars, post-#136
const BASE_URL = 'http://localhost:3000';
/** What `trackingLink` emits from BASE_URL: no scheme (#136). */
const SMS_HOST = 'localhost:3000';

const PICKUP = { lat: 56.9496, lng: 24.1052 };

function ride(overrides: Partial<Ride> = {}): Ride {
  return {
    id: RIDE_ID,
    riderId: RIDER_ID,
    bookingChannel: 'phone',
    trackingToken: TOKEN,
    ...overrides,
  } as Ride;
}

function transitioned(status: RideStatus): TransitionedRide {
  return {
    id: RIDE_ID,
    orderId: '11111111-2222-4333-8444-555555555555',
    status,
    riderId: RIDER_ID,
    driverId: DRIVER_ID,
    geozoneId: null,
    createdAt: new Date('2026-08-10T10:00:00.000Z'),
  };
}

function notifiable(overrides: Partial<NotifiableRide> = {}): NotifiableRide {
  return {
    id: RIDE_ID,
    status: 'accepted',
    riderId: RIDER_ID,
    driverId: DRIVER_ID,
    vehicleId: VEHICLE_ID,
    bookingChannel: 'phone',
    trackingToken: TOKEN,
    request: {
      pickup: { location: PICKUP, address: 'Brīvības iela 1' },
      destination: {
        location: { lat: 56.9236, lng: 23.9711 },
        address: 'Lidosta RIX',
      },
    } as NotifiableRide['request'],
    updatedAt: new Date('2026-08-10T10:00:00.000Z'),
    ...overrides,
  };
}

function build(
  options: {
    language?: 'lv' | 'ru' | 'en';
    details?: NotifiableRide | undefined;
    smsThrows?: boolean;
    /** null = the driver has no recorded position. */
    position?: { lat: number; lng: number } | null;
    emitThrows?: boolean;
    /** Past `vehicleSchema`'s `.max(10)` on purpose — see the warn case. */
    plate?: string;
    /** The raw `display_name`; `smsDriverName` bounds it (#136). */
    driverName?: string;
    /**
     * Overrides `BASE_URL` for ONE case. The file's default stays the dev
     * origin `env.schema.spec.ts:106` deliberately documents — moving it would
     * make every other case here stop representing what developers run.
     */
    baseUrl?: string;
  } = {},
) {
  const calls: string[] = [];
  const sent: { phone: string; body: string }[] = [];
  const emitted: { event: string; payload: unknown }[] = [];

  const sms = {
    send: (phone: string, body: string) => {
      calls.push('sms.send');
      if (options.smsThrows) return Promise.reject(new Error('gateway down'));
      sent.push({ phone, body });
      return Promise.resolve();
    },
  } as unknown as SmsProvider;

  const repository = {
    riderContact: () => {
      calls.push('repo.riderContact');
      return Promise.resolve({
        phone: '+37127000001',
        language: options.language ?? 'lv',
      });
    },
    rideById: () => {
      calls.push('repo.rideById');
      return Promise.resolve(
        'details' in options ? options.details : notifiable(),
      );
    },
    driverCard: (_driverId: string, vehicleId: string | null) => {
      calls.push(`repo.driverCard(${vehicleId})`);
      return Promise.resolve({
        name: options.driverName ?? 'Jānis Bērziņš',
        photoUrl: null,
        plate: options.plate ?? 'AB-1234',
      });
    },
  } as unknown as NotificationsRepository;

  const locations = {
    positionOf: () => {
      calls.push('locations.positionOf');
      const p =
        options.position === undefined
          ? { lat: PICKUP.lat + 0.01, lng: PICKUP.lng } // ~1.1 km north
          : options.position;
      return Promise.resolve(
        p ? { location: p, atMs: 1_800_000_000_000 } : null,
      );
    },
  } as unknown as DriverLocationStore;

  const realtime = {
    emitToDispatch: (_cityId: string, event: string, payload: unknown) => {
      calls.push(`realtime.emitToDispatch(${event})`);
      if (options.emitThrows) throw new Error('schema drift');
      emitted.push({ event, payload });
    },
  } as unknown as RealtimeService;

  const env = {
    PUBLIC_TRACKING_BASE_URL: options.baseUrl ?? BASE_URL,
    DEFAULT_CITY_ID: '00000000-0000-4000-8000-000000000001',
  } as Env;

  return {
    service: new RideNotificationsService(
      sms,
      repository,
      locations,
      realtime,
      env,
    ),
    sent,
    calls,
    emitted,
  };
}

describe('RideNotificationsService.onRideCreated', () => {
  it('phone booking → confirmation carries the /t/<token> link (expected — AC #1)', async () => {
    const { service, sent } = build();

    await service.onRideCreated(ride());

    expect(sent).toHaveLength(1);
    expect(sent[0]!.phone).toBe('+37127000001');
    expect(sent[0]!.body).toContain(`${SMS_HOST}/t/${TOKEN}`);
    // LV takes the `/t/` path the real route already serves, and #136 spends
    // neither the 8 characters of `https://` nor the 8 of `?lang=`.
    expect(sent[0]!.body).not.toContain('?lang=');
    expect(sent[0]!.body).not.toContain('http');
  });

  it('non-LV rider gets the one-character language path, not a query (edge)', async () => {
    const { service, sent } = build({ language: 'ru' });

    await service.onRideCreated(ride());

    // `/r/` is a dispatch rewrite onto `/t/[token]?lang=ru`. It costs 0 extra
    // characters where `?lang=ru` cost 8, which is what puts RU inside the
    // 70-character segment (#136).
    expect(sent[0]!.body).toContain(`${SMS_HOST}/r/${TOKEN}`);
    expect(sent[0]!.body).not.toContain('?lang=');
    expect(sent[0]!.body).toContain('забронировано');
  });

  it('app booking → plain confirmation, NO link (edge — SMS budget row)', async () => {
    const { service, sent } = build();

    await service.onRideCreated(ride({ bookingChannel: 'app' }));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).not.toContain('/t/');
  });

  it('SMS provider down → resolves anyway and raises the alarm log (failure — AC #3)', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { service } = build({ smsThrows: true });

    await expect(service.onRideCreated(ride())).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ride.notifications.sms_send_failed',
        rideId: RIDE_ID,
        kind: 'booking_confirmed',
      }),
    );
    logged.mockRestore();
  });

  it("SMS failure also lands on Dina's board as dispatch:sms_failed (expected — #18)", async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { service, emitted } = build({ smsThrows: true });

    await service.onRideCreated(ride());

    expect(emitted).toEqual([
      {
        event: 'dispatch:sms_failed',
        payload: {
          rideId: RIDE_ID,
          kind: 'booking_confirmed',
          at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        },
      },
    ]);
    logged.mockRestore();
  });

  it('a delivered SMS emits no console alert (edge)', async () => {
    const { service, emitted } = build();

    await service.onRideCreated(ride());

    expect(emitted).toEqual([]);
  });

  it('a failed ALERT emit is logged, never thrown — the booking survives both failures (failure)', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service } = build({ smsThrows: true, emitThrows: true });

    await expect(service.onRideCreated(ride())).resolves.toBeUndefined();

    expect(warned).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ride.notifications.sms_alert_emit_failed',
        rideId: RIDE_ID,
      }),
    );
    logged.mockRestore();
    warned.mockRestore();
  });
});

describe('RideNotificationsService.onStatus', () => {
  it('accepted + phone channel → driver_assigned with name, plate, ETA, link (expected — AC #1)', async () => {
    const { service, sent, calls } = build();

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body).toContain('Jānis'); // first name only, never the surname
    expect(body).not.toContain('Bērziņš');
    expect(body).toContain('AB-1234');
    expect(body).toMatch(/~\d+ min/); // a real estimate, not the '?' fallback
    expect(body).toContain(`${SMS_HOST}/t/${TOKEN}`);
    // The plate comes from the ride's STAMPED vehicle (#86), never the fleet.
    expect(calls).toContain(`repo.driverCard(${VEHICLE_ID})`);
  });

  it('accepted + app channel → NO driver_assigned SMS (edge — SMS budget row)', async () => {
    const { service, sent, calls } = build({
      details: notifiable({ bookingChannel: 'app' }),
    });

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(sent).toHaveLength(0);
    // WHERE the guard sits, not just that it fires: after the row read and
    // before `riderContact`, so an app ride costs no extra queries. Moving it
    // below `driverCard` keeps every `sent` assertion green and quietly adds
    // two reads per transition.
    expect(calls).toEqual(['repo.rideById']);
  });

  it('arrived + app channel → NO driver_arrived SMS (expected — AC #1)', async () => {
    const { service, sent, calls } = build({
      details: notifiable({ status: 'arrived', bookingChannel: 'app' }),
    });

    await service.onStatus(transitioned('arrived'), 'arriving');

    expect(sent).toHaveLength(0);
    expect(calls).toEqual(['repo.rideById']);
  });

  it('arrived + phone channel → driver_arrived SMS, unchanged (expected — AC #2)', async () => {
    const { service, sent } = build({
      details: notifiable({ status: 'arrived', bookingChannel: 'phone' }),
    });

    await service.onStatus(transitioned('arrived'), 'arriving');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain('AB-1234');
    // The arrival template carries no link — only the two LINKED ones do.
    expect(sent[0]!.body).not.toContain('/t/');
  });

  it('any other transition is a no-op — not even a repository read (edge)', async () => {
    const { service, sent, calls } = build();

    await service.onStatus(transitioned('arriving'), 'accepted');
    await service.onStatus(transitioned('completed'), 'in_progress');
    await service.onStatus(transitioned('cancelled_by_rider'), 'accepted');

    expect(sent).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("driver with no recorded position → '?' ETA, never a fabricated number (edge)", async () => {
    const { service, sent } = build({ position: null });

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(sent[0]!.body).toContain('~? min');
  });

  it('SMS provider down mid-lifecycle → resolves and logs, ride unharmed (failure — AC #3)', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { service } = build({ smsThrows: true });

    await expect(
      service.onStatus(transitioned('arrived'), 'arriving'),
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ride.notifications.sms_send_failed',
        kind: 'driver_arrived',
      }),
    );
    logged.mockRestore();
  });

  it('a driver 60 km out renders ~99 min, not ~144 (edge — the #136 ETA clamp)', async () => {
    // 0.54 degrees of latitude is ~60 km; at 417 m/min that is 144 minutes,
    // which is three digits of a 70-character budget AND a dispatch bug.
    const { service, sent } = build({
      position: { lat: PICKUP.lat + 0.54, lng: PICKUP.lng },
    });

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(sent[0]!.body).toContain('~99 min');
    expect(sent[0]!.body).not.toContain('~144');
  });

  it('a name over 10 characters renders as an initial (edge — the #136 name bound)', async () => {
    const { service, sent } = build({ driverName: 'Konstantīns Ozoliņš' });

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(sent[0]!.body).toContain('Šoferis K.,');
    expect(sent[0]!.body).not.toContain('Konstantīn');
  });

  it('a body over one segment warns and STILL sends (failure — the assertion must not gate)', async () => {
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    // `vehicleSchema` bounds a real plate at 10; this is past it on purpose,
    // because the warn exists to catch exactly the case where a bound the
    // budget assumes has stopped holding.
    const { service, sent } = build({ plate: 'X'.repeat(80) });

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(warned).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ride.notifications.sms_multi_segment',
        rideId: RIDE_ID,
        kind: 'driver_assigned',
        segments: expect.any(Number) as unknown,
      }),
    );
    // The point of the case: the rider still got their message.
    expect(sent).toHaveLength(1);
    warned.mockRestore();
  });

  it('a normal body emits no multi-segment warn (expected)', async () => {
    // A SAMPLE, not the bound — `Jānis` (5) and `AB-1234` (7) against a
    // 14-character dev host render 65 characters, nine inside the ceiling.
    // The at-the-bound case is the next one; the exhaustive proof over all
    // inputs is `packages/shared/tests/sms-budget.test.ts`.
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, sent } = build({ language: 'ru' });

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(sent).toHaveLength(1);
    expect(warned).not.toHaveBeenCalled();
    warned.mockRestore();
  });

  it('holds at the ENFORCED host ceiling with every term maxed (edge)', async () => {
    // WHY THIS CASE EXISTS (PR #245 F5). The one-segment guarantee is
    // unconditional in prose but the host bound is enforced only under
    // `NODE_ENV === 'production'`; this file's `BASE_URL` is the dev default,
    // a 14-character host — FOUR over the ceiling the derivation assumes. At
    // that host the guarantee is genuinely false: `reproduced` in the review,
    // LV 73 / RU 74 characters, 2 segments each, with no pathological input at
    // all (a 10-character name and an 8-character plate already tip RU).
    //
    // So the case above could not be the at-the-bound test it was named for.
    // This one overrides the host to the value production actually permits and
    // maxes every other term: name at `SMS_DRIVER_NAME_MAX_CHARS` (10 — one
    // more and `smsDriverName` abbreviates to `<initial>.`, which is SHORTER),
    // plate at `vehicleSchema`'s `.max(10)`, and a driver ~111 km north so
    // `estimateEtaMinutes` overshoots and the send path clamps the display to
    // `SMS_ETA_MAX_DISPLAY_MINUTES`. RU is the binding language.
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service, sent } = build({
      language: 'ru',
      baseUrl: `https://${'x'.repeat(TRACKING_LINK_HOST_MAX_CHARS)}`,
      driverName: 'A'.repeat(SMS_DRIVER_NAME_MAX_CHARS),
      plate: 'A'.repeat(10),
      position: { lat: PICKUP.lat + 1, lng: PICKUP.lng },
    });

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    // The clamp fired — otherwise the ETA term is not at its bound and this
    // case is another sample.
    expect(body).toContain(`${SMS_ETA_MAX_DISPLAY_MINUTES}`);
    // 70 is the UCS-2 single-segment ceiling, and the RU row has zero spare at
    // it by construction. Pinning the LENGTH and not just the warn's absence
    // means widening the host budget reddens here rather than sliding.
    expect(body).toHaveLength(70);
    expect(warned).not.toHaveBeenCalled();
    warned.mockRestore();
  });
});
