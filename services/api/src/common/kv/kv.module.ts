import { Global, Module } from '@nestjs/common';
import { APP_ENV, type Env } from '../config/env.schema';
import { KV_STORE } from './kv.store';
import { RedisKeyValueStore } from './redis-kv.store';

@Global()
@Module({
  providers: [
    {
      provide: KV_STORE,
      useFactory: (env: Env) => new RedisKeyValueStore(env.REDIS_URL),
      inject: [APP_ENV],
    },
  ],
  exports: [KV_STORE],
})
export class KvModule {}
