import { rideEvents } from '@taxi/db';
import type {
  RideEventActorKind,
  RideEventKind,
  RideReasonCode,
  RideStatus,
  UserRole,
} from '@taxi/shared';
import type { DbTx } from '../../common/db/db.module';

/**
 * Who caused a ride event, and why (#316). `id` is a `users.id` — null only
 * for `system` (a DB check pins that).
 */
export interface RideEventActor {
  kind: RideEventActorKind;
  id: string | null;
  reasonCode?: RideReasonCode | null;
  /** Free text — stored in an undeletable row, never logged. */
  reasonText?: string | null;
}

export const SYSTEM_ACTOR: RideEventActor = { kind: 'system', id: null };

export function driverActor(driverId: string): RideEventActor {
  return { kind: 'driver', id: driverId };
}

const ACTOR_KIND_BY_ROLE: Record<UserRole, RideEventActorKind> = {
  rider: 'rider',
  driver: 'driver',
  dispatcher: 'dispatcher',
  admin: 'admin',
};

/** A JWT role as an event actor. Typed per role, so a new role is a compile error here. */
export function actorKindFromRole(role: UserRole): RideEventActorKind {
  return ACTOR_KIND_BY_ROLE[role];
}

export interface RideEventInput {
  rideId: string;
  kind: RideEventKind;
  fromStatus: RideStatus | null;
  toStatus: RideStatus;
  actor: RideEventActor;
  driverId?: string | null;
  vehicleId?: string | null;
}

/**
 * Appends one `ride_events` row (#316, K1). `tx` is REQUIRED: an event written
 * outside the change's own transaction is exactly the bug the record layer
 * exists to prevent — a status without its event, or an event without its
 * status. Logs nothing: a failure fails the caller's transaction.
 */
export async function insertRideEvent(
  tx: DbTx,
  e: RideEventInput,
): Promise<void> {
  await tx.insert(rideEvents).values({
    rideId: e.rideId,
    kind: e.kind,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    actorKind: e.actor.kind,
    actorId: e.actor.id,
    reasonCode: e.actor.reasonCode ?? null,
    reasonText: e.actor.reasonText ?? null,
    driverId: e.driverId ?? null,
    vehicleId: e.vehicleId ?? null,
  });
}
