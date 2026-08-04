import { Injectable } from '@nestjs/common';
import {
  dispatchRoom,
  driverRoom,
  rideRoom,
  RT_EVENT_SCHEMAS,
  userRoom,
  type ServerToClientEvents,
} from '@taxi/shared';
import { RealtimeGateway } from './realtime.gateway';

type ServerEvent = keyof ServerToClientEvents;
type EventPayload<E extends ServerEvent> = Parameters<
  ServerToClientEvents[E]
>[0];

/** The realtime slice's public API — later slices emit only through this. */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  emitToRide<E extends ServerEvent>(
    rideId: string,
    event: E,
    payload: EventPayload<E>,
  ): void {
    this.emit(rideRoom(rideId), event, payload);
  }

  emitToDriver<E extends ServerEvent>(
    driverId: string,
    event: E,
    payload: EventPayload<E>,
  ): void {
    this.emit(driverRoom(driverId), event, payload);
  }

  emitToDispatch<E extends ServerEvent>(
    cityId: string,
    event: E,
    payload: EventPayload<E>,
  ): void {
    this.emit(dispatchRoom(cityId), event, payload);
  }

  /**
   * Server-orchestrated: puts every socket of `userId` into the ride room,
   * cluster-wide via the Redis adapter. Clients never request joins.
   * `socketsJoin` returns void, not a Promise — do not await it.
   */
  joinRideRoom(userId: string, rideId: string): void {
    this.gateway.server.in(userRoom(userId)).socketsJoin(rideRoom(rideId));
  }

  leaveRideRoom(userId: string, rideId: string): void {
    this.gateway.server.in(userRoom(userId)).socketsLeave(rideRoom(rideId));
  }

  /**
   * Parses before it emits, which turns realtime-events.ts's ISO-string rule
   * from a documented invariant into an enforced one.
   */
  private emit<E extends ServerEvent>(
    room: string,
    event: E,
    payload: EventPayload<E>,
  ): void {
    const parsed = RT_EVENT_SCHEMAS[event].parse(payload) as EventPayload<E>;
    // Socket.IO's typed emit cannot narrow a generic E; the cast is confined
    // to this one line and the payload has just been schema-validated.
    (this.gateway.server.to(room).emit as (e: string, p: unknown) => boolean)(
      event,
      parsed,
    );
  }
}
