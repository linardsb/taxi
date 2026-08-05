import type { INestApplication } from '@nestjs/common';
import { rideRoom, RT, type RideStatusEvent } from '@taxi/shared';
import type { AddressInfo } from 'node:net';
import {
  closeClients,
  connectClient,
  createTestApp,
  type TestApp,
} from '../../../test/harness';
import { AuthTokenService } from '../auth';
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

describeWithRedis('RedisIoAdapter (cross-node)', () => {
  let nodeA: TestApp;
  let nodeB: TestApp;
  let portA: number;

  async function installAdapter(app: INestApplication): Promise<void> {
    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis(REDIS_TEST_URL!);
    app.useWebSocketAdapter(adapter);
  }

  beforeAll(async () => {
    nodeA = await createTestApp({ configure: installAdapter });
    nodeB = await createTestApp({ configure: installAdapter });
    await nodeA.app.listen(0);
    await nodeB.app.listen(0);
    portA = (
      nodeA.app.getHttpServer() as { address(): AddressInfo | null }
    ).address()!.port;
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
