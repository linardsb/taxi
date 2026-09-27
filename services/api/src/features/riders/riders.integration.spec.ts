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

/**
 * `PUT /riders/me/display-name` (#269) — the rider's own name, which the driver
 * sees (#261) and #259's arrival prompt speaks. Write-only, like the token.
 */
describe('rider display name (#269)', () => {
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

  const storedName = async (id: string) =>
    (
      await ctx.db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
    )[0]?.displayName;

  const putName = (accessToken: string, displayName: unknown) =>
    http
      .put('/riders/me/display-name')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ displayName });

  it('stores the trimmed name, echoes nothing, and clears on null (expected)', async () => {
    const me = await signIn(p(5), 'rider');

    const put = await putName(me.accessToken, '  Anna  ').expect(204);
    expect(put.body).toEqual({});
    expect(await storedName(me.user.id)).toBe('Anna');

    await putName(me.accessToken, null).expect(204);
    expect(await storedName(me.user.id)).toBeNull();
  });

  it('keeps the session with a worst-case name under 2048 bytes (edge)', async () => {
    // 120 × '中' is 3 UTF-8 bytes per UTF-16 unit, the most the schema admits.
    // 2048 is the historical iOS SecureStore ceiling Expo's docs cite.
    const phone = p(6);
    const me = await signIn(phone, 'rider');
    await putName(me.accessToken, '中'.repeat(120)).expect(204);

    const again = await signIn(phone, 'rider');
    expect(again.user.displayName).toBe('中'.repeat(120));
    const bytes = Buffer.byteLength(JSON.stringify(again));
    expect(bytes).toBeLessThan(2048);
  });

  it('keeps a legacy blank name out of the session (edge)', async () => {
    const phone = p(7);
    const me = await signIn(phone, 'rider');
    await ctx.db
      .update(users)
      .set({ displayName: '   ' })
      .where(eq(users.id, me.user.id));

    const again = await signIn(phone, 'rider');
    expect('displayName' in again.user).toBe(false);
  });

  it("overwrites a name Dina filled — the rider's own write wins (edge)", async () => {
    const me = await signIn(p(8), 'rider');
    await ctx.db
      .update(users)
      .set({ displayName: 'Dina' })
      .where(eq(users.id, me.user.id));

    await putName(me.accessToken, 'Anna').expect(204);
    expect(await storedName(me.user.id)).toBe('Anna');
  });

  it.each([
    ['blank', '   ', 9],
    ['over-long', 'x'.repeat(121), 11],
    ['control character', 'An\u0000na', 12],
  ])(
    'refuses a %s name and keeps the stored one (failure)',
    async (_, bad, n) => {
      const me = await signIn(p(n), 'rider');
      await putName(me.accessToken, 'Anna').expect(204);

      await putName(me.accessToken, bad).expect(400);
      expect(await storedName(me.user.id)).toBe('Anna');
    },
  );

  it("refuses a DRIVER's token (failure)", async () => {
    const driver = await signIn(p(10), 'driver');
    await putName(driver.accessToken, 'Anna').expect(403);
  });

  it('refuses an unauthenticated call (failure)', async () => {
    await http
      .put('/riders/me/display-name')
      .send({ displayName: 'Anna' })
      .expect(401);
  });
});
