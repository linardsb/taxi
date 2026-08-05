import { HttpException, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SignupRole, User, UserRole } from '@taxi/shared';
import * as nodeCrypto from 'node:crypto';

/**
 * The guess cap's invariant is "how many guesses reached timingSafeEqual", and
 * that is the only way to observe it: the export is non-configurable, so
 * `jest.spyOn` cannot attach. Everything else passes through untouched, and
 * the comparison still runs for real.
 */
jest.mock('node:crypto', () => {
  const actual =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});
const comparisons = jest.mocked(nodeCrypto.timingSafeEqual);
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
const PEPPER = 'unit-test-pepper-at-least-16';

/** Only the fields AuthService reads off the env. */
const env = { JWT_SECRET: SECRET, OTP_PEPPER: PEPPER } as Env;

/** `storedRole` is what the repository reports back — a provisioned dispatcher
 *  is the case that matters, so it is a UserRole, not a SignupRole. */
/**
 * Lets one call stall between the TTL gate and its increment — the interleaving
 * where a burn used to re-arm the counter. The window is a single round trip,
 * so racing for it is not reproducible; it is constructed instead.
 */
class PausableKv extends InMemoryKeyValueStore {
  private gate?: Promise<void>;
  private open?: () => void;

  pauseNextIncr(): void {
    this.gate = new Promise((resolve) => (this.open = resolve));
  }

  resume(): void {
    this.open?.();
  }

  override async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const gate = this.gate;
    this.gate = undefined; // only the first caller waits
    if (gate) await gate;
    return super.incrWithTtl(key, ttlSeconds);
  }
}

function build(
  storedRole: UserRole = 'driver',
  kv: InMemoryKeyValueStore = new InMemoryKeyValueStore(),
  envOverrides: Partial<Env> = {},
) {
  const serviceEnv = { ...env, ...envOverrides };
  const sms = new RecordingSmsProvider();
  const tokens = new AuthTokenService(
    new JwtService({
      secret: serviceEnv.JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    }),
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
    service: new AuthService(kv, sms, serviceEnv, repo, tokens),
    kv,
    sms,
    tokens,
    created,
  };
}

