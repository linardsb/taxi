import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp, type TestApp } from './harness';

/**
 * Through `createTestApp`, not a raw `AppModule` boot (#200). Raw, this was
 * the one Nest app in the repo with none of the harness's overrides, so it
 * dialled REDIS_URL three times (6379 by default, a foreign Redis on the dev
 * box) and every hand run ended in "Jest did not exit one second after the
 * test run has completed". `observed` (#200, PR #201): the app lives ~10 ms
 * after the Redis TCP connect, so `app.close()` sends QUIT mid-handshake and
 * each client's flushed ready check leaves ioredis's ref'd 2 s disconnect
 * timer behind — the mechanism, the runs and the instrument that was blind
 * to it are in the PR body. The harness constructs no ioredis client and
 * listens once on the loopback (#193).
 *
 * Not run by the gate (lint and typecheck do see it): jest `rootDir` is
 * `src`; this runs only under a hand-run `test:e2e`.
 */
describe('AppController (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('/ (GET)', () => {
    return request(ctx.app.getHttpServer() as Server)
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
