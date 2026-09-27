import { Injectable } from '@nestjs/common';
import { RidersRepository } from './riders.repository';

/**
 * The rider's own account surface: the push token (#17) and the rider's
 * display name (#269). The slice exists rather than the route hanging off
 * `rides` because a token is a property of the RIDER, not of any ride. `apps/rider`'s remaining self-service reads land here next.
 */
@Injectable()
export class RidersService {
  constructor(private readonly riders: RidersRepository) {}

  /** Called on every signed-in app start; the token never appears in a response. */
  setPushToken(riderId: string, token: string): Promise<void> {
    return this.riders.setPushToken(riderId, token);
  }

  /**
   * Sign-out, and the one case the rider controls. The api NULLs the token on
   * its own too, when Expo answers `device_not_registered`
   * (`RideNotificationsService.pushArrival`) — the two paths are independent
   * and both idempotent.
   */
  clearPushToken(riderId: string): Promise<void> {
    return this.riders.setPushToken(riderId, null);
  }

  /** The rider's own name (#269); `null` removes it. */
  setDisplayName(riderId: string, name: string | null): Promise<void> {
    return this.riders.setDisplayName(riderId, name);
  }
}
