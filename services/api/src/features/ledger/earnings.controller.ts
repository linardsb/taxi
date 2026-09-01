import { Controller, Get } from '@nestjs/common';
import type { DriverEarningsToday, JwtClaims } from '@taxi/shared';
import { CurrentUser, Roles } from '../auth';
import { LedgerService } from './ledger.service';

/**
 * The driver's own earnings (#14). Lives in the ledger slice because the
 * ledger owns the entries; mounted under `/drivers/me/...` because it is the
 * driver's self view. `me` only — the driver id comes from the JWT, the same
 * rule as `DriversController`. #15's per-ride statement lands beside it.
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
