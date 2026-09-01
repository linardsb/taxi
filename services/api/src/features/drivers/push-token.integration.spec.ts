import { drivers } from '@taxi/db';
import { authSessionSchema } from '@taxi/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp, phoneFor, type TestApp } from '../../../test/harness';

/** `+371290` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371290', n);

const CLASSIC = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const MODERN = 'ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]';

describe('PUT/DELETE /drivers/me/push-token (integration, #14)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function signIn(phone: string, role: 'rider' | 'driver' = 'driver') {
    await http.post('/auth/otp/request').send({ phone, role }).expect(200);
    const code = ctx.sms.lastCodeFor(phone)!;
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone, code })
      .expect(200);
    const session = authSessionSchema.parse(res.body);
    return {
      id: session.user.id,
      auth: `Bearer ${session.accessToken}`,
      token: async () =>
        (
          await ctx.db
            .select({ pushToken: drivers.pushToken })
            .from(drivers)
            .where(eq(drivers.userId, session.user.id))
        )[0]?.pushToken,
    };
  }

  it('stores a classic token on a driver whose very first call this is (expected)', async () => {
    const d = await signIn(p(1));

    await http
      .put('/drivers/me/push-token')
      .set('authorization', d.auth)
      .send({ token: CLASSIC })
      .expect(204);

    expect(await d.token()).toBe(CLASSIC);
  });

  it('accepts the newer ExpoPushToken form and replaces the old one (edge)', async () => {
    const d = await signIn(p(2));
    await http
      .put('/drivers/me/push-token')
      .set('authorization', d.auth)
      .send({ token: CLASSIC })
      .expect(204);

    await http
      .put('/drivers/me/push-token')
      .set('authorization', d.auth)
      .send({ token: MODERN })
      .expect(204);

    expect(await d.token()).toBe(MODERN);
  });

  it('forgets the token on DELETE (expected — sign-out)', async () => {
    const d = await signIn(p(3));
    await http
      .put('/drivers/me/push-token')
      .set('authorization', d.auth)
      .send({ token: CLASSIC })
      .expect(204);

    await http
      .delete('/drivers/me/push-token')
      .set('authorization', d.auth)
      .expect(204);

    expect(await d.token()).toBeNull();
  });

  it('never leaks the token through GET /drivers/me (edge)', async () => {
    const d = await signIn(p(4));
    await http
      .put('/drivers/me/push-token')
      .set('authorization', d.auth)
      .send({ token: CLASSIC })
      .expect(204);

    const res = await http
      .get('/drivers/me')
      .set('authorization', d.auth)
      .expect(200);

    expect(JSON.stringify(res.body)).not.toContain('PushToken');
  });

  it('refuses a raw FCM handle and a rider (failure)', async () => {
    const d = await signIn(p(5));
    await http
      .put('/drivers/me/push-token')
      .set('authorization', d.auth)
      .send({ token: 'fcm:xyz' })
      .expect(400);
    expect(await d.token()).toBeUndefined(); // no row was even provisioned

    const rider = await signIn(p(6), 'rider');
    await http
      .put('/drivers/me/push-token')
      .set('authorization', rider.auth)
      .send({ token: CLASSIC })
      .expect(403);
  });
});
