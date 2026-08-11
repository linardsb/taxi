import { Logger } from '@nestjs/common';
import type { Ride, RideStatus, SmsProvider } from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import type { DriverLocationStore } from '../drivers';
import type { TransitionedRide } from '../rides';
import { RideNotificationsService } from './ride-notifications.service';
import type {
  NotifiableRide,
  NotificationsRepository,
} from './notifications.repository';

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const RIDER_ID = '99999999-8888-4777-8666-555555555555';
const DRIVER_ID = 'bb1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e12';
const TOKEN = 'Ab3_-6qhTGplK0vwXz9y-Q';
const BASE_URL = 'http://localhost:3000';

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
    bookingChannel: 'phone',
    trackingToken: TOKEN,
    category: 'standard',
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
  } = {},
) {
  const calls: string[] = [];
  const sent: { phone: string; body: string }[] = [];

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
    driverCard: () => {
      calls.push('repo.driverCard');
      return Promise.resolve({
        name: 'Jānis Bērziņš',
        photoUrl: null,
        plate: 'AB-1234',
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

  const env = {
    PUBLIC_TRACKING_BASE_URL: BASE_URL,
    DEFAULT_CITY_ID: '00000000-0000-4000-8000-000000000001',
  } as Env;

  return {
    service: new RideNotificationsService(sms, repository, locations, env),
    sent,
    calls,
  };
}

describe('RideNotificationsService.onRideCreated', () => {
  it('phone booking → confirmation carries the /t/<token> link (expected — AC #1)', async () => {
    const { service, sent } = build();

    await service.onRideCreated(ride());

    expect(sent).toHaveLength(1);
    expect(sent[0]!.phone).toBe('+37127000001');
    expect(sent[0]!.body).toContain(`${BASE_URL}/t/${TOKEN}`);
    // LV rider: no ?lang — the page defaults to LV.
    expect(sent[0]!.body).not.toContain('?lang=');
  });

  it('non-LV rider gets a ?lang link in their language (edge)', async () => {
    const { service, sent } = build({ language: 'ru' });

    await service.onRideCreated(ride());

    expect(sent[0]!.body).toContain(`/t/${TOKEN}?lang=ru`);
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
});

describe('RideNotificationsService.onStatus', () => {
  it('accepted + phone channel → driver_assigned with name, plate, ETA, link (expected — AC #1)', async () => {
    const { service, sent } = build();

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(sent).toHaveLength(1);
    const body = sent[0]!.body;
    expect(body).toContain('Jānis'); // first name only, never the surname
    expect(body).not.toContain('Bērziņš');
    expect(body).toContain('AB-1234');
    expect(body).toMatch(/~\d+ min/); // a real estimate, not the '?' fallback
    expect(body).toContain(`/t/${TOKEN}`);
  });

  it('accepted + app channel → NO driver_assigned SMS (edge — SMS budget row)', async () => {
    const { service, sent } = build({
      details: notifiable({ bookingChannel: 'app' }),
    });

    await service.onStatus(transitioned('accepted'), 'offered');

    expect(sent).toHaveLength(0);
  });

  it('arrived → driver_arrived SMS on EVERY channel (expected)', async () => {
    const { service, sent } = build({
      details: notifiable({ status: 'arrived', bookingChannel: 'app' }),
    });

    await service.onStatus(transitioned('arrived'), 'arriving');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain('AB-1234');
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
});
