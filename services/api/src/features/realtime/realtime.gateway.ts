import { Inject, Logger } from '@nestjs/common';
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
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer() server!: RealtimeServer;

  constructor(
    private readonly tokens: AuthTokenService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

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
