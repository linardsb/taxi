import { RT, type DriverLocationEvent } from '@taxi/shared';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'socket.io-client';
import {
  closeClients,
  connectClient,
  createTestApp,
  type TestApp,
} from '../../../../test/harness';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { AuthTokenService } from '../../auth/auth-token.service';

const DRIVER_ID = 'aa1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e11';
const RIDER_ID = 'bb1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e12';
const DISPATCHER_ID = 'cc1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e13';
const RIGA = { lat: 56.9512, lng: 24.1136 };

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

  const validPing = () => ({ location: RIGA, at: new Date().toISOString() });

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

  it('ignores a ping from a rider-role socket (edge)', async () => {
    // Even with the rider's id marked online, so the store itself would accept
    // the write — the role check is what stops it.
    await ctx.locations.markOnline(cityId, RIDER_ID);
    const rider = await connectClient(port, await tokenFor(RIDER_ID, 'rider'));
    const driver = await onlineDriver();

    rider.emit(RT.driverLocation, validPing());
    driver.emit(RT.driverLocation, validPing()); // the round trip we wait on

    await waitFor(() => ctx.locations.recorded.length > 0);
    expect(ctx.locations.recorded.map((r) => r.driverId)).toEqual([DRIVER_ID]);
    expect(rider.connected).toBe(true);
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

/** Polls `check` up to `timeoutMs`; the handler is async relative to emit. */
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for: ${check.toString()}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
