import { Controller, Get } from '@nestjs/common';
import { users } from '@taxi/db';
import {
  authSessionSchema,
  jwtClaimsSchema,
  type JwtClaims,
} from '@taxi/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import {
  createTestApp,
  insertUser,
  phoneFor,
  type TestApp,
} from '../../../test/harness';
import { AuthTokenService } from './auth-token.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';

/**
 * Test-only. The app ships no non-@Public() route yet, so this is what the
 * global JwtAuthGuard/RolesGuard pair can actually be probed against.
 */
@Controller('probe')
class ProbeController {
  @Get('me')
  me(@CurrentUser() user: JwtClaims): { sub: string; role: string } {
    return { sub: user.sub, role: user.role };
  }

  @Get('admin')
  @Roles('admin')
  adminOnly(): { ok: true } {
    return { ok: true };
  }
}

/** `+371210` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371210', n);

describe('auth (integration)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [ProbeController] });
    http = request(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.app.close(); // or the Drizzle pool keeps jest alive
  });

  /**
   * request → read the stub's code → verify. The whole OTP round trip, with
   * the response parsed through the shared schema so the test reads typed
   * fields rather than `any` off the wire.
   */
  async function signIn(phone: string, role: 'rider' | 'driver' = 'driver') {
    await http.post('/auth/otp/request').send({ phone, role }).expect(200);
    const code = ctx.sms.lastCodeFor(phone)!;
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone, code })
      .expect(200);
    return authSessionSchema.parse(res.body);
  }

  it('signs a new phone in end-to-end and creates the user row (expected)', async () => {
    const phone = p(1);

    const requested = await http
      .post('/auth/otp/request')
      .send({ phone, role: 'driver' })
      .expect(200);
    expect(requested.body).toEqual({
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
    });

    // No row exists until the code is verified — an unverified phone cannot
    // create rows, and the request response is identical either way.
    expect(
      await ctx.db.select().from(users).where(eq(users.phone, phone)),
    ).toHaveLength(0);

    const code = ctx.sms.lastCodeFor(phone)!;
    const verified = await http
      .post('/auth/otp/verify')
      .send({ phone, code })
      .expect(200);

    const session = authSessionSchema.parse(verified.body);
    expect(session.user.phone).toBe(phone);
    expect(session.user.role).toBe('driver');

    const rows = await ctx.db
      .select()
      .from(users)
      .where(eq(users.phone, phone));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('driver');
  });

  it('keeps /health reachable without a token under the global guard (expected)', async () => {
    await http.get('/health').expect(200, { status: 'ok', service: 'api' });
  });

  it('returns the same user id on a second sign-in (edge — find-or-create)', async () => {
    const phone = p(2);
    const first = await signIn(phone);

    ctx.kv.advance(400); // past the code TTL, so the resend cooldown is clear
    const second = await signIn(phone);

    expect(second.user.id).toBe(first.user.id);
  });

  it("keeps a provisioned dispatcher's role when they claim 'rider' (edge — privilege escalation)", async () => {
    const phone = p(3);
    const { id } = await insertUser(ctx.db, { phone, role: 'dispatcher' });

    const session = await signIn(phone, 'rider');

    expect(session.user.id).toBe(id);
    expect(session.user.role).toBe('dispatcher');

    // The claim in the token must not have been minted as 'rider' either.
    const claims = jwtClaimsSchema.parse(
      await ctx.app.get(AuthTokenService).verify(session.accessToken),
    );
    expect(claims.role).toBe('dispatcher');

    const rows = await ctx.db
      .select()
      .from(users)
      .where(eq(users.phone, phone));
    expect(rows[0]!.role).toBe('dispatcher');
  });

  it('rejects a wrong code with 401 (failure)', async () => {
    const phone = p(4);
    await http
      .post('/auth/otp/request')
      .send({ phone, role: 'rider' })
      .expect(200);

    await http
      .post('/auth/otp/verify')
      .send({ phone, code: '000000' })
      .expect(401);
  });

  it('rejects a non-E.164 phone with 400 validation_failed (failure)', async () => {
    const res = await http
      .post('/auth/otp/request')
      .send({ phone: '26123456', role: 'rider' })
      .expect(400);

    const body = res.body as { message: string; issues: unknown[] };
    expect(body.message).toBe('validation_failed');
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('rejects a self-claimed admin role at the contract with 400 (failure)', async () => {
    await http
      .post('/auth/otp/request')
      .send({ phone: p(5), role: 'admin' })
      .expect(400);
  });

  it('signs in a user whose stored language is off-enum (failure — a 500 on the one screen that cannot take one)', async () => {
    const phone = p(8);
    // `users.language` is plain `text` with no pg enum and no CHECK, so the
    // column genuinely permits this. Written directly because nothing in the
    // app can produce it — which is exactly why the cast went unnoticed.
    await ctx.db.insert(users).values({ phone, role: 'rider', language: 'xx' });

    const session = await signIn(phone, 'rider');

    // Parsed through the shared schema, so an unparsed value would have thrown
    // a ZodError inside the service and surfaced as a 500 rather than this.
    expect(session.user.language).toBe('lv');
    expect(session.user.phone).toBe(phone);
  });

  it('refuses a guarded route without a token, and with a junk one (failure — fail-closed)', async () => {
    await http.get('/probe/me').expect(401);
    await http
      .get('/probe/me')
      .set('authorization', 'Bearer not-a-jwt')
      .expect(401);
    await http.get('/probe/me').set('authorization', 'Basic abc').expect(401);
  });

  it('admits a valid token and exposes its claims to the handler (expected)', async () => {
    const session = await signIn(p(6));

    const res = await http
      .get('/probe/me')
      .set('authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(res.body).toEqual({ sub: session.user.id, role: 'driver' });
  });

  it('forbids a driver on an @Roles(admin) route with 403, not 401 (failure)', async () => {
    const session = await signIn(p(7));

    await http
      .get('/probe/admin')
      .set('authorization', `Bearer ${session.accessToken}`)
      .expect(403);
  });
});
