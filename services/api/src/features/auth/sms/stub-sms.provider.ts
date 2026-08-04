import { Injectable, Logger } from '@nestjs/common';
import type { SmsProvider } from '@taxi/shared';
import { maskPhone } from '../phone-mask';

/**
 * Dev/pilot implementation of the SmsProvider seam (@taxi/shared). Logs the
 * code instead of spending money at Twilio (#7 scope: "stub implementation in
 * dev — no Twilio spend"). The real Twilio implementation lands with #13.
 */
@Injectable()
export class StubSmsProvider implements SmsProvider {
  private readonly logger = new Logger(StubSmsProvider.name);

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    // The code IS logged in full — that is the point of the stub, and the only
    // way to read it during manual validation. Not a leak: the phone is still
    // masked, and the real provider (#13) logs neither.
    this.logger.log({
      event: 'auth.otp.stub_sent',
      phone: maskPhone(phoneE164),
      code,
      at: new Date().toISOString(),
    });
    return Promise.resolve();
  }
}
