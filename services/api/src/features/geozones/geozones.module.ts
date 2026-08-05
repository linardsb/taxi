import { Module } from '@nestjs/common';
import { GeozonesRepository } from './geozones.repository';
import { GeozonesService } from './geozones.service';

/** Deliberately not `@Global()` — consumers declare the dependency. */
@Module({
  providers: [GeozonesService, GeozonesRepository],
  exports: [GeozonesService],
})
export class GeozonesModule {}
