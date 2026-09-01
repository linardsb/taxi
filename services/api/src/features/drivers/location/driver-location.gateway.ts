import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
  driverLocationPingSchema,
  driverRoom,
  RT,
  type DriverLocationAck,
} from '@taxi/shared';
import type { AuthedSocket, RealtimeServer } from '../../realtime';
import { DriversService } from '../drivers.service';
import { DriverLocationService } from './driver-location.service';

/**
 * The API's first inbound socket handler.
 *
 * VERIFIED, and load-bearing: an options-less `@WebSocketGateway()` here reuses
 * the server `RealtimeGateway` created — Nest keys cached servers on
 * `{port, path}` only — INCLUDING the JWT handshake middleware registered in
 * its `afterInit`. driver-location.gateway.spec.ts proves it by asserting an
 * unauthenticated handshake is still refused.
 *
 * So: do NOT give this class an `afterInit`, a `handleConnection`, or
 * `@WebSocketGateway({...options})`. Any of the three either double-registers
 * middleware on the shared server or forks a second server with NO
 * authentication at all.
 *
 * `handleDisconnect` is NOT in that prohibition: it registers a per-socket
 * listener rather than server-wide middleware, and this is the only gateway
 * that declares one, so nothing fires twice.
 */
@WebSocketGateway()
export class DriverLocationGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(DriverLocationGateway.name);

  /** The shared server — the same instance RealtimeGateway holds. */
  @WebSocketServer() private readonly server!: RealtimeServer;

  constructor(
    private readonly locations: DriverLocationService,
    private readonly drivers: DriversService,
  ) {}

  /**
   * Clears presence when a driver's last socket goes away (#38). Without it a
   * force-quit left a ghost `online` in Postgres and in the three
   * `drivers:*:<city>` keys indefinitely — invisible to dispatch thanks to the
   * freshness filter, but wrong on #18's board and in #20's stats, and the keys
   * grew monotonically with driver churn.
   *
   * The last-socket check is the whole difficulty: a driver legitimately holds
   * several sockets (two devices, or a reconnect racing its predecessor), and
   * clearing on the first close would knock them offline mid-shift.
   * socket.io removes a socket from its rooms BEFORE emitting `disconnect` —
   * that is precisely what `disconnecting` exists for — so this counts only the
   * driver's OTHER sockets. `fetchSockets()` is cluster-wide under the Redis
   * adapter, so a second socket on another node still counts.
   */
  async handleDisconnect(client: AuthedSocket): Promise<void> {
    const user = client.data.user;
    if (user?.role !== 'driver') return;

    // Nothing here may throw: a rejection on a disconnect handler is an
    // unhandled rejection with no socket left to report it to. Same call as
    // `handleLocation` makes, for the same reason.
    try {
      const others = await this.server.in(driverRoom(user.sub)).fetchSockets();
      if (others.length > 0) return;

      await this.drivers.markOfflineByServer(user.sub, 'socket_disconnected');
    } catch (err) {
      this.logger.error({
        event: 'driver.presence.disconnect_cleanup_failed',
        driverId: user.sub,
        reason: err instanceof Error ? err.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
  }

  /**
   * NEVER throws. A `WsException` emits an `exception` frame and a raw zod
   * error is worse — a driver mid-shift must not be disturbed by one bad frame.
   * Log and return.
   *
   * Returns the ack (#14): Nest hands a non-nil return value to the client's
   * callback when the emit supplied one (`@nestjs/platform-socket.io`
   * io-adapter), and drops it when the emit was fire-and-forget — so the
   * scripted driver in `scripts/mint-tracked-ride.ts` keeps working unchanged.
   * A non-driver is answered `malformed`, not `not_online`: a rider emitting
   * here is a broken client, and the answer must not read as a presence fact.
   *
   * The global `JwtAuthGuard` cannot help here: it refuses non-HTTP contexts by
   * design, so `client.data.user` (set by the handshake) is the only identity
   * source. It was verified AT CONNECT, and `RealtimeGateway`'s expiry sweep
   * (#37) disconnects the socket once that token expires — so the claims below
   * are behind a token that is still valid to within one sweep interval.
   */
  @SubscribeMessage(RT.driverLocation)
  async handleLocation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: unknown,
  ): Promise<DriverLocationAck> {
    const user = client.data.user;
    if (user?.role !== 'driver') {
      this.logger.warn({
        event: 'driver.location.ping_rejected',
        driverId: user?.sub ?? null,
        reason: 'not_a_driver',
        at: new Date().toISOString(),
      });
      return { accepted: false, reason: 'malformed' };
    }

    const parsed = driverLocationPingSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn({
        event: 'driver.location.ping_rejected',
        driverId: user.sub,
        reason: 'malformed_payload',
        at: new Date().toISOString(),
      });
      return { accepted: false, reason: 'malformed' };
    }

    // The third path that must not throw, and the only one that can: `ingest`
    // rejects whenever Redis is unreachable, and an unhandled rejection here
    // becomes an `exception` frame per ping — a frame storm aimed at every
    // driver mid-shift precisely when the system is already unwell.
    //
    // Deliberately the OPPOSITE call from `findNearest`, which lets a store
    // failure propagate so dispatch never reads an outage as "no drivers in
    // Rīga". Swallowing is right here (one driver's position, self-healing on
    // the next ping) and wrong there. Do not unify them.
    try {
      return await this.locations.ingest(user.sub, parsed.data);
    } catch (err) {
      this.logger.error({
        event: 'driver.location.ingest_failed',
        driverId: user.sub,
        reason: err instanceof Error ? err.message : 'unknown',
        at: new Date().toISOString(),
      });
      // Kept and retried on the phone — the outage is ours, not the fix's.
      return { accepted: false, reason: 'store_unavailable' };
    }
  }
}
