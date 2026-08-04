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
  attempts: number;
}

const codeKey = (phone: string) => `otp:code:${phone}`;
const rateKey = (phone: string) => `otp:rate:${phone}`;

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

  private hash(code: string): string {
    return createHash('sha256')
      .update(`${code}${this.env.JWT_SECRET}`)
      .digest('hex');
  }

  async requestOtp(input: OtpRequest): Promise<OtpRequestResponse> {
    const phone = input.phone;
    const masked = maskPhone(phone);

    const count = await this.kv.incrWithTtl(
      rateKey(phone),
      OTP_RATE_WINDOW_SECONDS,
    );
    if (count > OTP_MAX_REQUESTS_PER_HOUR) {
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

    // A live code younger than the cooldown means "you just asked" — derived
    // from the remaining TTL rather than a second key.
    const remaining = await this.kv.ttl(codeKey(phone));
    const age = OTP_TTL_SECONDS - remaining;
    if (remaining > 0 && age < OTP_RESEND_COOLDOWN_SECONDS) {
      throw new HttpException(
        {
          message: 'resend_too_soon',
          retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS - age,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // crypto.randomInt, never Math.random — a predictable OTP is a full auth bypass.
    const code = String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(
      OTP_CODE_LENGTH,
      '0',
    );
    const record: OtpRecord = {
      hash: this.hash(code),
      role: input.role,
      attempts: 0,
    };
    await this.kv.setWithTtl(
      codeKey(phone),
      JSON.stringify(record),
      OTP_TTL_SECONDS,
    );

    try {
      await this.sms.sendOtp(phone, code);
    } catch (err) {
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

    // Hash both sides before comparing: timingSafeEqual throws on a length
    // mismatch, and two sha256 digests are always the same length. Never `===`
    // on the raw codes.
    const candidate = Buffer.from(this.hash(input.code), 'hex');
    const expected = Buffer.from(record.hash, 'hex');
    if (
      candidate.length !== expected.length ||
      !timingSafeEqual(candidate, expected)
    ) {
      const attempts = record.attempts + 1;
      if (attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
        await this.kv.del(codeKey(phone));
      } else {
        // Preserve the REMAINING ttl — a fresh one would let wrong guesses
        // extend the code's life indefinitely.
        const remaining = await this.kv.ttl(codeKey(phone));
        if (remaining > 0) {
          await this.kv.setWithTtl(
            codeKey(phone),
            JSON.stringify({ ...record, attempts }),
            remaining,
          );
        }
      }
      this.logger.warn({
        event: 'auth.otp.verify_rejected',
        phone: masked,
        reason: 'wrong_code',
        attempts,
        at,
      });
      throw new UnauthorizedException(REJECTED);
    }

    // Clear the code and its cooldown. The hourly counter deliberately SURVIVES:
    // it is the SMS-spend cap, not a cooldown, and resetting it here would let
    // five wrong guesses reset the budget guardrail.
    await this.kv.del(codeKey(phone));

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
