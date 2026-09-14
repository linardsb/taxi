import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Makes rooms cluster-wide: without it, an emit only reaches sockets attached
 * to the node that issued it. The two ioredis clients must be SEPARATE
 * connections — a subscribed client cannot issue other commands, which is why
 * the sub client is a `.duplicate()`.
 *
 * It also owns Socket.IO's CORS, because this is the only place with both the
 * env and the server at construction time. `app.enableCors()` cannot do it:
 * that configures Nest's Express adapter, while engine.io registers its own
 * `request` listener on the same http.Server and intercepts `/socket.io/*`
 * before any Express middleware runs.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  /**
   * `corsOrigins` is required rather than defaulted: Socket.IO v4 ships CORS
   * disabled, and the failure mode is a browser handshake that dies looking
   * like an auth error. A silent default is what made that possible once.
   */
  constructor(
    app: INestApplication,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  async connectToRedis(url: string): Promise<void> {
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.ping(), subClient.ping()]);
    this.pubClient = pubClient;
    this.subClient = subClient;
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // Spread first so `cors` wins: the env is the single source of truth for
    // which origins may connect, and a gateway decorator must not widen it.
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins },
    }) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  /**
   * The two clients are quit HERE rather than in `close(server)`:
   * `SocketModule.close()` calls the adapter's `close()` once per REGISTERED io
   * server and then `dispose()` unconditionally, so a graph with no gateway —
   * nothing in `socketsContainer` — would never reach a quit that lived in
   * `close()` and would hold both connections open for the life of the process.
   * The inherited `dispose()` is a no-op, so overriding it costs nothing else.
   *
   * The fields are cleared BEFORE the quit, which keeps a second `app.close()`
   * a no-op rather than a `quit()` on an ended connection. `close(server)` got
   * that for free — `SocketModule.close()` clears its container, so the second
   * pass called it for no server at all — and `dispose()` runs every time.
   */
  override async dispose(): Promise<void> {
    const pub = this.pubClient;
    const sub = this.subClient;
    this.pubClient = undefined;
    this.subClient = undefined;
    await Promise.all([pub?.quit(), sub?.quit()]);
  }
}
