import { Module } from '@nestjs/common';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { DriversModule } from '../drivers';
import { GeozonesModule } from '../geozones';
import { PlatformConfigModule } from '../platform-config';
import { RealtimeModule } from '../realtime';
import { RidesModule } from '../rides';
import { BoardService } from './board/board.service';
import { DispatchNotifier } from './dispatch-notifier';
import { DispatchController } from './dispatch.controller';
import { DispatchRepository } from './dispatch.repository';
import { DispatchService } from './dispatch.service';
import { DispatchSweeper } from './dispatch.sweeper';
import { ForceAssignService } from './force-assign.service';
import { DISPATCH_QUEUE_STORE } from './queue/dispatch-queue.store';
import { RedisDispatchQueueStore } from './queue/redis-dispatch-queue.store';
import { AutoMatchStrategy } from './strategies/auto-match.strategy';
import { DispatchStrategyResolver } from './strategies/dispatch-strategy.resolver';
import { GeozoneQueueStrategy } from './strategies/geozone-queue.strategy';

/**
 * `DISPATCH_QUEUE_STORE` is UNCONDITIONALLY the Redis implementation, mirroring
 * `DRIVER_LOCATION_STORE` in `drivers.module.ts`.
 *
 * The in-memory store is a TEST-ONLY construct and must never become an
 * env-conditional production fallback: an in-memory queue silently forgets every
 * driver's earned position on restart, which is a fairness bug that would never
 * surface as an error. The token is exported so tests can override the provider.
 */
@Module({
  imports: [
    DriversModule,
    RidesModule,
    GeozonesModule,
    PlatformConfigModule,
    RealtimeModule,
  ],
  controllers: [DispatchController],
  providers: [
    DispatchService,
    DispatchNotifier,
    ForceAssignService,
    DispatchRepository,
    DispatchSweeper,
    BoardService,
    AutoMatchStrategy,
    GeozoneQueueStrategy,
    DispatchStrategyResolver,
    {
      provide: DISPATCH_QUEUE_STORE,
      useFactory: (env: Env) => new RedisDispatchQueueStore(env.REDIS_URL),
      inject: [APP_ENV],
    },
  ],
  exports: [DispatchService, DispatchSweeper, DISPATCH_QUEUE_STORE],
})
export class DispatchModule {}
