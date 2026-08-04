import {
  dispatchRoom,
  driverRoom,
  rideRoom,
  userRoom,
  type JwtClaims,
  type UserRole,
} from '@taxi/shared';
import { canJoin, roomsOnConnect } from './room-policy';

const CITY = '00000000-0000-4000-8000-000000000001';
const SELF = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const OTHER = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
const ctx = { cityId: CITY };

const claims = (role: UserRole, sub = SELF): JwtClaims => ({
  sub,
  role,
  iat: 1_800_000_000,
  exp: 1_802_592_000,
});

describe('roomsOnConnect', () => {
  it('puts a driver in its own user and driver rooms (expected)', () => {
    expect(roomsOnConnect(claims('driver'), ctx)).toEqual([
      userRoom(SELF),
      driverRoom(SELF),
    ]);
  });

  it('gives dispatcher and admin the board, and a rider only itself (edge)', () => {
    expect(roomsOnConnect(claims('dispatcher'), ctx)).toEqual([
      userRoom(SELF),
      dispatchRoom(CITY),
    ]);
    expect(roomsOnConnect(claims('admin'), ctx)).toEqual([
      userRoom(SELF),
      dispatchRoom(CITY),
    ]);
    expect(roomsOnConnect(claims('rider'), ctx)).toEqual([userRoom(SELF)]);
  });
});

describe('canJoin', () => {
  it('admits every role to its own user room (expected)', () => {
    for (const role of ['rider', 'driver', 'dispatcher', 'admin'] as const) {
      expect(canJoin(claims(role), userRoom(SELF), ctx)).toBe(true);
    }
  });

  it('refuses a driver the dispatch board (failure — the acceptance criterion)', () => {
    expect(canJoin(claims('driver'), dispatchRoom(CITY), ctx)).toBe(false);
  });

  it('refuses another user’s private and driver rooms (failure — no impersonation)', () => {
    expect(canJoin(claims('rider'), driverRoom(OTHER), ctx)).toBe(false);
    expect(canJoin(claims('driver'), driverRoom(OTHER), ctx)).toBe(false);
    expect(canJoin(claims('admin'), userRoom(OTHER), ctx)).toBe(false);
  });

  it('refuses every role a ride room — those are server-orchestrated (failure)', () => {
    for (const role of ['rider', 'driver', 'dispatcher', 'admin'] as const) {
      expect(canJoin(claims(role), rideRoom(OTHER), ctx)).toBe(false);
    }
  });
});
