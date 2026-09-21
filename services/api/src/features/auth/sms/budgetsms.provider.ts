import { Logger } from '@nestjs/common';
import { formatMessage, type SmsProvider } from '@taxi/shared';
import { maskPhone } from '../phone-mask';

/**
 * `sendOtp` blocks a login request — auth answers 502 and releases the resend
 * cooldown on failure, so failing fast beats a hung fetch. Same value and same
 * reasoning as `twilio-sms.provider.ts`.
 */
const SMS_HTTP_TIMEOUT_MS = 10_000;

const SEND_URL = 'https://api.budgetsms.net/sendsms/';

export interface BudgetSmsConfig {
  username: string;
  /** Numeric account id, not the username; env.schema pins the shape. */
  userid: string;
  /** The API secret. Travels in the query string — the endpoint is GET-only. */
  handle: string;
  /** Alphanumeric sender, ≤11 chars, NO SPACES (narrower than Twilio's). */
  from: string;
  /**
   * Overridden ONLY by the bake-off script, to reach `/testsms/` (no credit,
   * no SMS) with the same request-building and response-parsing code. Not an
   * env var and deliberately not in `envSchema`: a test endpoint must not be
   * production-configurable, and the factory never sets it.
   */
  baseUrl?: string;
}

/**
 * BudgetSMS's HTTP API as a third `SmsProvider` (#137's second bake-off
 * candidate, €0.045/segment `observed` 2026-08-14).
 *
 * Plain `fetch`, injectable, the #85 doctrine. Nothing here parses JSON: this
 * vendor answers in plain text.
 */
export class BudgetSmsProvider implements SmsProvider {
  private readonly logger = new Logger(BudgetSmsProvider.name);

  constructor(
    private readonly config: BudgetSmsConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    // lv, not the user's language: at request-otp time there may be no user
    // row yet, so there is no preference to read. Byte-identical to what
    // Twilio and BulkGate send — what makes the bake-off's OTP row
    // attributable to the route rather than to the copy.
    await this.send(phoneE164, formatMessage('lv', 'sms.otp_code', { code }));
  }

  async send(phoneE164: string, body: string): Promise<void> {
    const query = new URLSearchParams({
      username: this.config.username,
      userid: this.config.userid,
      handle: this.config.handle,
      msg: body,
      from: this.config.from,
      // E.164 WITHOUT the `+`: the seam's contract is `+371…`, BudgetSMS §2
      // documents `to` as "do not use the + before the international
      // countrycode". Passing it through earns a `2010`/`2011`.
      to: phoneE164.replace(/^\+/, ''),
      // What produces the segment count. Without it the success line is a
      // bare `OK 12345678` with no parts field. `mccmnc=1` is deliberately
      // NOT passed: it appends a fifth token and widens the parse for nothing.
      price: '1',
    });

    // GET-only, so the `handle` secret and the OTP body both sit in the URL.
    // Node's `fetch` does not log URLs and nothing here does either — but the
    // URL exists at every hop that terminates TLS, which is row 16 of the
    // bake-off scorecard rather than a reason to reject the vendor outright.
    const res = await this.fetchFn(
      `${this.config.baseUrl ?? SEND_URL}?${query.toString()}`,
      { signal: AbortSignal.timeout(SMS_HTTP_TIMEOUT_MS) },
    );

    const text = (await res.text()).trim();

    // `res.ok` IS NOT THE ERROR CHECK. BudgetSMS returns `ERR nnnn` in the
    // body on a 200, and the spec documents no non-200 status for it — so an
    // implementation branching on `res.ok` logs a failed send as a success and
    // charges the ledger a segment that was never sent. The prefix is the
    // check; the HTTP status is only the fallback for a response that is
    // neither shape.
    //
    // A BARE `OK` counts as success, which is wider than `/sendsms/` needs.
    // `/sendsms/` with `price=1` answers `OK <smsid> <price> <parts>`, but
    // the bake-off's free pre-flight points this same parser at `/testsms/`,
    // and THAT endpoint's reply shape IS NOT SOURCED anywhere in this repo.
    // If it answers a bare `OK`, a `startsWith('OK ')` check reports
    // `budgetsms_error_200` for every handset on the one step whose whole job
    // is proving the credentials work — and it is the only step that is free,
    // so it is the one most likely to be trusted unverified. Accepting both
    // shapes costs the `smsId` on a reply that carries none; it does not
    // touch the `ERR`-on-200 branch, which is what the pin above protects.
    //
    // That cost is absorbed at the only consumer: `scripts/sms-bakeoff.ts`
    // renders a missing id as `ok`, not `ok undefined` (`vendorId === undefined
    // ? 'ok' : …`), and reads `segments` as the number it is — so the row the
    // runner pastes into the scorecard is clean either way.
    if (text !== 'OK' && !text.startsWith('OK ')) {
      // A LOCALLY composed message only: `auth.service.ts` logs `err.message`
      // verbatim. The raw text is short and numeric, but it is still vendor
      // text, so only the code crosses (spec V2.7 §10 is the full list).
      throw new Error(`budgetsms_error_${errorCode(text) ?? res.status}`);
    }

    // `OK <smsid> <price> <parts>` — parts last, because `price=1` is set.
    const [, smsId, , parts] = text.split(/\s+/);
    // Never the body here — it carries OTP codes and tracking links.
    this.logger.log({
      event: 'auth.sms.budgetsms_sent',
      phone: maskPhone(phoneE164),
      segments: Number(parts) || 1, // the "SMS spend €/week" ledger row reads this
      smsId,
      at: new Date().toISOString(),
    });
  }
}

/**
 * Best-effort: the failure line is `ERR nnnn`, but never trust it.
 *
 * The SHAPE is checked, not just the prefix, because the caller advertises
 * "only the code crosses" and `auth.service.ts` logs `err.message` verbatim.
 * Without this, any HTTP-200 body starting `ERR ` puts its second
 * whitespace-delimited token straight into that message. Both siblings
 * validate what they extract — `twilio-sms.provider.ts` on `typeof
 * json.code === 'number'`, `bulkgate-sms.provider.ts` on `typeof json.type
 * === 'string'`. Every code this repo cites from spec V2.7 §10 is four digits
 * (`2010`, `2011`, `3001`); the bound is 1–6 rather than exactly 4 so a code
 * of another width does not silently become `budgetsms_error_200`.
 */
function errorCode(text: string): string | undefined {
  if (!text.startsWith('ERR ')) return undefined;
  const code = text.split(/\s+/)[1];
  return /^\d{1,6}$/.test(code ?? '') ? code : undefined;
}
