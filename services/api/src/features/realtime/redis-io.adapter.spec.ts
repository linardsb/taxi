import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { rideRoom, RT, type RideStatusEvent } from '@taxi/shared';
import type Redis from 'ioredis';
import { request } from 'node:http';
import {
  createServer as createNetServer,
  type AddressInfo,
  type Socket,
} from 'node:net';
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

const portOf = (app: INestApplication): number =>
  (app.getHttpServer() as { address(): AddressInfo | null }).address()!.port;

describeWithRedis('RedisIoAdapter (cross-node)', () => {
  let nodeA: TestApp;
  let nodeB: TestApp;
  let portA: number;

  async function installAdapter(
    app: INestApplication,
  ): Promise<() => Promise<void>> {
    const adapter = new RedisIoAdapter(app, ['http://localhost:3000']);
    await adapter.connectToRedis(REDIS_TEST_URL!);
    app.useWebSocketAdapter(adapter);
    // The harness runs this on any failed boot, never on the success path
    // (#208). It is needed for one span — an `init()` rejecting before
    // `registerModules()`, where `app.close()` returns without reaching
    // `dispose()` — and is a no-op everywhere else, since `dispose()` clears
    // both references before quitting (#205).
    return () => adapter.dispose();
  }

  beforeAll(async () => {
    nodeA = await createTestApp({ configure: installAdapter });
    nodeB = await createTestApp({ configure: installAdapter });
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

/**
 * `dispose()`, not `close(server)`, is what quits the two clients (#205).
 * `SocketModule.close()` calls `close()` once per io server in its container
 * and `dispose()` unconditionally, so a graph with no gateway registers no
 * server and reaches only the second — the case the suite above cannot show,
 * because every app it builds has `RealtimeGateway` in it.
 */
describeWithRedis('RedisIoAdapter teardown', () => {
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  /** What each client gets to reach `end`, counted from the AWAIT. */
  const END_BUDGET_MS = 2_000;

  /**
   * Starts watching a client for `end` and returns a getter for its status.
   * Split in two because the watch and the budget belong at different points:
   * the watch must be attached before the close that ends the connection,
   * while the budget only means anything from the await. `breakingConfigure`
   * attaches its watches inside `configure`, which runs before `app.init()` —
   * a budget running from there would be timing a whole `AppModule` boot, and
   * would redden the case claiming `close()` was reached when it may never
   * have been.
   *
   * The getter resolves either way — with `end` once the connection actually
   * ends, or with the live status once `END_BUDGET_MS` is up. Not read
   * synchronously after `close()`: `quit()` resolves on the server's `+OK` and
   * the `ready` → `end` transition lands a tick later (`observed`, still
   * `ready` immediately after and `end` within 100 ms). Resolving rather than
   * rejecting is what keeps a client nothing quit reddening its own assertion
   * (`Received: ['ready', 'ready']`) inside the budget rather than on jest's
   * 20 s timeout — and leaves no window where a timer rejects a promise
   * nobody is holding yet, which an aggregate attached later cannot close.
   */
  const ended = (client: Redis): (() => Promise<string>) => {
    const settled = new Promise<string>((resolve) => {
      client.once('end', () => resolve(client.status));
    });
    return () => {
      let timer: NodeJS.Timeout | undefined;
      const budget = new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(client.status), END_BUDGET_MS);
      });
      // Cleared on both arms: a live 2 s handle is exactly the shape that
      // holds jest open past its run (#200).
      return Promise.race([settled, budget]).finally(() => clearTimeout(timer));
    };
  };

  const allEnded = (watches: (() => Promise<string>)[]): Promise<string[]> =>
    Promise.all(watches.map((status) => status()));

  /** A Nest app on an empty module graph: no gateway, so no io server. */
  async function appWithAdapter(): Promise<{
    app: INestApplication;
    clients: Redis[];
  }> {
    const moduleRef = await Test.createTestingModule({}).compile();
    const app = moduleRef.createNestApplication();
    const adapter = new RedisIoAdapter(app, [ALLOWED_ORIGIN]);
    await adapter.connectToRedis(REDIS_TEST_URL!);
    app.useWebSocketAdapter(adapter);
    await app.init();
    // Read BEFORE the close: `dispose()` drops both references on its way out.
    const held = adapter as unknown as { pubClient: Redis; subClient: Redis };
    return { app, clients: [held.pubClient, held.subClient] };
  }

  it('quits both clients on close(), with no gateway to register a server (expected)', async () => {
    const { app, clients } = await appWithAdapter();
    const ending = clients.map(ended);

    await app.close();

    await expect(allEnded(ending)).resolves.toEqual(['end', 'end']);
  });

  it('survives a second close() on the same app (edge)', async () => {
    // Nothing closes an app twice today: every spec assigns `ctx` in
    // `beforeAll`, so a throwing `createTestApp` leaves it undefined and
    // `afterAll` throws a TypeError instead (`observed`, #206 review probe C).
    // What this guards is idempotency — `close(server)` ran for no server on a
    // second close, because `SocketModule.close()` ends by clearing
    // `socketsContainer`, while `dispose()` runs every time and `quit()` on an
    // ended connection rejects, so the references have to be dropped first.
    const { app } = await appWithAdapter();
    await app.close();

    await expect(app.close()).resolves.toBeUndefined();
  });

  /**
   * The harness's two remaining teardown windows, closed in #208. Both are
   * driven from a spec rather than from a mutated `harness.ts`: `configure`
   * runs BEFORE `init()` and is handed the app, so replacing `app.init` or
   * `app.listen` on the instance reproduces the STATE each failure leaves the
   * app in, with the adapter's two clients as the observable. The state, not
   * the span — see the `init()` case.
   */
  describe('createTestApp boot failures (#208)', () => {
    const BOOM = 'probe: boot failed';

    /**
     * A `configure` that installs an adapter, starts watching both clients for
     * `end`, then breaks one step of the boot. The watch has to start in here:
     * the clients do not exist until `connectToRedis` resolves, which is
     * already inside `createTestApp`.
     */
    function breakingConfigure(step: 'init' | 'listen'): {
      configure: (app: INestApplication) => Promise<() => Promise<void>>;
      ending: () => Promise<string[]>;
    } {
      let ending: (() => Promise<string>)[] = [];
      return {
        configure: async (app) => {
          const adapter = new RedisIoAdapter(app, [ALLOWED_ORIGIN]);
          await adapter.connectToRedis(REDIS_TEST_URL!);
          app.useWebSocketAdapter(adapter);
          const held = adapter as unknown as {
            pubClient: Redis;
            subClient: Redis;
          };
          ending = [held.pubClient, held.subClient].map(ended);
          app[step] = () => Promise.reject(new Error(BOOM));
          return () => adapter.dispose();
        },
        ending: () => allEnded(ending),
      };
    }

    it('quits the adapter when init() rejects before registerModules() (expected)', async () => {
      // The one span `app.close()` cannot cover: with no `applicationConfig`
      // yet, `SocketModule.close()` returns at its first line and never
      // reaches `dispose()`. The `configure` teardown is what quits them.
      //
      // Replacing `app.init` wholesale means its body never runs, so the span
      // the name points at — `applyOptions()` → `httpAdapter.init()` → the
      // parser middleware (`nest-application.js:99-102`) — is not entered.
      // The replacement STANDS IN for a rejection inside it: both leave
      // `applicationConfig` unset, which is the only state `close()` reads
      // here (`socket-module.js:50`), so the two are indistinguishable to
      // everything this case asserts. That also means the case is evidence
      // that the teardown closes the window, not evidence about WHERE the
      // window is — the where is established by the source read in
      // `.claude/reports/issue-208-fix.md`'s *Mechanism*.
      const probe = breakingConfigure('init');

      await expect(
        createTestApp({ configure: probe.configure }),
      ).rejects.toThrow(BOOM);

      await expect(probe.ending()).resolves.toEqual(['end', 'end']);
    });

    it('quits the adapter when listen() rejects (edge)', async () => {
      // Past the guard rather than before it: `init()` has run, so this one is
      // `app.close()`'s own doing and the teardown that follows is the no-op
      // second pass #205's ref-clearing makes safe.
      const probe = breakingConfigure('listen');

      await expect(
        createTestApp({ configure: probe.configure }),
      ).rejects.toThrow(BOOM);

      await expect(probe.ending()).resolves.toEqual(['end', 'end']);
    });
  });
});

/**
 * `connectToRedis` cleans up its own partial state (#211).
 *
 * Ungated, and deliberately so: a real Redis would ANSWER the ping, so
 * `REDIS_TEST_URL` is the one thing these cases must not have. They run
 * against a fake instead — see `startFakeRedis`.
 *
 * The defect: the two clients are constructed before the ping and assigned to
 * the adapter's fields only after it, so a rejection left two live ioredis
 * connections that NO code path could reach — `dispose()` saw two `undefined`
 * fields and the caller had already thrown. First sighted in the #107 review
 * (L2, "noted, no change required … Residual is narrow"), again in #116 H1,
 * and finally observed as an exit-124 hang in #209 M1, which filed #211.
 *
 * Expect two `[ioredis] Unhandled error event: ReplyError: NOAUTH …` lines in
 * a green run — one per client, logged by `Redis.silentEmit` because neither
 * client has an `error` listener. That happens on the unfixed tree too and is
 * not this suite's to silence.
 */
describe('RedisIoAdapter.connectToRedis failure (#211)', () => {
  const FAKE_ORIGIN = 'http://localhost:3000';

  /**
   * How long to let a LEAKED client prove itself before sampling the count.
   * `derived`: ioredis's default `retryStrategy` is `Math.min(times * 50,
   * 2000)` ms, so a leaked client reconnects at cumulative 50 / 150 / 300 /
   * 500 ms — four attempts inside this window, i.e. `2 + 2 clients × 4 = 10`
   * on the unfixed tree against 2 on the fixed one. **Condition**: the default
   * strategy and a fake server that accepts immediately. The first divergence
   * is at ~50 ms, so this is ~12× the margin needed; do not shorten it below
   * ~300 ms and do not lengthen it for safety it does not need.
   */
  const SETTLE_MS = 600;

  /**
   * A TCP server that speaks just enough RESP to fail: it accepts, then
   * answers every command with `-NOAUTH`. That is the shape #211 is about — a
   * server that completes the TCP connect and then errors the PING, which is
   * where `connectToRedis` rejects with both clients already constructed.
   *
   * The observable is `accepted`, the CUMULATIVE count of connections the
   * server took. Not the live count: ioredis closes the socket when the ready
   * check fails and reconnects on a backoff, so a live count oscillates
   * 2 → 0 → 2 and reads 0 on BOTH trees at a random sample.
   */
  function startFakeRedis(): Promise<{
    url: string;
    accepted: () => number;
    close: () => Promise<void>;
  }> {
    let accepted = 0;
    const live = new Set<Socket>();
    const server = createNetServer((socket) => {
      accepted += 1;
      live.add(socket);
      socket.on('close', () => live.delete(socket));
      socket.on('error', () => {}); // the client destroys its end; ECONNRESET is expected
      socket.on('data', (chunk: Buffer) => {
        // ONE REPLY PER COMMAND, not per chunk. ioredis pipelines its
        // ready-check `info` with whatever is in the offline queue, so a
        // reply-per-chunk server answers `info` and leaves `ping` waiting
        // forever — a HANG, not a rejection. `observed` 2026-09-14:
        // reply-per-chunk rejected on the first run of a process and hung on
        // runs 2-4 (4/4, both trees), because the batching only happens once
        // the process is warm.
        const commands = chunk.toString().match(/\*\d+\r\n/g)?.length ?? 1;
        socket.write('-NOAUTH Authentication required.\r\n'.repeat(commands));
      });
    });
    return new Promise((resolve) => {
      // Loopback-specific, like the harness's own listen (#193): a wildcard
      // bind over a foreign 127.0.0.1 listener wins and then loses the routing.
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          url: `redis://127.0.0.1:${port}`,
          accepted: () => accepted,
          // The accepted sockets MUST be destroyed: `server.close()` waits for
          // every connection to end before its callback fires, and a client
          // that is still reconnecting never ends one. A leaked `net.Server`
          // is exactly the handle class this ticket exists to stop.
          close: () =>
            new Promise<void>((done) => {
              for (const socket of live) socket.destroy();
              server.close(() => done());
            }),
        });
      });
    });
  }

  /**
   * An adapter on a real but empty module graph, like `appWithAdapter` above.
   * `new RedisIoAdapter({} as INestApplication, …)` would also survive these
   * two cases — `createIOServer` is the only method that reads the app, and
   * nothing here reaches it — but it is a spec that passes until it does not.
   */
  async function bareAdapter(): Promise<{
    app: INestApplication;
    adapter: RedisIoAdapter;
  }> {
    const moduleRef = await Test.createTestingModule({}).compile();
    const app = moduleRef.createNestApplication();
    return { app, adapter: new RedisIoAdapter(app, [FAKE_ORIGIN]) };
  }

  const settleLeak = () => new Promise((r) => setTimeout(r, SETTLE_MS));

  it('closes both clients when the PING rejects (expected)', async () => {
    const fake = await startFakeRedis();
    const { app, adapter } = await bareAdapter();

    try {
      await expect(adapter.connectToRedis(fake.url)).rejects.toThrow('NOAUTH');

      await settleLeak();

      // Exact on purpose. The fix stops the reconnect loop outright rather
      // than slowing it, so a third connection cannot appear inside the
      // window however loaded the machine is: an unexpected 3 is a real
      // defect, not a slow box. Do not relax this to `toBeLessThan(4)`.
      expect(fake.accepted()).toBe(2);
    } finally {
      // In a `finally` so a red assertion does not leak the server on top of
      // the clients — that would put a second handle class into the "jest did
      // not exit" signature the revert probe reads.
      await fake.close();
      await app.close();
    }
  });

  it('leaves the adapter holding nothing, so dispose() afterwards is a no-op (edge)', async () => {
    const fake = await startFakeRedis();
    const { app, adapter } = await bareAdapter();

    try {
      await expect(adapter.connectToRedis(fake.url)).rejects.toThrow('NOAUTH');

      await expect(adapter.dispose()).resolves.toBeUndefined();

      // This is WHY the fix cleans in place rather than assigning the fields
      // before the ping: assigning first would make the clients reachable by
      // `dispose()`, and in the case that matters nothing ever calls it.
      const held = adapter as unknown as {
        pubClient?: Redis;
        subClient?: Redis;
      };
      expect(held.pubClient).toBeUndefined();
      expect(held.subClient).toBeUndefined();
    } finally {
      await fake.close();
      await app.close();
    }
  });

  it('strands nothing when a configure fails at connectToRedis (failure)', async () => {
    const fake = await startFakeRedis();

    try {
      await expect(
        createTestApp({
          configure: async (app) => {
            const adapter = new RedisIoAdapter(app, [FAKE_ORIGIN]);
            await adapter.connectToRedis(fake.url); // rejects
            app.useWebSocketAdapter(adapter); // never reached
          },
        }),
      ).rejects.toThrow('NOAUTH');

      await settleLeak();

      expect(fake.accepted()).toBe(2);
    } finally {
      await fake.close();
    }
  });
});
