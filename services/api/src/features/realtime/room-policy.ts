import {
  dispatchRoom,
  driverRoom,
  userRoom,
  type JwtClaims,
} from '@taxi/shared';

/**
 * May a socket belonging to `user` be placed in `room`? The gateway consults
 * this before every auto-join. There is no client-initiated join API at all
 * (see index.ts), so this is the complete answer to "which rooms can this
 * role reach".
 */
export function canJoin(
  user: JwtClaims,
  room: string,
  ctx: { cityId: string },
): boolean {
  if (room === userRoom(user.sub)) return true;
  if (room === driverRoom(user.sub)) return user.role === 'driver';
  if (room === dispatchRoom(ctx.cityId))
    return user.role === 'dispatcher' || user.role === 'admin';
  // Ride rooms are server-orchestrated only (RealtimeService.joinRideRoom).
  // #11 tightens this into a real ride-membership check when rides exist.
  return false;
}

/** The rooms the gateway joins on connect — every candidate, filtered. */
export function roomsOnConnect(
  user: JwtClaims,
  ctx: { cityId: string },
): string[] {
  return [
    userRoom(user.sub),
    driverRoom(user.sub),
    dispatchRoom(ctx.cityId),
  ].filter((r) => canJoin(user, r, ctx));
}
