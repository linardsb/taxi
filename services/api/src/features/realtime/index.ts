/**
 * The realtime slice's public API.
 *
 * DESIGN — read before extending: there is **no client-initiated join API**,
 * and that is deliberate, not an omission. The gateway places each socket in
 * the rooms `canJoin()` allows for its JWT role at connect time, and ride
 * rooms are joined server-side via `RealtimeService.joinRideRoom()`. A driver
 * cannot join the dispatch board because no client can ask to join anything.
 * Do not "add the missing join handler".
 */
export { RealtimeModule } from './realtime.module';
// Types only — a feature slice that subscribes to a message needs the socket
// shape. Subscribing to a MESSAGE is not joining a ROOM; the rule above stands.
export type { AuthedSocket, RealtimeServer } from './realtime.gateway';
export { RealtimeService } from './realtime.service';
export { RedisIoAdapter } from './redis-io.adapter';
export { canJoin, roomsOnConnect } from './room-policy';
