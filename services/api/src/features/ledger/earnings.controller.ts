import { Controller, Get } from '@nestjs/common';
import type { DriverEarningsToday, JwtClaims } from '@taxi/shared';
import { CurrentUser, Roles } from '../auth';
import { LedgerService } from './ledger.service';

/**
 * The driver's own earnings (#14). Lives in the ledger slice because the
 * ledger owns the entries; mounted under `/drivers/me/...` because it is the
 * driver's self view. `me` only — the driver id comes from the JWT, the same
 * rule as `DriversController`. The per-ride receipt (#15) did NOT land here:
 * it reads `ride.split` from `POST /rides/:rideId/complete` and, on recovery,
 * from `GET /rides/:rideId` with a driver token. A per-ride earnings HISTORY
 * endpoint is unassigned (Q1 = Option B, 2026-09-04).
 */
@Controller('drivers/me/earnings')
@Roles('driver')
export class EarningsController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('today')
  today(@CurrentUser() user: JwtClaims): Promise<DriverEarningsToday> {
    return this.ledger.todayForDriver(user.sub);
  }
}
