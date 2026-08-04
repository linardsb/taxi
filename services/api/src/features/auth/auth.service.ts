import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  authSessionSchema,
  type AuthSession,
  type OtpRequest,
  type OtpRequestResponse,
  type OtpVerify,
  type SignupRole,
  type SmsProvider,
} from '@taxi/shared';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { AuthRepository } from './auth.repository';
import { AuthTokenService } from './auth-token.service';
import {
  OTP_CODE_LENGTH,
  OTP_MAX_REQUESTS_PER_HOUR,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_RATE_WINDOW_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from './otp.policy';
import { maskPhone } from './phone-mask';
import { SMS_PROVIDER } from './sms/sms.tokens';

/** What lives under `otp:code:<phone>` for the life of one code. */
interface OtpRecord {
  hash: string;
  role: SignupRole;
}

const codeKey = (phone: string) => `otp:code:${phone}`;
const rateKey = (phone: string) => `otp:rate:${phone}`;
/**
 * Guesses live in their own key, NOT in the record: counting them means
 * read-modify-write on the JSON blob, and a concurrent burst would all read the
 * same value and write back one attempt — 50 guesses, one counted. INCR is the
 * only thing that bounds a parallel attacker.
 */
const attemptsKey = (phone: string) => `otp:attempts:${phone}`;
/**
 * The cooldown is its own key rather than the code's remaining TTL. Derived
 * from the code, five wrong guesses burned it and bought a free resend: 5 SMS
 * and an hour-long sign-in lockout of any known number, in about a second.
 *
 * It is CLAIMED with INCR, never read-then-set. A read leaves four awaits
 * before the write, so a concurrent burst all reads 0, all passes, and all
 * sends — the same 5 SMS, by a different route. Set means "an SMS was just
 * delivered", so every path that sends nothing releases it again.
 */
const cooldownKey = (phone: string) => `otp:cooldown:${phone}`;

/** One message for wrong-code AND no-code, so nothing distinguishes them. */
const REJECTED = 'invalid_or_expired_code';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(APP_ENV) private readonly env: Env,
    private readonly repo: AuthRepository,
    private readonly tokens: AuthTokenService,
  ) {}

  /**
   * Deletes the code and NOTHING else. The counter must outlive it: a request
   * already past the TTL gate when this lands would otherwise increment a
   * deleted key, read back 1, and get a fresh guess budget against the record
   * it is still holding. It expires on its own — and `requestOtp` clears it
   * whenever a new code is issued, so it can never go stale either.
   * The cooldown must outlive it too, or burning the code buys a free resend.
   */
  private async burn(phone: string): Promise<void> {
    await this.kv.del(codeKey(phone));
  }

  private hash(code: string): string {
    return createHash('sha256')
      .update(`${code}${this.env.JWT_SECRET}`)
      .digest('hex');
  }

  async requestOtp(input: OtpRequest): Promise<OtpRequestResponse> {
    const phone = input.phone;
    const masked = maskPhone(phone);

    // Checked BEFORE the hourly counter: this path sends no SMS, and the
    // counter is the SMS-spend cap. Counting it would let five taps of "resend"
    // — or five requests from anyone who knows the number — lock a phone out of
    // sign-in for an hour.
    const claimed = await this.kv.incrWithTtl(
      cooldownKey(phone),
      OTP_RESEND_COOLDOWN_SECONDS,
    );
    if (claimed > 1) {
      // The key can expire between the INCR and this read, and a
      // retryAfterSeconds of 0 would read as "retry now" on a rejection.
      const retryAfterSeconds = Math.max(
        1,
        await this.kv.ttl(cooldownKey(phone)),
      );
      throw new HttpException(
        { message: 'resend_too_soon', retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Spend the slot before sending, not after: a GET-then-INCR would let a
    // burst all read the same count and every one of them send an SMS.
    const count = await this.kv.incrWithTtl(
      rateKey(phone),
      OTP_RATE_WINDOW_SECONDS,
    );
    if (count > OTP_MAX_REQUESTS_PER_HOUR) {
      await this.kv.del(cooldownKey(phone)); // nothing was sent
      this.logger.warn({
        event: 'auth.otp.throttled',
        phone: masked,
        count,
        at: new Date().toISOString(),
      });
      throw new HttpException(
        'too_many_requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // crypto.randomInt, never Math.random — a predictable OTP is a full auth bypass.
    const code = String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(
      OTP_CODE_LENGTH,
      '0',
    );
    const record: OtpRecord = { hash: this.hash(code), role: input.role };
    // A new code is a new secret: its guess budget starts at zero. Clearing the
    // counter here is also what makes a stale one structurally impossible.
    await this.kv.del(attemptsKey(phone));
    await this.kv.setWithTtl(
      codeKey(phone),
      JSON.stringify(record),
      OTP_TTL_SECONDS,
    );

    try {
      await this.sms.sendOtp(phone, code);
    } catch (err) {
      // Released, so a provider outage does not also block the retry — the
      // claim above is what a delivered SMS keeps, not what an attempt takes.
      await this.kv.del(cooldownKey(phone));
      this.logger.error({
        event: 'auth.otp.send_failed',
        phone: masked,
        at: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpException('sms_delivery_failed', HttpStatus.BAD_GATEWAY);
    }

    this.logger.log({
      event: 'auth.otp.requested',
      phone: masked,
      at: new Date().toISOString(),
    });

    return {
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  }

  async verifyOtp(input: OtpVerify): Promise<AuthSession> {
    const phone = input.phone;
    const masked = maskPhone(phone);
    const at = new Date().toISOString();

    const raw = await this.kv.get(codeKey(phone));
    if (!raw) {
      this.logger.warn({
        event: 'auth.otp.verify_rejected',
        phone: masked,
        reason: 'expired',
        at,
      });
      throw new UnauthorizedException(REJECTED);
    }
    const record = JSON.parse(raw) as OtpRecord;

    // The counter carries the code's REMAINING life, never a fresh window, so
    // it dies with the code it belongs to. A code that expired between the read
    // and here has no life left to give — same rejection as a missing one.
    const remaining = await this.kv.ttl(codeKey(phone));
    if (remaining <= 0) {
      this.logger.warn({
        event: 'auth.otp.verify_rejected',
        phone: masked,
        reason: 'expired',
        at,
      });
      throw new UnauthorizedException(REJECTED);
    }

    // Count the guess BEFORE comparing it. Counting afterwards is atomic but
    // bounds nothing: every request in a burst would reach timingSafeEqual
    // before the first increment landed, so the cap would limit waves rather
    // than guesses.
    const attempts = await this.kv.incrWithTtl(attemptsKey(phone), remaining);
    if (attempts > OTP_MAX_VERIFY_ATTEMPTS) {
      await this.burn(phone);
      this.logger.warn({
        event: 'auth.otp.verify_rejected',
        phone: masked,
        reason: 'attempt_cap',
        attempts,
        at,
      });
      // The same rejection as every other failure: a distinct one here would
      // tell an attacker their guesses are landing on a live code.
      throw new UnauthorizedException(REJECTED);
    }

    // Hash both sides before comparing: timingSafeEqual throws on a length
    // mismatch, and two sha256 digests are always the same length. Never `===`
    // on the raw codes.
    const candidate = Buffer.from(this.hash(input.code), 'hex');
    const expected = Buffer.from(record.hash, 'hex');
    if (
      candidate.length !== expected.length ||
      !timingSafeEqual(candidate, expected)
    ) {
      if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) await this.burn(phone);
      this.logger.warn({
        event: 'auth.otp.verify_rejected',
        phone: masked,
        reason: 'wrong_code',
        attempts,
        at,
      });
      throw new UnauthorizedException(REJECTED);
    }

    // Clear the code and the cooldown. Clearing the cooldown takes the correct
    // code, so only the phone's real owner can — which is what separates this
    // from the burn path. The hourly counter deliberately SURVIVES: it is the
    // SMS-spend cap, and resetting it here would let five wrong guesses reset
    // the budget guardrail.
    await this.burn(phone);
    await this.kv.del(cooldownKey(phone));

    const user = await this.repo.findOrCreate({ phone, role: record.role });
    const { accessToken, expiresAt } = await this.tokens.issue(user);

    this.logger.log({
      event: 'auth.session.issued',
      userId: user.id,
      phone: masked,
      role: user.role,
      at,
    });

    return authSessionSchema.parse({
      accessToken,
      expiresAt,
      user: { ...user, createdAt: user.createdAt.toISOString() },
    });
  }
}
