import { users } from '@taxi/db';
import { authSessionSchema } from '@taxi/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp, phoneFor, type TestApp } from '../../../test/harness';

/** `+371310` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371310', n);

const TOKEN = 'ExponentPushToken[rider0000000000000]';

/**
 * `PUT|DELETE /riders/me/push-token` (#17) — the registration half of the
 * arrival push. The SEND half is covered end-to-end in
 * `notifications/tracking/tracking.integration.spec.ts`, which registers
 * through this same route and then drives a ride to `arrived`.
 */
describe('riders push token (#17)', () => {
  let ctx: TestApp;
  let http: request.Agent;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function signIn(phone: string, role: 'rider' | 'driver') {
    await http.post('/auth/otp/request').send({ phone, role }).expect(200);
    const code = ctx.sms.lastCodeFor(phone)!;
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone, code })
      .expect(200);
    return authSessionSchema.parse(res.body);
  }

  const storedToken = async (id: string) =>
    (
      await ctx.db
        .select({ pushToken: users.pushToken })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
    )[0]?.pushToken;

  it('registers the token, then clears it, and never echoes it back (expected)', async () => {
    const me = await signIn(p(1), 'rider');
    const auth = `Bearer ${me.accessToken}`;

    const put = await http
      .put('/riders/me/push-token')
      .set('authorization', auth)
      .send({ token: TOKEN })
      .expect(204);
    // Write-only by design: a provider handle in a response body is how one
    // reaches a log.
    expect(put.body).toEqual({});
    expect(await storedToken(me.user.id)).toBe(TOKEN);

    await http
      .delete('/riders/me/push-token')
      .set('authorization', auth)
      .expect(204);
    expect(await storedToken(me.user.id)).toBeNull();
  });

  it('re-registering overwrites rather than accumulating (edge)', async () => {
    // Every signed-in app start calls this, and a phone's token rotates.
    const me = await signIn(p(2), 'rider');
    const auth = `Bearer ${me.accessToken}`;
    const rotated = 'ExponentPushToken[rotated000000000]';

    await http
      .put('/riders/me/push-token')
      .set('authorization', auth)
      .send({ token: TOKEN })
      .expect(204);
    await http
      .put('/riders/me/push-token')
      .set('authorization', auth)
      .send({ token: rotated })
      .expect(204);

    expect(await storedToken(me.user.id)).toBe(rotated);
  });

  it('refuses a token that is not an Expo handle, and stores nothing (failure)', async () => {
    // `expoPushTokenSchema` is the only thing between this column and an
    // arbitrary string posted by any signed-in rider.
    const me = await signIn(p(3), 'rider');

    await http
      .put('/riders/me/push-token')
      .set('authorization', `Bearer ${me.accessToken}`)
      .send({ token: 'fcm:whatever' })
      .expect(400);

    expect(await storedToken(me.user.id)).toBeNull();
  });

  it("refuses a DRIVER's token, so the route cannot cross roles (failure)", async () => {
    // Drivers have their own column and their own route. A driver reaching
    // this one would write a rider row keyed by their own id.
    const driver = await signIn(p(4), 'driver');

    await http
      .put('/riders/me/push-token')
      .set('authorization', `Bearer ${driver.accessToken}`)
      .send({ token: TOKEN })
      .expect(403);
  });

  it('refuses an unauthenticated call (failure)', async () => {
    await http.put('/riders/me/push-token').send({ token: TOKEN }).expect(401);
  });
});
