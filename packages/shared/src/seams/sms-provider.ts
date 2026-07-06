/**
 * Seam over Twilio (decided 2026-07-06) so a cheaper Latvian gateway can
 * replace it post-pilot without touching auth code.
 */
export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<void>;
}
