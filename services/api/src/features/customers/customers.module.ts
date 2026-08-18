import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
  // Exported for #19's dispatcher booking, which resolves the caller's identity
  // through this slice before delegating to `RidesService`.
  exports: [CustomersService, CustomersRepository],
})
export class CustomersModule {}
