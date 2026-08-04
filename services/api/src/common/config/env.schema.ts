import { RIGA_CITY_ID } from '@taxi/db';
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  /** Single-city pilot; dispatchers join dispatch:<DEFAULT_CITY_ID>. */
  DEFAULT_CITY_ID: z.string().uuid().default(RIGA_CITY_ID),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3002')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;
export const APP_ENV = 'APP_ENV';

let cached: Env | undefined;
/** Parsed once per process; throws at bootstrap on a bad environment. */
export function loadEnv(): Env {
  return (cached ??= envSchema.parse(process.env));
}