/**
 * The rejection itself, typed — `.catch(e => e)` would widen to a union. The
 * instanceof check is load-bearing: a cast would let a TypeError masquerade as
 * a refusal, and a test counting refusals would score the crash as a pass.
 */
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
  if (!(caught instanceof UnauthorizedException)) {
    throw new Error(`expected UnauthorizedException, got ${String(caught)}`);
  }
  return caught;
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

  it('does not spend an hourly slot on a rejected resend (failure)', async () => {
    const { service, sms, kv } = build();
    await service.requestOtp({ phone: PHONE, role: 'driver' });

    // Inside the cooldown: no SMS leaves the building, so no slot is spent.
    await expect(
      service.requestOtp({ phone: PHONE, role: 'driver' }),
    ).rejects.toMatchObject({ status: 429 });

    // The four remaining slots must still be there.
    for (let i = 0; i < 4; i++) {
      kv.advance(OTP_TTL_SECONDS + 1);
      await service.requestOtp({ phone: PHONE, role: 'driver' });
    }
    expect(sms.sent).toHaveLength(5);
  });

  it('keeps the cooldown after the code is burned (failure)', async () => {
    const { service, sms } = build();
    await service.requestOtp({ phone: PHONE, role: 'driver' });

    // Burning the code used to clear the cooldown with it, because the
    // cooldown was the code's own TTL. That bought a free resend: five wrong
    // guesses per round, five rounds, and any known number was out of SMS
    // budget — five real messages and an hour of no sign-in, in one second.
    for (let i = 0; i < OTP_MAX_VERIFY_ATTEMPTS; i++) {
      await rejection(service.verifyOtp({ phone: PHONE, code: '000000' }));
    }

    await expect(
      service.requestOtp({ phone: PHONE, role: 'driver' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(sms.sent).toHaveLength(1);
  });

  it('sends one SMS for a concurrent burst, not one per request (failure)', async () => {
    const { service, sms, kv } = build();

    // The cooldown used to be read, then written four awaits later. Every
    // request in a burst read 0, passed, and sent: five requests from anyone
    // who knew the number spent the whole hourly budget in one round trip —
    // five real messages, and no new code for the rest of the hour. Sequential
    // resends never showed it, which is why it survived two review rounds.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.requestOtp({ phone: PHONE, role: 'driver' }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(sms.sent).toHaveLength(1);
    // The payload the attack was really after: the burst cost one hourly slot,
    // not five, so the phone can still sign in.
    expect(await kv.get(`otp:rate:${PHONE}`)).toBe('1');
  });

  it('releases the cooldown when the SMS never went out (failure)', async () => {
    const { service, sms } = build();
    jest
      .spyOn(sms, 'sendOtp')
      .mockRejectedValueOnce(new Error('provider down'))
      .mockImplementation((phone: string, code: string) => {
        sms.sent.push({ phone, code });
        return Promise.resolve();
      });

    // Claiming the cooldown before the send must not let an outage block the
    // retry — the claim is what a delivered SMS keeps, not what an attempt takes.
    await expect(
      service.requestOtp({ phone: PHONE, role: 'driver' }),
    ).rejects.toMatchObject({ status: 502 });

    await service.requestOtp({ phone: PHONE, role: 'driver' });
    expect(sms.sent).toHaveLength(1);
  });

  it('lets a signed-in user request again immediately (edge)', async () => {
    const { service, sms } = build();
    await service.requestOtp({ phone: PHONE, role: 'driver' });
    await service.verifyOtp({ phone: PHONE, code: sms.lastCodeFor(PHONE)! });

    // Clearing the cooldown takes the correct code, so only the phone's real
    // owner can — which is exactly what the burn path cannot do.
    await service.requestOtp({ phone: PHONE, role: 'driver' });
    expect(sms.sent).toHaveLength(2);
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
    // Over the cap sends nothing, so it leaves no cooldown behind: the key
    // means "an SMS was just delivered", and a claim that outlived its
    // rejection would report a pending resend that never happened.
    expect(await kv.ttl(`otp:cooldown:${PHONE}`)).toBe(0);
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

  it('counts a concurrent burst of guesses, not just the wave (failure)', async () => {
    const { service, sms } = build();
    await service.requestOtp({ phone: PHONE, role: 'driver' });
    const code = sms.lastCodeFor(PHONE)!;

    // Counted at the comparison itself. Counting `wrong_code` logs instead is
    // a proxy that only holds while the cap check sits between the increment
    // and the log: an ordering that compares eagerly and increments straight
    // after lets all 50 reach timingSafeEqual while still logging only 5.
    comparisons.mockClear();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    try {
      // Fired in parallel, so every guess interleaves at the same await points.
      // A read-modify-write counter lets all 50 observe the same value and
      // write back one attempt; the cap must survive that.
      await Promise.all(
        Array.from({ length: 50 }, () =>
          rejection(service.verifyOtp({ phone: PHONE, code: '000000' })),
        ),
      );

      // The reason the counter increments BEFORE the compare. Counting after is
      // atomic too and burns the code just the same, so the burn alone cannot
      // tell the two apart — but it would let all 50 guesses through first, and
      // the cap would bound waves rather than guesses. Exactly, not at-most: a
      // regression that crashed all 50 would compare nothing at all and sail
      // through a `toBeLessThanOrEqual`.
      expect(comparisons).toHaveBeenCalledTimes(OTP_MAX_VERIFY_ATTEMPTS);
    } finally {
      // Not restoring on the failure path would leak a prototype mock into
      // every later test in this file.
      warn.mockRestore();
    }

    await expect(
      service.verifyOtp({ phone: PHONE, code }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not re-arm the counter for a guess already in flight when the code burns (failure)', async () => {
    const kv = new PausableKv();
    const { service } = build('driver', kv);
    await service.requestOtp({ phone: PHONE, role: 'driver' });

    comparisons.mockClear();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      // The straggler clears the record read and the TTL gate, then stalls
      // just before its increment.
      kv.pauseNextIncr();
      const straggler = rejection(
        service.verifyOtp({ phone: PHONE, code: '000000' }),
      );
      await new Promise((resolve) => setImmediate(resolve));

      // Meanwhile the cap is reached and the code is burned out from under it.
      for (let i = 0; i <= OTP_MAX_VERIFY_ATTEMPTS; i++) {
        await rejection(service.verifyOtp({ phone: PHONE, code: '000000' }));
      }

      kv.resume();
      await straggler;

      // Deleting the counter along with the code would hand the straggler a
      // fresh budget and a sixth comparison — against a record the store no
      // longer has. The counter has to outlive the code it bounds.
      expect(comparisons).toHaveBeenCalledTimes(OTP_MAX_VERIFY_ATTEMPTS);
    } finally {
      warn.mockRestore();
    }
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
    // The counter carries the code's REMAINING life, never a fresh window —
    // otherwise it outlives the code it belongs to.
    expect(await kv.ttl(`otp:attempts:${PHONE}`)).toBeLessThanOrEqual(after);
  });

  it('gives a reissued code a fresh guess budget (edge)', async () => {
    const { service, sms, kv } = build();
    await service.requestOtp({ phone: PHONE, role: 'driver' });
    for (let i = 0; i < 3; i++) {
      await rejection(service.verifyOtp({ phone: PHONE, code: '000000' }));
    }

    // A new code is a new secret. If the counter carried over, 3 + 4 would
    // burn it before the right code was ever tried.
    kv.advance(OTP_TTL_SECONDS + 1);
    await service.requestOtp({ phone: PHONE, role: 'driver' });
    const code = sms.lastCodeFor(PHONE)!;
    for (let i = 0; i < 4; i++) {
      await rejection(service.verifyOtp({ phone: PHONE, code: '000000' }));
    }

    const session = await service.verifyOtp({ phone: PHONE, code });
    expect(session.user.id).toBe(USER_ID);
  });

  it('accepts a code in flight across a JWT_SECRET rotation (failure)', async () => {
    const kv = new InMemoryKeyValueStore();
    const before = build('driver', kv);
    await before.service.requestOtp({ phone: PHONE, role: 'driver' });
    const code = before.sms.lastCodeFor(PHONE)!;

    // The same store and the same pepper, a rotated signing key — which is
    // exactly what remediating a leaked JWT_SECRET does. Hashing
    // `code + JWT_SECRET` made every user mid-login fail with
    // `invalid_or_expired_code`, a message that by design says nothing, so a
    // rotation-induced outage was indistinguishable from a wave of wrong codes.
    const after = build('driver', kv, {
      JWT_SECRET: 'rotated-secret-at-least-16-chars',
    });

    const session = await after.service.verifyOtp({ phone: PHONE, code });
    expect(session.user.id).toBe(USER_ID);
  });

  it('rejects a code in flight across an OTP_PEPPER rotation (edge)', async () => {
    const kv = new InMemoryKeyValueStore();
    const before = build('driver', kv);
    await before.service.requestOtp({ phone: PHONE, role: 'driver' });
    const code = before.sms.lastCodeFor(PHONE)!;

    // The other half of the separation, and the reason the pepper is worth
    // rotating on its own: its blast radius is one 5-minute window of codes,
    // never a session token. A test asserting only the JWT half would pass
    // against a hash that ignored both secrets entirely.
    const after = build('driver', kv, {
      OTP_PEPPER: 'rotated-pepper-at-least-16-chars',
    });

    await rejection(after.service.verifyOtp({ phone: PHONE, code }));
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
