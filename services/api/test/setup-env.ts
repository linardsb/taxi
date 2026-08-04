import { TEST_URL } from './test-db';

/**
 * Runs per jest worker, before the framework. TEST_URL is read from
 * ./test-db BEFORE this mutation, so the module still holds the admin URL.
 */
process.env.DATABASE_URL = TEST_URL;
process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars';
process.env.REDIS_URL ??= 'redis://localhost:6379'; // never dialled: KV_STORE is overridden
process.env.NODE_ENV = 'test';
