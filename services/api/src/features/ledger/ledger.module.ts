import { Module } from '@nestjs/common';
import { LedgerRepository } from './ledger.repository';
import { LedgerService } from './ledger.service';

/** No `imports`: `DbModule` is `@Global()`, so `DRIZZLE` resolves without one. */
@Module({
  providers: [LedgerService, LedgerRepository],
  exports: [LedgerService, LedgerRepository],
})
export class LedgerModule {}
