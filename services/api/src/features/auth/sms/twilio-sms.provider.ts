import { Logger } from '@nestjs/common';
import { formatMessage, type SmsProvider } from '@taxi/shared';
import { maskPhone } from '../phone-mask';

/**
 * `sendOtp` blocks a login request — auth answers 502 and releases the resend
 * cooldown on failure, so failing fast beats a hung fetch.
 */
const SMS_HTTP_TIMEOUT_MS = 10_000;

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** E.164 number, or an alphanumeric sender ID (≤11 chars, one-way) — env.schema pins the shape. */
  from: string;
}

/**
 * The real implementation of the SmsProvider seam (#85). This file and
 * `auth.module.ts` are the only two in the repo allowed to name Twilio (root
 * CLAUDE.md: vendor knowledge stays inside the slice implementing the seam).
 *
 * No `twilio` SDK: two form-encoded POSTs against the Messages REST API don't
 * justify its dependency tree, so this is plain `fetch` — injectable, the
 * `StripeClient` "narrow client, testable without a network" doctrine.
 */
export class TwilioSmsProvider implements SmsProvider {
  private readonly logger = new Logger(TwilioSmsProvider.name);

  constructor(
    private readonly config: TwilioConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    // lv, not the user's language: at request-otp time there may be no user
    // row yet, so there is no preference to read. Digits are digits in any
    // language.
    await this.send(phoneE164, formatMessage('lv', 'sms.otp_code', { code }));
  }

  async send(phoneE164: string, body: string): Promise<void> {
    const res = await this.fetchFn(
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${this.config.accountSid}:${this.config.authToken}`,
          ).toString('base64')}`,
        },
        // URLSearchParams as body sets the form-urlencoded Content-Type itself.
        body: new URLSearchParams({
          To: phoneE164,
          From: this.config.from,
          Body: body,
        }),
        signal: AbortSignal.timeout(SMS_HTTP_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      // A LOCALLY composed message only: `auth.service.ts` logs `err.message`
      // verbatim, and Twilio's own error text can echo the unmasked `To`
      // number. The numeric code is a complete diagnosis handle
      // (twilio.com/docs/api/errors) and leaks nothing.
      throw new Error(`twilio_error_${(await errorCode(res)) ?? res.status}`);
    }

    const json = (await res.json()) as { sid?: string; num_segments?: string };
    // Never the body here — it carries OTP codes and tracking links. Only the
    // STUB logs bodies, deliberately, as the dev workflow.
    this.logger.log({
      event: 'auth.sms.twilio_sent',
      phone: maskPhone(phoneE164),
      segments: Number(json.num_segments) || 1, // the "SMS spend €/week" ledger row reads this
      sid: json.sid,
      at: new Date().toISOString(),
    });
  }
}

/** Best-effort: Twilio 4xx bodies are `{ code, message, more_info }` JSON, but never trust it. */
async function errorCode(res: Response): Promise<number | undefined> {
  try {
    const json = (await res.json()) as { code?: unknown };
    return typeof json.code === 'number' ? json.code : undefined;
  } catch {
    return undefined;
  }
}
