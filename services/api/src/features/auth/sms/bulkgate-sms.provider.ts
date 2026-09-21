import { Logger } from '@nestjs/common';
import { formatMessage, type SmsProvider } from '@taxi/shared';
import { maskPhone } from '../phone-mask';

/**
 * `sendOtp` blocks a login request — auth answers 502 and releases the resend
 * cooldown on failure, so failing fast beats a hung fetch. Same value and same
 * reasoning as `twilio-sms.provider.ts`; a bake-off that gave one candidate a
 * longer rope would be measuring the rope.
 */
const SMS_HTTP_TIMEOUT_MS = 10_000;

const TRANSACTIONAL_URL =
  'https://portal.bulkgate.com/api/1.0/simple/transactional';

/**
 * GSM 03.38 basic set + the extension table. LV diacritics (ā č ē ģ ī ķ ļ ņ š
 * ū ž) and all Cyrillic are deliberately absent — that absence is what selects
 * UCS-2.
 */
const GSM7 = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà' +
    '\f^{}\\[~]|€',
);

/**
 * Whether the whole body fits GSM-7. Module-local on purpose: this is
 * BulkGate's `unicode` flag, not a cross-surface contract, so it does not
 * belong in `@taxi/shared` and the seam stays as it is.
 */
export const isGsm7 = (text: string): boolean =>
  [...text].every((c) => GSM7.has(c));

export interface BulkGateConfig {
  applicationId: string;
  applicationToken: string;
  /** The `gText` sender value — alphanumeric ≤11 chars; env.schema pins the shape. */
  senderIdValue: string;
}

/**
 * BulkGate's Simple Transactional API as a second `SmsProvider` (#137's
 * bake-off candidate against Twilio, €0.0311/segment vs $0.0715 `observed`
 * 2026-08-14 — a gap that decides nothing until delivery is scored on real LV
 * handsets).
 *
 * Plain `fetch` over the vendor SDK, injectable, for the reason #85 gave: one
 * JSON POST does not justify a dependency tree, and an injected `fetchFn` is
 * what makes this testable without a network.
 */
export class BulkGateSmsProvider implements SmsProvider {
  private readonly logger = new Logger(BulkGateSmsProvider.name);

  constructor(
    private readonly config: BulkGateConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    // lv, not the user's language: at request-otp time there may be no user
    // row yet, so there is no preference to read. Digits are digits in any
    // language. Byte-identical to what Twilio and BudgetSMS send, which is
    // what makes the bake-off's OTP row attributable to the route.
    await this.send(phoneE164, formatMessage('lv', 'sms.otp_code', { code }));
  }

  async send(phoneE164: string, body: string): Promise<void> {
    const res = await this.fetchFn(TRANSACTIONAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        application_id: this.config.applicationId,
        application_token: this.config.applicationToken,
        number: phoneE164,
        text: body,
        // DETECTED, never hardcoded. BulkGate is the only one of the three
        // candidates that takes an encoding flag — Twilio auto-detects and
        // BudgetSMS assumes UTF-8 — so a hardcoded `true` would send the
        // deliberately-ASCII OTP as UCS-2 while the other two send GSM-7.
        // Two encodings can take different aggregator routes, and the
        // scorecard's OTP row would then be comparing a route difference with
        // an encoding difference mixed in. (Segment count is NOT the variable
        // at stake: at 22 chars the OTP is 1 segment either way.)
        unicode: !isGsm7(body),
        sender_id: 'gText',
        sender_id_value: this.config.senderIdValue,
        country: 'lv',
      }),
      signal: AbortSignal.timeout(SMS_HTTP_TIMEOUT_MS),
    });

    if (!res.ok) {
      // A LOCALLY composed message only: `auth.service.ts` logs `err.message`
      // verbatim, and BulkGate's envelope carries an `error` string that can
      // echo the destination number plus a `detail` field of unspecified
      // shape. The `type` slug is a complete diagnosis handle
      // (help.bulkgate.com/docs/en/api-error-types.html) and leaks nothing.
      throw new Error(`bulkgate_error_${(await errorType(res)) ?? res.status}`);
    }

    const json = (await res.json()) as {
      data?: { sms_id?: string; part_id?: unknown };
    };
    // Never the body here — it carries OTP codes and tracking links. Only the
    // STUB logs bodies, deliberately, as the dev workflow.
    this.logger.log({
      event: 'auth.sms.bulkgate_sent',
      phone: maskPhone(phoneE164),
      segments: countParts(json.data?.part_id), // the "SMS spend €/week" ledger row reads this
      // The RAW array alongside the count, because the count is `expected`
      // rather than observed — see `countParts`. Row 11 of the bake-off
      // scorecard asks for exactly this and is unfillable without it. Opaque
      // vendor ids: no phone, no body, nothing to leak.
      partId: json.data?.part_id,
      smsId: json.data?.sms_id,
      at: new Date().toISOString(),
    });
  }
}

/**
 * Segments from `part_id`, counting only the suffixed entries.
 *
 * `expected`, not `observed`: the vendor's documented success example returns
 * THREE ids for what its own field names read as a two-part message —
 * `["tmpde1bcd4b1d1_1", "tmpde1bcd4b1d1_2", "tmpde1bcd4b1d1"]`, two suffixed
 * plus the bare one — so `part_id.length` would over-count by one. A
 * single-part send may return only the bare id, hence the fallback to 1.
 * Row 11 of `docs/research/sms-bakeoff-scorecard.md` records the real array
 * and settles this.
 */
function countParts(partId: unknown): number {
  if (!Array.isArray(partId)) return 1;
  const suffixed = partId.filter(
    (id) => typeof id === 'string' && /_\d+$/.test(id),
  );
  return suffixed.length || 1;
}

/** Best-effort: BulkGate errors are `{ type, code, error, detail }` JSON, but never trust it. */
async function errorType(res: Response): Promise<string | undefined> {
  try {
    const json = (await res.json()) as { type?: unknown };
    return typeof json.type === 'string' ? json.type : undefined;
  } catch {
    return undefined;
  }
}
