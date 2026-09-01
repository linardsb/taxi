import { Module } from '@nestjs/common';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { PushModule } from '../push';
import { RealtimeModule } from '../realtime';
import { DriversController } from './drivers.controller';
import { DriversRepository } from './drivers.repository';
import { DriversService } from './drivers.service';
import { DriverLocationGateway } from './location/driver-location.gateway';
import { DriverLocationService } from './location/driver-location.service';
import { DRIVER_LOCATION_STORE } from './location/driver-location.store';
import { RedisDriverLocationStore } from './location/redis-driver-location.store';
import { DriverPresenceRepository } from './presence/driver-presence.repository';
import { DriverPresenceSweeper } from './presence/driver-presence.sweeper';
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
 *
 * `DriverPresenceSweeper` (#14) reads Postgres every 15 s. That is off the
 * ping path — the rule is about the ping, not the slice — and on the same
 * footing as the gateway's `handleDisconnect`. `PushModule` is a provider-only
 * slice, imported rather than folded into `notifications` (which imports THIS
 * module — a nudge there would be a cycle).
 */
@Module({
  imports: [RealtimeModule, PushModule], // RealtimeService for the fan-out; PUSH_PROVIDER for the nudge
  controllers: [DriversController, VehiclesController],
  providers: [
    DriversService,
    DriversRepository,
    DriverPresenceRepository,
    DriverPresenceSweeper,
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
