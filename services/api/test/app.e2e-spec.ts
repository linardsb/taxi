import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    // #193: without a listen, supertest binds this server itself once per
    // REQUEST, on the wildcard — where a foreign 127.0.0.1 listener in the
    // ephemeral range answers instead. Listen once, on the loopback, as
    // `test/harness.ts` does. (Not collected by the gate: jest `rootDir` is
    // `src`; this runs only under a hand-run `test:e2e`.)
    await app.listen(0, '127.0.0.1');
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
