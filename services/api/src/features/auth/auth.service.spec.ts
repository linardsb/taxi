import { HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SignupRole, User, UserRole } from '@taxi/shared';
import {
  InMemoryKeyValueStore,
  RecordingSmsProvider,
} from '../../../test/harness';
import type { Env } from '../../common/config/env.schema';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import type { AuthRepository } from './auth.repository';
import { OTP_MAX_VERIFY_ATTEMPTS, OTP_TTL_SECONDS } from './otp.policy';

const USER_ID = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const PHONE = '+37121000001';
const SECRET = 'unit-test-secret-at-least-16';

/** Only the two fields AuthService reads off the env. */
const env = { JWT_SECRET: SECRET } as Env;

/** `storedRole` is what the repository reports back — a provisioned dispatcher
 *  is the case that matters, so it is a UserRole, not a SignupRole. */
function build(storedRole: UserRole = 'driver') {
  const kv = new InMemoryKeyValueStore();
  const sms = new RecordingSmsProvider();
  const tokens = new AuthTokenService(
    new JwtService({ secret: SECRET, signOptions: { expiresIn: '30d' } }),
  );

  const created: { role: SignupRole }[] = [];
  const repo = {
    findOrCreate: (input: {
      phone: string;
      role: SignupRole;
    }): Promise<User> => {
      created.push({ role: input.role });
      return Promise.resolve({
        id: USER_ID,
        phone: input.phone,
        // The stub mimics the real repository: an existing row's role wins.
        role: storedRole,
        language: 'lv',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      });
    },
  } as unknown as AuthRepository;

  return {
    service: new AuthService(kv, sms, env, repo, tokens),
    kv,
    sms,
    tokens,
    created,
  };
}

/** The rejection itself, typed — `.catch(e => e)` would widen to a union. */
async function rejection(p: Promise<unknown>): Promise<UnauthorizedException> {
  let caught: unknown;
  let resolved = false;
  try {
    await p;
    resolved = true;
  } catch (e) {
    caught = e;
  }
  if (resolved) throw new Error('expected a rejection, got a value');
  return caught as UnauthorizedException;
}

describe('AuthService.requestOtp', () => {
  it('sends exactly one SMS and stores a live record (expected)', async () => {
    const { service, sms, kv } = build();

    const res = await service.requestOtp({ phone: PHONE, role: 'driver' });

    expect(res).toEqual({
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: 60,
    });
    expect(sms.sent).toHaveLength(1);
    expect(sms.lastCodeFor(PHONE)).toMatch(/^\d{6}$/);
    expect(await kv.ttl(`otp:code:${PHONE}`)).toBeGreaterThan(0);
  });

  it('does not store the code in plaintext (edge — a Redis dump is not an incident)', async () => {
    const { service, sms, kv } = build();
    await service.requestOtp({ phone: PHONE, role: 'rider' });

    const record = await kv.get(`otp:code:${PHONE}`);
    expect(record).not.toContain(sms.lastCodeFor(PHONE)!);
  });

  it('refuses a resend inside the cooldown and sends no second SMS (edge — SMS spend)', async () => {
    const { service, sms } = build();
    await service.requestOtp({ phone: PHONE, role: 'driver' });

    await expect(
      service.requestOtp({ phone: PHONE, role: 'driver' }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(sms.sent).toHaveLength(1);
  });

  it('throttles past the hourly cap (failure)', async () => {
    const { service, kv, sms } = build();

    // Five allowed requests, each past the cooldown; the sixth is over the cap.
    for (let i = 0; i < 5; i++) {
      await service.requestOtp({ phone: PHONE, role: 'driver' });
      kv.advance(OTP_TTL_SECONDS + 1);
    }
    expect(sms.sent).toHaveLength(5);

    await expect(
      service.requestOtp({ phone: PHONE, role: 'driver' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(sms.sent).toHaveLength(5);
  });
});

describe('AuthService.verifyOtp', () => {
  it('returns a session whose token verifies to the user (expected)', async () => {
    const { service, sms, tokens } = build();
    await service.requestOtp({ phone: PHONE, role: 'driver' });

    const session = await service.verifyOtp({
      phone: PHONE,
      code: sms.lastCodeFor(PHONE)!,
    });

    expect(session.user.id).toBe(USER_ID);
    expect(session.user.createdAt).toBe('2026-08-01T00:00:00.000Z');
    const claims = await tokens.verify(session.accessToken);
    expect(claims).toMatchObject({ sub: USER_ID, role: 'driver' });
  });

  it('passes the REQUESTED role to the repository, never the verify body (edge)', async () => {
    const { service, sms, created } = build('dispatcher');
    await service.requestOtp({ phone: PHONE, role: 'rider' });

    const session = await service.verifyOtp({
      phone: PHONE,
      code: sms.lastCodeFor(PHONE)!,
    });

    expect(created).toEqual([{ role: 'rider' }]);
    // …and the stored role still wins in the response and the token.
    expect(session.user.role).toBe('dispatcher');
  });

  it('burns the code after the attempt cap — the correct code then fails too (edge)', async () => {
    const { service, sms } = build();
    await service.requestOtp({ phone: PHONE, role: 'driver' });
    const code = sms.lastCodeFor(PHONE)!;

    for (let i = 0; i < OTP_MAX_VERIFY_ATTEMPTS; i++) {
      await expect(
        service.verifyOtp({ phone: PHONE, code: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    await expect(
      service.verifyOtp({ phone: PHONE, code }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not extend the code TTL on a wrong guess (edge)', async () => {
    const { service, kv } = build();
    await service.requestOtp({ phone: PHONE, role: 'driver' });

    kv.advance(100);
    const before = await kv.ttl(`otp:code:${PHONE}`);
    await expect(
      service.verifyOtp({ phone: PHONE, code: '000000' }),
    ).rejects.toThrow();
    const after = await kv.ttl(`otp:code:${PHONE}`);

    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeLessThan(OTP_TTL_SECONDS);
  });

  it('makes a wrong code and an expired code indistinguishable (failure)', async () => {
    const wrong = build();
    await wrong.service.requestOtp({ phone: PHONE, role: 'driver' });
    const wrongErr = await rejection(
      wrong.service.verifyOtp({ phone: PHONE, code: '000000' }),
    );

    const expired = build();
    await expired.service.requestOtp({ phone: PHONE, role: 'driver' });
    const code = expired.sms.lastCodeFor(PHONE)!;
    expired.kv.advance(OTP_TTL_SECONDS + 1);
    const expiredErr = await rejection(
      expired.service.verifyOtp({ phone: PHONE, code }),
    );

    expect(expiredErr.getStatus()).toBe(wrongErr.getStatus());
    expect(expiredErr.getResponse()).toEqual(wrongErr.getResponse());
  });
});
