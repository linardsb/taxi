import { Module } from '@nestjs/common';
import { PlatformConfigRepository } from './platform-config.repository';
import { PlatformConfigService } from './platform-config.service';

/** Deliberately not `@Global()` — consumers declare the dependency. */
@Module({
  providers: [PlatformConfigService, PlatformConfigRepository],
  exports: [PlatformConfigService],
})
export class PlatformConfigModule {}
