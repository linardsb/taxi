import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_ENV, type Env } from './common/config/env.schema';
import { RedisIoAdapter } from './features/realtime';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const env = app.get<Env>(APP_ENV);

  app.enableCors({ origin: env.CORS_ORIGINS });

  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis(env.REDIS_URL);
  app.useWebSocketAdapter(adapter);

  // Makes the onModuleDestroy hooks in DbModule/KvModule fire on SIGINT.
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
}
void bootstrap();
