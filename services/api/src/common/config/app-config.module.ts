import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_ENV, envSchema, loadEnv } from './env.schema';

/**
 * `envFilePath` resolves relative to process.cwd(), which is `services/api`
 * for both `pnpm --filter @taxi/api dev` and jest — hence the repo root first,
 * a local .env second. @nestjs/config never overwrites variables already in
 * process.env, so a real environment (CI, the Hetzner box) always wins over the file.
 * `validate` throws a zod error at bootstrap; loadEnv() then parses the same
 * merged env once more and caches it as the only place config is read from.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['../../.env', '.env'],
      validate: (raw) => envSchema.parse(raw),
    }),
  ],
  providers: [{ provide: APP_ENV, useFactory: loadEnv }],
  exports: [APP_ENV],
})
export class AppConfigModule {}
