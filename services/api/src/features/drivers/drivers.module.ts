import { Module } from '@nestjs/common';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { RealtimeModule } from '../realtime';
import { DriversController } from './drivers.controller';
import { DriversRepository } from './drivers.repository';
import { DriversService } from './drivers.service';
import { DriverLocationGateway } from './location/driver-location.gateway';
import { DriverLocationService } from './location/driver-location.service';
import { DRIVER_LOCATION_STORE } from './location/driver-location.store';
import { RedisDriverLocationStore } from './location/redis-driver-location.store';
import { VehiclesController } from './vehicles.controller';
import { VehiclesRepository } from './vehicles.repository';
import { VehiclesService } from './vehicles.service';

/**
 * `RedisDriverLocationStore` opens a THIRD ioredis connection in production
 * (KV + the adapter's pub/sub pair + this). That is intended, not an oversight:
 * a subscribed client cannot serve GEO commands. `enableShutdownHooks()` in
 * main.ts closes it through `onModuleDestroy`.
 *
 * Deliberately not `@Global()` — #10 will `imports: [DriversModule]`.
 */
@Module({
  imports: [RealtimeModule], // for RealtimeService — the only cross-slice dependency
  controllers: [DriversController, VehiclesController],
  providers: [
    DriversService,
    DriversRepository,
    VehiclesService,
    VehiclesRepository,
    DriverLocationService,
    DriverLocationGateway,
    {
      provide: DRIVER_LOCATION_STORE,
      useFactory: (env: Env) => new RedisDriverLocationStore(env.REDIS_URL),
      inject: [APP_ENV],
    },
  ],
  exports: [DriversService, DriverLocationService, DRIVER_LOCATION_STORE],
})
export class DriversModule {}
