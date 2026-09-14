import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp, type TestApp } from './harness';

/**
 * Through `createTestApp`, not a raw `AppModule` boot (#200). Raw, this was
 * the one Nest app in the repo with none of the harness's overrides, so
 * KvModule, DispatchModule and DriversModule each built a real ioredis client
 * against REDIS_URL — 6379 by default, which on the dev box is another
 * project's Redis. Each client was still in `connect` (ready check
 * outstanding) when `app.close()` sent QUIT; the flushed ready check took
 * ioredis's fatal-error path, whose `disconnect()` arms a ref'd 2 s
 * `disconnectTimeout` that only the stream's `close` event clears — and that
 * event had already fired. Three such timers held the process past jest's
 * one-second check ("Jest did not exit …"), with `_getActiveHandles()` blind
 * to timers on Node 20, so the earlier dumps went empty while jest waited.
 * The harness constructs no ioredis client and listens once on the loopback
 * (#193), so nothing here dials anything but Postgres.
 *
 * Not collected by the gate: jest `rootDir` is `src`; this runs only under a
 * hand-run `test:e2e`.
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
