import { Injectable, Logger } from '@nestjs/common';
import type { SmsProvider } from '@taxi/shared';
import { maskPhone } from '../phone-mask';

/**
 * Dev implementation of the SmsProvider seam (@taxi/shared). Logs the code
 * instead of spending money at Twilio (#7 scope: "stub implementation in
 * dev — no Twilio spend"). Bound when `SMS_PROVIDER=stub`, which is the
 * schema default; a real implementation — `twilio-sms.provider.ts` (#85),
 * `bulkgate-sms.provider.ts` or `budgetsms.provider.ts` (#137) — binds when
 * `SMS_PROVIDER` names it. Production refuses this one at boot.
 */
@Injectable()
export class StubSmsProvider implements SmsProvider {
  private readonly logger = new Logger(StubSmsProvider.name);

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    // The code IS logged in full — that is the point of the stub, and the only
    // way to read it during manual validation. Not a leak: the phone is still
    // masked, and the real provider (twilio-sms.provider.ts) logs neither.
    this.logger.log({
      event: 'auth.otp.stub_sent',
      phone: maskPhone(phoneE164),
      code,
      at: new Date().toISOString(),
    });
    return Promise.resolve();
  }

  async send(phoneE164: string, body: string): Promise<void> {
    // Body in full for the same reason the OTP is: manual validation reads
    // the tracking link out of this log. The real provider
    // (twilio-sms.provider.ts) logs neither.
    this.logger.log({
      event: 'auth.sms.stub_sent',
      phone: maskPhone(phoneE164),
      body,
      at: new Date().toISOString(),
    });
    return Promise.resolve();
  }
}
