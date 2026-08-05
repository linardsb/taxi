import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { driverLocationPingSchema, RT } from '@taxi/shared';
import type { AuthedSocket } from '../../realtime';
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
 */
@WebSocketGateway()
export class DriverLocationGateway {
  private readonly logger = new Logger(DriverLocationGateway.name);

  constructor(private readonly locations: DriverLocationService) {}

  /**
   * NEVER throws. A `WsException` emits an `exception` frame and a raw zod
   * error is worse — a driver mid-shift must not be disturbed by one bad frame.
   * Log and return.
   *
   * The global `JwtAuthGuard` cannot help here: it refuses non-HTTP contexts by
   * design, so `client.data.user` (set by the handshake) is the only identity
   * source. It is optional in the type even though the middleware guarantees it.
   */
  @SubscribeMessage(RT.driverLocation)
  async handleLocation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    const user = client.data.user;
    if (user?.role !== 'driver') {
      this.logger.warn({
        event: 'driver.location.ping_rejected',
        driverId: user?.sub ?? null,
        reason: 'not_a_driver',
        at: new Date().toISOString(),
      });
      return;
    }

    const parsed = driverLocationPingSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn({
        event: 'driver.location.ping_rejected',
        driverId: user.sub,
        reason: 'malformed_payload',
        at: new Date().toISOString(),
      });
      return;
    }

    await this.locations.ingest(user.sub, parsed.data);
  }
}
