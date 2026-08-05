import type { INestApplication } from '@nestjs/common';
import { rideRoom, RT, type RideStatusEvent } from '@taxi/shared';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  closeClients,
  connectClient,
  createTestApp,
  type TestApp,
} from '../../../test/harness';
import { AuthTokenService } from '../auth/auth-token.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { RedisIoAdapter } from './redis-io.adapter';

/**
 * Skipped unless a Redis is reachable — :6379 and :6380 are taken by other
 * projects on the primary dev machine, so the default gate must never depend
 * on this. Run it deliberately:
 *   REDIS_PORT=6381 docker compose up -d --wait redis
 *   REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run test --filter @taxi/api
 */
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
const describeWithRedis = REDIS_TEST_URL ? describe : describe.skip;

const RIDER_ID = 'a11f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4f01';
const RIDE_ID = 'b11f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4f02';
const ORDER_ID = 'c11f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4f03';

/** Lets the adapter's pub/sub round trip settle before asserting. */
const settle = () => new Promise((r) => setTimeout(r, 250));

const portOf = (app: INestApplication): number =>
  (app.getHttpServer() as { address(): AddressInfo | null }).address()!.port;

describeWithRedis('RedisIoAdapter (cross-node)', () => {
  let nodeA: TestApp;
  let nodeB: TestApp;
  let portA: number;

  async function installAdapter(app: INestApplication): Promise<void> {
    const adapter = new RedisIoAdapter(app, ['http://localhost:3000']);
    await adapter.connectToRedis(REDIS_TEST_URL!);
    app.useWebSocketAdapter(adapter);
  }

  beforeAll(async () => {
    nodeA = await createTestApp({ configure: installAdapter });
    nodeB = await createTestApp({ configure: installAdapter });
    await nodeA.app.listen(0);
    await nodeB.app.listen(0);
    portA = portOf(nodeA.app);
  });

  afterEach(closeClients);
  afterAll(async () => {
    // close() must quit both ioredis clients or the suite hangs.
    await nodeA.app.close();
    await nodeB.app.close();
  });

  const riderToken = async (ctx: TestApp) =>
    (await ctx.app.get(AuthTokenService).issue({ id: RIDER_ID, role: 'rider' }))
      .accessToken;

  it("delivers node B's emit to a client connected to node A (expected)", async () => {
    const client = await connectClient(portA, await riderToken(nodeA));

    // Issued on B for a socket that lives on A — socketsJoin is cluster-wide.
    nodeB.app.get(RealtimeService).joinRideRoom(RIDER_ID, RIDE_ID);
    await settle();

    const received = new Promise<RideStatusEvent>((resolve) => {
      client.once(RT.rideStatus, (payload: RideStatusEvent) =>
        resolve(payload),
      );
    });

    const at = '2026-08-04T12:00:00.000Z';
    nodeB.app.get(RealtimeService).emitToRide(RIDE_ID, RT.rideStatus, {
      rideId: RIDE_ID,
      orderId: ORDER_ID,
      status: 'accepted',
      previousStatus: 'requested',
      reason: null,
      at,
    });

    expect((await received).at).toBe(at);
  });

  it("counts node A's socket in a room queried from node B (edge)", async () => {
    await connectClient(portA, await riderToken(nodeA));

    nodeB.app.get(RealtimeService).joinRideRoom(RIDER_ID, RIDE_ID);
    await settle();

    // fetchSockets() is cluster-wide too: asked on B, answered about A.
    const sockets = await nodeB.app
      .get(RealtimeGateway)
      .server.in(rideRoom(RIDE_ID))
      .fetchSockets();
    expect(sockets).toHaveLength(1);
  });
});

/**
 * No Redis needed — the adapter attaches one only if `connectToRedis` ran, so
 * these run on the default gate. That matters: this is the suite that stops
 * #18's dispatch console failing its handshake and reading as an auth bug.
 *
 * Asserted on the RESPONSE HEADERS, never on whether a Node client connects.
 * `socket.io-client` under Node sends no `Origin`, so a connection test passes
 * identically with CORS configured and with it missing — the same blindness as
 * pinning `transports: ['websocket']`, just better disguised.
 */
describe('RedisIoAdapter CORS', () => {
  const ALLOWED = 'http://localhost:3000'; // the dispatch console (#18)
  let ctx: TestApp;
  let port: number;

  /** The engine.io handshake a browser issues before any upgrade. */
  function handshake(
    origin?: string,
  ): Promise<{ status: number; allowOrigin?: string }> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/socket.io/?EIO=4&transport=polling',
          headers: origin ? { origin } : {},
        },
        (res) => {
          res.resume(); // drain, or the socket never closes
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              allowOrigin: res.headers['access-control-allow-origin'],
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp({
      configure: (app) => {
        app.useWebSocketAdapter(new RedisIoAdapter(app, [ALLOWED]));
        return Promise.resolve();
      },
    });
    await ctx.app.listen(0);
    port = portOf(ctx.app);
  });

  afterEach(closeClients);
  afterAll(async () => {
    await ctx.app.close();
  });

  it('allows a configured browser origin through the polling handshake (expected)', async () => {
    const res = await handshake(ALLOWED);

    expect(res.status).toBe(200);
    expect(res.allowOrigin).toBe(ALLOWED);
  });

  it('does not allow an origin outside CORS_ORIGINS (failure)', async () => {
    // The half a wildcard would break. `cors: { origin: '*' }` also makes the
    // case above pass, so without this one the suite would bless exactly the
    // fix that hands every site on the internet an authenticated socket.
    const res = await handshake('http://evil.example');

    expect(res.allowOrigin).toBeUndefined();
  });

  it('completes a real connection over the polling transport (edge)', async () => {
    // websocket is CORS-exempt, so it proves nothing here; polling is what
    // socket.io-client actually starts with in a browser.
    const token = (
      await ctx.app.get(AuthTokenService).issue({ id: RIDER_ID, role: 'rider' })
    ).accessToken;

    const client = await connectClient(port, token, ['polling']);

    expect(client.connected).toBe(true);
    expect(client.io.engine.transport.name).toBe('polling');

    // Closed HERE, and awaited, rather than left to afterEach. A polling client
    // always holds a long-poll request open; if one is still in flight when
    // jest tears the environment down, engine.io-client's error path lazily
    // `require`s a module and jest fails the RUN — every test green, exit 1.
    // CI caught this and the local run did not, because it is a timing race
    // against teardown. websocket clients do not have the problem.
    await new Promise<void>((resolve) => {
      client.once('disconnect', () => resolve());
      client.close();
    });
    // One more turn, so the aborted poll's callbacks land inside the test.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
