import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  dispatcherPickupPinSchema,
  type DispatcherPickupPin,
} from '@taxi/shared';
import { RideLifecycleRepository } from './ride-lifecycle.repository';

type RejectCause =
  | 'ride_not_found'
  | 'pickup_pin_not_set'
  | 'pickup_pin_not_phone'
  | 'ride_not_arrived';

/**
 * The dispatcher's read of a ride's pickup PIN (#275, PR #277 L2).
 *
 * WHY IT EXISTS: a phone rider gets their PIN only in the arrival SMS. If that
 * SMS fails, the driver cannot start and the only way out was a cancel. Dina
 * now reads the PIN to the caller instead.
 *
 * WHAT IT REVERSES: #258's "the PIN never reaches the dispatcher". Acceptable
 * because Dina is trusted staff and the PIN guards against the wrong car, not
 * against the dispatcher (user decision 2026-09-28). The PIN still never
 * travels on a ride shape: this is its own response, `dispatcherPickupPinSchema`.
 *
 * ONLY FOR A PHONE RIDE (PR #300 M1): an app rider has the PIN on their own
 * screen and is sent no arrival SMS at all (`RideNotificationsService` skips it
 * for `bookingChannel === 'app'`), so there is nothing to recover, and reading
 * it out would hand the wrong-car guard to whoever rings claiming to be them.
 *
 * ONLY AT `arrived`: the arrival SMS is sent there, so before it there is
 * nothing to recover.
 *
 * EVERY READ IS LOGGED WITH THE ACTOR — the audit trail for a secret leaving
 * the rider's hands. The PIN itself never goes on a log line.
 */
@Injectable()
export class PickupPinReadService {
  private readonly logger = new Logger(PickupPinReadService.name);

  constructor(private readonly lifecycle: RideLifecycleRepository) {}

  /**
   * The PIN check comes before the status check, as the announce flag does in
   * `ArrivalAnnounceService`: a non-PIN ride answers `pickup_pin_not_set`
   * whatever its status, which is the more useful error for the console. The
   * channel check sits between them: like the PIN, it never changes, so it
   * outranks a status that does.
   */
  async read(actorId: string, rideId: string): Promise<DispatcherPickupPin> {
    const ride = await this.lifecycle.findPickupPinTarget(rideId);
    if (!ride) {
      this.logRejected(rideId, actorId, 'ride_not_found');
      throw new NotFoundException('ride_not_found');
    }
    if (ride.pin === null) {
      this.logRejected(rideId, actorId, 'pickup_pin_not_set');
      throw new ConflictException('pickup_pin_not_set');
    }
    if (ride.bookingChannel !== 'phone') {
      this.logRejected(rideId, actorId, 'pickup_pin_not_phone');
      throw new ConflictException('pickup_pin_not_phone');
    }
    if (ride.status !== 'arrived') {
      this.logRejected(rideId, actorId, 'ride_not_arrived');
      throw new ConflictException('ride_not_arrived');
    }
    this.logger.log({
      event: 'ride.pickup_pin.dispatcher_read',
      rideId,
      actorId,
      at: new Date().toISOString(),
    });
    return dispatcherPickupPinSchema.parse({ pin: ride.pin });
  }

  private logRejected(rideId: string, actorId: string, cause: RejectCause) {
    this.logger.warn({
      event: 'ride.pickup_pin.dispatcher_read_rejected',
      rideId,
      actorId,
      cause,
      at: new Date().toISOString(),
    });
  }
}
