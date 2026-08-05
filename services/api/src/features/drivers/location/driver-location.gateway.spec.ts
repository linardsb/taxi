import { drivers } from '@taxi/db';
import {
  driverRoom,
  RT,
  type DriverLocationEvent,
  type DriverLocationPing,
  type JwtClaims,
} from '@taxi/shared';
import { eq } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'socket.io-client';
import {
  closeClients,
  connectClient,
  createTestApp,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../../test/harness';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { AuthTokenService } from '../../auth/auth-token.service';
import type { AuthedSocket } from '../../realtime';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import type { DriversService } from '../drivers.service';
import { DriverLocationGateway } from './driver-location.gateway';
import type { DriverLocationService } from './driver-location.service';

const DRIVER_ID = 'aa1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e11';
const RIDER_ID = 'bb1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e12';
const DISPATCHER_ID = 'cc1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e13';
const RIGA = { lat: 56.9512, lng: 24.1136 };

const validPing = () => ({ location: RIGA, at: new Date().toISOString() });

describe('driver location gateway (integration)', () => {
  let ctx: TestApp;
  let port: number;
  let cityId: string;
  let tokens: AuthTokenService;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
    const http = ctx.app.getHttpServer() as { address(): AddressInfo | null };
    port = http.address()!.port;
    tokens = ctx.app.get(AuthTokenService);
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
  });

  // Order matters: clients first, app second, or jest hangs on open handles.
  afterEach(closeClients);
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(() => {
    ctx.locations.recorded.length = 0;
  });

  const tokenFor = async (
    id: string,
    role: 'driver' | 'rider' | 'dispatcher',
  ) => (await tokens.issue({ id, role })).accessToken;

  /**
   * The driver is marked online directly in the store: going through
   * PUT /drivers/me/status would drag Postgres and a vehicle into a socket test.
   */
  const onlineDriver = async (id = DRIVER_ID): Promise<Socket> => {
    await ctx.locations.markOnline(cityId, id);
    return connectClient(port, await tokenFor(id, 'driver'));
  };

  /**
   * THE load-bearing case for the whole slice. `DriverLocationGateway` declares
   * `@WebSocketGateway()` with no options, which Nest resolves to the server
   * `RealtimeGateway` already created — handshake middleware and all. If it
   * ever forked its own server instead, that server would have NO
   * authentication and this connection would succeed. Do not delete this test.
   */
  it('refuses an unauthenticated handshake on the shared server (failure)', async () => {
    await expect(connectClient(port)).rejects.toThrow('unauthorized');
  });

  it("records an online driver's ping and fans it to the dispatch board (expected)", async () => {
    // End-to-end proof that the second gateway shares the first's
    // authenticated server: identity comes from the JWT the handshake verified.
    const dispatcher = await connectClient(
      port,
      await tokenFor(DISPATCHER_ID, 'dispatcher'),
    );
    const received = new Promise<DriverLocationEvent>((resolve) => {
      dispatcher.once(RT.driverLocation, resolve);
    });

    const driver = await onlineDriver();
    driver.emit(RT.driverLocation, validPing());

    const payload = await received;
    expect(payload.driverId).toBe(DRIVER_ID);
    expect(payload.location).toEqual(RIGA);
    expect(ctx.locations.recorded).toHaveLength(1);
    expect(ctx.locations.recorded[0]!.driverId).toBe(DRIVER_ID);
  });

  /**
   * The class's stated contract, and the one path that can break it: `ingest`
   * rejects when Redis is unreachable, and an unhandled rejection is an
   * `exception` frame per ping. Asserted at the socket because the frame is
   * what the driver app would actually see.
   */
  it('sends no exception frame when the store fails, and keeps the socket up (failure)', async () => {
    const driver = await onlineDriver();
    const frames: unknown[] = [];
    driver.on('exception', (frame: unknown) => frames.push(frame));

    // `spyOn` keeps the original as the fallback, so only the FIRST ping fails.
    const spy = jest
      .spyOn(ctx.locations, 'record')
      .mockRejectedValueOnce(new Error('redis down'));
    try {
      driver.emit(RT.driverLocation, validPing()); // rejects inside ingest
      // Same socket, and `record` is reached with no await before it, so the
      // failing ping is call 1 — a recorded second ping means it was handled.
      driver.emit(RT.driverLocation, validPing());

      await waitFor(() => ctx.locations.recorded.length > 0);
      expect(frames).toEqual([]);
      expect(driver.connected).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * #38's cases need the Postgres row as well as the store, because the ghost
   * this fixes was `status = 'online'` in BOTH. Provisioned directly rather
   * than through PUT /drivers/me/status, which would drag a vehicle and the
   * whole HTTP surface into a socket test.
   */
  const dbDriver = async (n: number) => {
    const user = await insertUser(ctx.db, {
      phone: phoneFor('+371230', n),
      role: 'driver',
    });
    await ctx.db
      .insert(drivers)
      .values({ userId: user.id, status: 'online' })
      .onConflictDoNothing();
    await ctx.locations.markOnline(cityId, user.id);
    return {
      id: user.id,
      connect: async () =>
        connectClient(port, await tokenFor(user.id, 'driver')),
      status: async () =>
        (
          await ctx.db.select().from(drivers).where(eq(drivers.userId, user.id))
        )[0]?.status,
      socketsInRoom: async () =>
        (
          await ctx.app
            .get(RealtimeGateway)
            .server.in(driverRoom(user.id))
            .fetchSockets()
        ).length,
    };
  };

  it('takes a driver offline when their last socket goes away (expected)', async () => {
    const d = await dbDriver(1);
    const socket = await d.connect();

    socket.close();

    await waitFor(async () => (await d.status()) === 'offline');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
  });

  it('keeps a driver online while another of their sockets survives (edge — the multi-socket wrinkle)', async () => {
    const d = await dbDriver(2);
    const first = await d.connect();
    await d.connect(); // a second device, or a reconnect racing its predecessor
    expect(await d.socketsInRoom()).toBe(2);

    first.close();

    // Waiting on the ROOM, not on a timer: once the count is 1 the server has
    // finished processing that disconnect, so a presence clear would already
    // have happened. This is also the socket.io behaviour the last-socket check
    // rests on — that rooms are left BEFORE `disconnect` fires — so assert it
    // directly rather than letting a change there make the check vacuous.
    await waitFor(async () => (await d.socketsInRoom()) === 1);
    expect(await d.status()).toBe('online');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(true);
  });

  it('leaves an on_ride driver alone when their socket drops (edge — #11 owns that status)', async () => {
    const d = await dbDriver(3);
    await ctx.db
      .update(drivers)
      .set({ status: 'on_ride' })
      .where(eq(drivers.userId, d.id));
    const socket = await d.connect();

    socket.close();

    await waitFor(async () => (await d.socketsInRoom()) === 0);
    // A driver whose app crashes mid-ride must not be dropped off the ride.
    expect(await d.status()).toBe('on_ride');
  });

  it('ignores a malformed ping and keeps the socket up (failure)', async () => {
    const driver = await onlineDriver();

    driver.emit(RT.driverLocation, {
      location: { lat: 999, lng: 0 },
      at: 'nope',
    });
    // Same socket, so ordering is guaranteed — and the rejection path returns
    // before any await, so a recorded second ping means the first was handled.
    driver.emit(RT.driverLocation, validPing());

    await waitFor(() => ctx.locations.recorded.length > 0);
    expect(ctx.locations.recorded).toHaveLength(1);
    expect(ctx.locations.recorded[0]!.location).toEqual(RIGA);
    expect(driver.connected).toBe(true);
  });
});

/**
 * The two branches that assert an ABSENCE — the store was not written — are
 * unit tests on purpose. The role check used to be a socket test that emitted
 * from a rider and a driver on two connections and then waited only for the
 * driver's ping: nothing ordered the rider's frame before the assertion, so
 * deleting the role check left it green. A direct call cannot race.
 */
describe('driver location gateway (unit)', () => {
  const claims = (role: 'driver' | 'rider'): JwtClaims => ({
    sub: RIDER_ID,
    role,
    iat: 0,
    exp: 0,
  });
  const socketWith = (user?: JwtClaims): AuthedSocket =>
    ({ data: { user } }) as AuthedSocket;

  const build = () => {
    const ingest = jest.fn<Promise<void>, [string, DriverLocationPing]>();
    ingest.mockResolvedValue(undefined);
    const clearPresence = jest.fn<Promise<void>, [string]>();
    clearPresence.mockResolvedValue(undefined);
    const gateway = new DriverLocationGateway(
      { ingest } as unknown as DriverLocationService,
      {
        clearPresenceOnDisconnect: clearPresence,
      } as unknown as DriversService,
    );
    return { gateway, ingest, clearPresence };
  };

  it('never reaches the store from a rider-role socket (edge)', async () => {
    const { gateway, ingest } = build();

    await gateway.handleLocation(socketWith(claims('rider')), validPing());

    expect(ingest).not.toHaveBeenCalled();
  });

  it('never reaches the store from a socket with no claims at all (edge)', async () => {
    const { gateway, ingest } = build();

    await gateway.handleLocation(socketWith(undefined), validPing());

    expect(ingest).not.toHaveBeenCalled();
  });

  it('never clears presence for a non-driver disconnect (edge)', async () => {
    const { gateway, clearPresence } = build();

    // A rider or dispatcher hanging up must not touch driver presence — and
    // the role check has to come FIRST, before the room lookup, or this would
    // dereference the server that only exists once Nest has wired the gateway.
    await gateway.handleDisconnect(socketWith(claims('rider')));
    await gateway.handleDisconnect(socketWith(undefined));

    expect(clearPresence).not.toHaveBeenCalled();
  });

  it('resolves rather than rejecting when ingest fails (failure — the NEVER throws contract)', async () => {
    const { gateway, ingest } = build();
    ingest.mockRejectedValue(new Error('redis down'));

    // `rejects` here is what Nest turns into an `exception` frame.
    await expect(
      gateway.handleLocation(socketWith(claims('driver')), validPing()),
    ).resolves.toBeUndefined();
    expect(ingest).toHaveBeenCalledTimes(1);
  });
});

/** Polls `check` up to `timeoutMs`; the handler is async relative to emit. */
async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for: ${check.toString()}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
