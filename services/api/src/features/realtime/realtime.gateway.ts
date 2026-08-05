import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type {
  ClientToServerEvents,
  JwtClaims,
  ServerToClientEvents,
} from '@taxi/shared';
import type { Server, Socket } from 'socket.io';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { AuthTokenService } from '../auth';
import { roomsOnConnect } from './room-policy';

/** The socket's `data` bag, widened with the claims the handshake verified. */
type SocketData = { user?: JwtClaims };
type InterServerEvents = Record<string, never>;

export type AuthedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

function bearerFrom(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' ? token : undefined;
}

/**
 * There are deliberately NO @SubscribeMessage handlers here — this gateway
 * has no inbound surface at all in #7. #8 adds the first one and must
 * authorize from `socket.data.user`, not from the HTTP JwtAuthGuard.
 */
/**
 * How often expired sockets are swept off. A socket outlives its token by at
 * most this long, which is the price of not paying for a per-socket timer.
 */
const TOKEN_SWEEP_INTERVAL_MS = 60_000;

@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private sweep?: NodeJS.Timeout;

  @WebSocketServer() server!: RealtimeServer;

  constructor(
    private readonly tokens: AuthTokenService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
  }

  /**
   * Disconnects every LOCAL socket whose token has expired (#37).
   *
   * The JWT is verified once, in the handshake, and `client.data.user` is never
   * re-checked afterwards. `JWT_EXPIRES_IN` defaults to 30d and there is no
   * revocation list, so without this a continuously-connected socket keeps its
   * `role` claim indefinitely — and #8's location gateway makes an
   * authorization decision from exactly that claim.
   *
   * Local only: every node sweeps its own sockets, so a cluster-wide fetch
   * would just have each node racing to disconnect the others' sockets.
   *
   * `nowMs` is a parameter so the behaviour can be tested against a real socket
   * without waiting 30 days or forging a token.
   */
  async disconnectExpiredSockets(nowMs: number = Date.now()): Promise<void> {
    const nowSeconds = Math.floor(nowMs / 1000);

    for (const socket of await this.server.local.fetchSockets()) {
      const user = socket.data.user;
      // Fail closed: claims absent (which the middleware should make
      // impossible) is treated the same as claims expired.
      if (user && user.exp > nowSeconds) continue;

      this.logger.warn({
        event: 'realtime.gateway.token_expired',
        userId: user?.sub ?? null,
        at: new Date(nowMs).toISOString(),
      });
      socket.disconnect(true);
    }
  }

  /**
   * JWT is verified in the handshake, so a rejected connection never reaches
   * a handler. `server.use()` is synchronous while verify() is async, hence
   * resolving the promise inside and calling next() in both branches.
   */
  afterInit(server: RealtimeServer): void {
    server.use((socket, next) => {
      const auth = socket.handshake.auth as { token?: string } | undefined;
      const token =
        auth?.token ?? bearerFrom(socket.handshake.headers.authorization);
      void this.tokens
        .verify(token ?? '')
        .then((claims) => {
          socket.data.user = claims;
          next();
        })
        .catch(() => {
          this.logger.warn({
            event: 'realtime.gateway.connection_rejected',
            reason: token ? 'invalid_token' : 'missing_token',
            at: new Date().toISOString(),
          });
          next(new Error('unauthorized'));
        });
    });

    // A sweep rather than a per-socket `setTimeout(msUntilExpiry)`: with the
    // 30d default that delay exceeds setTimeout's 2^31-1 ms ceiling, where Node
    // silently fires the timer IMMEDIATELY — every socket would be disconnected
    // the moment it connected.
    this.sweep = setInterval(
      () => void this.disconnectExpiredSockets(),
      TOKEN_SWEEP_INTERVAL_MS,
    );
    // Never a reason to hold the process open — or to keep jest alive.
    this.sweep.unref();
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    const user = client.data.user; // set by the handshake middleware
    if (!user) {
      client.disconnect(true); // belt and braces — the middleware already refused
      return;
    }

    const rooms = roomsOnConnect(user, { cityId: this.env.DEFAULT_CITY_ID });
    // `join` is sync with the in-memory adapter but returns a Promise under
    // the Redis one — awaiting keeps room membership settled either way.
    await client.join(rooms);

    this.logger.log({
      event: 'realtime.gateway.rooms_joined',
      userId: user.sub,
      role: user.role,
      rooms,
      at: new Date().toISOString(),
    });
  }
}
