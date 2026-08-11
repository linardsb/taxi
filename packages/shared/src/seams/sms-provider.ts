/**
 * Seam over Twilio (decided 2026-07-06) so a cheaper Latvian gateway can
 * replace it post-pilot without touching auth code.
 */
export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<void>;
  /** Free-form notification SMS. Throws on delivery failure — callers on the
   *  ride path MUST catch: an SMS failure never fails a booking. */
  send(phoneE164: string, body: string): Promise<void>;
}
