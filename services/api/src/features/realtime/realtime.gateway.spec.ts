import {
  dispatchRoom,
  driverRoom,
  rideRoom,
  RT,
  type RideStatusEvent,
} from '@taxi/shared';
import type { AddressInfo } from 'node:net';
import {
  closeClients,
  connectClient,
  createTestApp,
  type TestApp,
} from '../../../test/harness';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { AuthTokenService } from '../auth/auth-token.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

const DRIVER_ID = 'aa1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e01';
const DISPATCHER_ID = 'bb1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e02';
const RIDER_ID = 'cc1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e03';
const RIDE_ID = 'dd1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e04';
const ORDER_ID = 'ee1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e05';

describe('realtime gateway (integration)', () => {
  let ctx: TestApp;
  let gateway: RealtimeGateway;
  let service: RealtimeService;
  let port: number;
  let cityId: string;
  let tokens: AuthTokenService;

  beforeAll(async () => {
    ctx = await createTestApp();
    // Deliberately NOT RedisIoAdapter: the in-memory adapter is correct for a
    // single-process test. The adapter has its own opt-in spec.
    await ctx.app.listen(0);
    const http = ctx.app.getHttpServer() as { address(): AddressInfo | null };
    port = http.address()!.port;

    gateway = ctx.app.get(RealtimeGateway);
    service = ctx.app.get(RealtimeService);
    tokens = ctx.app.get(AuthTokenService);
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
  });

  // Order matters: clients first, app second, or jest hangs on open handles.
  afterEach(closeClients);
  afterAll(async () => {
    await ctx.app.close();
  });

  /** The gateway reads identity from the JWT alone — no user row required. */
  const tokenFor = async (
    id: string,
    role: 'driver' | 'dispatcher' | 'rider',
  ) => (await tokens.issue({ id, role })).accessToken;

  it('rejects a handshake with no token and with a garbage token (failure)', async () => {
    await expect(connectClient(port)).rejects.toThrow('unauthorized');
    await expect(connectClient(port, 'not-a-jwt')).rejects.toThrow(
      'unauthorized',
    );
  });

  it('places an authenticated driver in its own driver room (expected)', async () => {
    await connectClient(port, await tokenFor(DRIVER_ID, 'driver'));

    const sockets = await gateway.server
      .in(driverRoom(DRIVER_ID))
      .fetchSockets();
    expect(sockets).toHaveLength(1);
  });

  it('keeps a driver out of the dispatch board a dispatcher can reach (edge — the AC over the wire)', async () => {
    await connectClient(port, await tokenFor(DRIVER_ID, 'driver'));
    expect(
      await gateway.server.in(dispatchRoom(cityId)).fetchSockets(),
    ).toHaveLength(0);

    await connectClient(port, await tokenFor(DISPATCHER_ID, 'dispatcher'));
    expect(
      await gateway.server.in(dispatchRoom(cityId)).fetchSockets(),
    ).toHaveLength(1);
  });

  it('delivers a server-orchestrated ride-room emit with ISO timestamps (expected)', async () => {
    const client = await connectClient(port, await tokenFor(RIDER_ID, 'rider'));

    service.joinRideRoom(RIDER_ID, RIDE_ID);
    expect(
      await gateway.server.in(rideRoom(RIDE_ID)).fetchSockets(),
    ).toHaveLength(1);

    const received = new Promise<RideStatusEvent>((resolve) => {
      client.once(RT.rideStatus, (payload: RideStatusEvent) =>
        resolve(payload),
      );
    });

    const at = '2026-08-04T10:00:00.000Z';
    service.emitToRide(RIDE_ID, RT.rideStatus, {
      rideId: RIDE_ID,
      orderId: ORDER_ID,
      status: 'accepted',
      previousStatus: 'requested',
      reason: null,
      at,
    });

    const payload = await received;
    expect(payload.status).toBe('accepted');
    expect(payload.at).toBe(at); // still a string on the wire, not a Date
  });

  it('throws when an emit payload carries a Date instead of an ISO string (failure)', () => {
    expect(() =>
      service.emitToRide(RIDE_ID, RT.rideStatus, {
        rideId: RIDE_ID,
        orderId: ORDER_ID,
        status: 'accepted',
        previousStatus: null,
        reason: null,
        // @ts-expect-error — the type system already forbids a Date here; this
        // asserts the RT_EVENT_SCHEMAS runtime backstop fires too.
        at: new Date(),
      }),
    ).toThrow();
  });
});
