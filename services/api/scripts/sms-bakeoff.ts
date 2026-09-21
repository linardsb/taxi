/**
 * `sms:bakeoff` — drives #137's delivery bake-off and prints the scorecard
 * rows a person holding three handsets pastes into
 * `docs/research/sms-bakeoff-scorecard.md`.
 *
 * #137 asks whether a cheaper EU gateway can replace Twilio behind the
 * `SmsProvider` seam. The price gap is large — BulkGate €0.0311/segment
 * against Twilio's $0.0715, `observed` 2026-08-14 in
 * `docs/research/hosting-sms-cost-research.md` §4.1 — and decides nothing:
 * those are cheapest-route "from" rates, and a cheap LV route that strips the
 * alphanumeric sender, delays, or silently drops is a login outage on the OTP
 * path, not a cost problem. Only delivery observed on real LMT, Tele2 and
 * Bite handsets settles it. This script is the half of that a machine can do:
 * it sends the matrix and records what each provider's API said. The other
 * half is the three trailing table columns, which only a person holding the
 * phone can fill.
 *
 * WHY THE REAL PROVIDERS rather than three `curl`s: one of #137's five
 * criteria is what a failed send looks like on the seam's result type. A
 * script scores whatever error shape the script invents; only the code that
 * would actually ship scores the thing being asked about. So this constructs
 * `TwilioSmsProvider`, `BulkGateSmsProvider` and `BudgetSmsProvider` — the
 * same classes `smsProviderFactory` binds — and the `api result` column on a
 * failure is the thrown `Error.message` VERBATIM.
 *
 * It constructs them DIRECTLY rather than through the factory, deliberately:
 * the factory binds exactly one provider from `SMS_PROVIDER`, and the whole
 * point here is to run all three against one environment. There is no
 * failover between them, here or in the factory — a silent fallback to a
 * second vendor would make the scorecard unreadable.
 *
 * THE OTP BODY IS BYTE-IDENTICAL ACROSS ALL THREE, which is what makes the
 * OTP row attributable to the route rather than to the copy, and it is
 * structural rather than lucky: all three `sendOtp()` implementations
 * delegate to their own `send()` with the same
 * `formatMessage('lv', 'sms.otp_code', { code })` call. It was nearly not
 * true once — BulkGate is the only candidate taking an encoding flag, and a
 * hardcoded `unicode: true` would have sent the deliberately-ASCII OTP as
 * UCS-2 while the other two sent GSM-7. `bulkgate-sms.provider.ts` detects
 * instead; its spec pins it.
 *
 * DRY RUN BY DEFAULT. This spends real money on a real network, so nothing
 * leaves the machine without `--confirm`.
 *
 *   --confirm     actually send. Without it the matrix and its derived spend
 *                 print and the script exits 0 having sent nothing.
 *   --testsms     BUDGETSMS ONLY. Points that one provider's instance at
 *                 `/testsms/` (no credit deducted, no SMS delivered) while
 *                 exercising the same request-building and response-parsing
 *                 code. BulkGate and Twilio have no equivalent and are SKIPPED
 *                 under this flag rather than silently charged.
 *   --round N     labels the round, so three passes across a day stay apart.
 *
 * DERIVED SPEND, and its rates expire. Per provider, across 3 operators:
 * OTP (1 segment) × 3 rounds × 3 operators = 9; LV `driver_assigned`
 * (2 segments) × 3 rounds × 3 operators = 18; RU `driver_assigned`
 * (2 segments) × 1 round × 3 operators = 6 — 33 segments each. At §4.1's
 * `observed 2026-08-14` rates: BulkGate 33 × €0.0311 = €1.03, BudgetSMS
 * 33 × €0.045 = €1.49, Twilio 33 × $0.0715 = $2.36, which is €1.82 at an
 * EUR/USD of 1.3 and €2.36 at 1.0 (§4.1's range, chosen to avoid pinning an
 * FX rate). TOTAL €4.33–€4.87, `derived`, assuming exactly those three
 * rounds, those three probes, and those rates. One invalid-`to` failure probe
 * per provider is an allowance ON TOP: free on BudgetSMS by spec V2.7 §2, and
 * `expected` free on the other two but NOT SOURCED, so budget €0.15 worst
 * case (€0.0311 + €0.045 + $0.0715 at FX 1.0). #137 says rates move and
 * instructs re-observing them at bake-off time — this figure is not a quote.
 *
 * NOT A TEST. It does not run under jest and asserts nothing in CI. It is a
 * manual Level 4 instrument, held to `typecheck` and `lint` so it cannot rot,
 * and kept out of `dist/` by `tsconfig.build.json`.
 *
 * RUN CEILING: the ceiling is vendor credit, not a rate limit — nothing here
 * touches `OTP_MAX_REQUESTS_PER_HOUR`, because no OTP is requested; the
 * script calls `send()` with a fixed illustrative code. Three full rounds is
 * what the funding above assumes. A fourth costs another ~€1.45.
 *
 * Run:  pnpm --filter @taxi/api sms:bakeoff [--confirm] [--testsms] [--round N]
 *       (no `--` separator — pnpm 10 forwards it literally as an argument.
 *       BAKEOFF_LMT / BAKEOFF_TELE2 / BAKEOFF_BITE and the credentials come
 *       from the environment, e.g. sourced from the root env file.)
 */
import { Logger } from '@nestjs/common';
import { formatMessage } from '@taxi/shared';
import { z } from 'zod';
import { envSchema, type Env } from '../src/common/config/env.schema';
// Deep imports past the auth slice's `index.ts`, the shape
// `mint-tracked-ride.ts` already uses for `otp.policy` and
// `caching-maps.provider`: the slice's public API deliberately exports only
// `SMS_PROVIDER` and the factory, so that no MODULE can construct a provider
// off auth's back and skip the production boot-refusal. A script outside
// `dist/` is not a module, and widening the app-facing API for it would give
// that guarantee away.
import { BudgetSmsProvider } from '../src/features/auth/sms/budgetsms.provider';
// `isGsm7` comes from the provider rather than a second copy of the GSM 03.38
// table: the `encoding` column and the segment estimator below must answer
// the same question BulkGate's `unicode` flag answers, and two tables that
// have to agree are one table that will not.
import {
  BulkGateSmsProvider,
  isGsm7,
} from '../src/features/auth/sms/bulkgate-sms.provider';
import { TwilioSmsProvider } from '../src/features/auth/sms/twilio-sms.provider';

const USAGE = `usage: pnpm --filter @taxi/api sms:bakeoff [--confirm] [--testsms] [--round N]

Sends #137's delivery bake-off matrix and prints scorecard rows.
DRY RUN unless --confirm is given.

Required in the environment (E.164, one handset each):
  BAKEOFF_LMT    e.g. +37120000001
  BAKEOFF_TELE2  e.g. +37125000002
  BAKEOFF_BITE   e.g. +37126000003

Credentials come from the usual groups — TWILIO_*, BULKGATE_*, BUDGETSMS_* —
and a provider whose group is absent is skipped by name, not silently.`;

/** §4.1, `observed` 2026-08-14. Re-observe at bake-off time (#137). */
const RATES_OBSERVED_ON = '2026-08-14';
const RATE_EUR_PER_SEGMENT = { bulkgate: 0.0311, budgetsms: 0.045 } as const;
const RATE_USD_PER_SEGMENT_TWILIO = 0.0715;
/** §4.1's range, used so no FX rate has to be pinned. */
const EUR_PER_USD_RANGE = { low: 1.3, high: 1.0 } as const;

/** Illustrative only — nothing here requests a real OTP. */
const OTP_CODE = '482913';

/** A worst-case LV driver name: diacritics in both words. */
const PROBE_PARAMS = {
  driver: 'Ģirts Šķēle',
  plate: 'LV-1234',
  eta: '7',
  link: 'https://sakta.lv/t/abc123',
} as const;

type ProviderKind = 'twilio' | 'bulkgate' | 'budgetsms';
type Operator = 'LMT' | 'Tele2' | 'Bite';

interface Probe {
  /** The `template` column. */
  label: string;
  body: string;
  /** Rounds this probe runs in; `undefined` means every round. */
  onlyRound?: number;
}

interface Row {
  round: number;
  provider: ProviderKind;
  operator: Operator;
  template: string;
  sentAt: string;
  apiResult: string;
  apiSegments: string;
}

/**
 * The providers' own success payloads, captured off the Nest logger.
 *
 * The seam is `Promise<void>` and stays that way (#137 asks to OBSERVE the
 * error shape through the existing contract, not to widen it), so the vendor's
 * message id and its own segment count reach the caller only through the log
 * line. Capturing them here is the `mint-tracked-ride.ts` shape — in-process,
 * the payloads arrive as objects rather than as text to be regexed. The lines
 * still print: this tees, it does not swallow.
 */
function captureProviderLogs(): Record<string, unknown>[] {
  const captured: Record<string, unknown>[] = [];
  // Separating the method from its object is the whole point — `patched`
  // re-attaches `this` with `.call` below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = Logger.prototype.log;
  Logger.prototype.log = function patched(
    this: Logger,
    message: unknown,
    ...rest: unknown[]
  ) {
    if (message !== null && typeof message === 'object') {
      captured.push(message as Record<string, unknown>);
    }
    return (original as (...a: unknown[]) => void).call(this, message, ...rest);
  } as typeof Logger.prototype.log;
  return captured;
}

function main(): Promise<void> {
  // ARGV AND RECIPIENTS FIRST, env second. The other order makes a bare
  // invocation throw a ZodError about DATABASE_URL instead of printing this
  // usage — nothing dotenv-loads for a plain script.
  const argv = process.argv.slice(2);
  const confirm = argv.includes('--confirm');
  const testsms = argv.includes('--testsms');
  const roundArg = argv[argv.indexOf('--round') + 1];
  const round = argv.includes('--round') ? Number(roundArg) : 1;

  if (!Number.isInteger(round) || round < 1) {
    console.error(`--round takes a positive integer (got ${String(roundArg)})`);
    process.exitCode = 1;
    return Promise.resolve();
  }

  const recipients = {
    LMT: process.env.BAKEOFF_LMT,
    Tele2: process.env.BAKEOFF_TELE2,
    Bite: process.env.BAKEOFF_BITE,
  };
  const missingRecipients = Object.entries(recipients)
    .filter(([, v]) => !v)
    .map(([k]) => `BAKEOFF_${k.toUpperCase()}`);
  if (missingRecipients.length > 0) {
    console.error(`${USAGE}\n\nmissing: ${missingRecipients.join(', ')}`);
    process.exitCode = 1;
    return Promise.resolve();
  }

  // The REAL schema, so credentials are vetted by production's own rules
  // rather than by a looser script-local check.
  let env: Env;
  try {
    env = envSchema.parse(process.env);
  } catch (err) {
    console.error(
      err instanceof z.ZodError
        ? `the environment does not parse — run from a shell that sourced the root env file:\n${err.issues
            .map((i) => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n')}`
        : String(err),
    );
    process.exitCode = 1;
    return Promise.resolve();
  }

  return run({
    env,
    confirm,
    testsms,
    round,
    recipients: recipients as Record<Operator, string>,
  });
}

async function run(opts: {
  env: Env;
  confirm: boolean;
  testsms: boolean;
  round: number;
  recipients: Record<Operator, string>;
}): Promise<void> {
  const { env, confirm, testsms, round, recipients } = opts;

  const probes: Probe[] = [
    // OTP FIRST, in every round. If credit runs out mid-round the criterion
    // that survives is the one on the login path, which is what #137 is
    // protecting. The 2-segment probes are the encoding test and can be
    // re-run; a missing OTP result makes the whole round uninformative.
    {
      label: 'otp_code',
      body: formatMessage('lv', 'sms.otp_code', { code: OTP_CODE }),
    },
    {
      label: 'driver_assigned_lv',
      body: formatMessage('lv', 'sms.driver_assigned', PROBE_PARAMS),
    },
    {
      // Cyrillic is always UCS-2 (§4.2) and can route differently from
      // Latin-with-diacritics — but that is an encoding question, not a
      // time-of-day one, so one round answers it.
      label: 'driver_assigned_ru',
      body: formatMessage('ru', 'sms.driver_assigned', PROBE_PARAMS),
      onlyRound: 1,
    },
  ].filter((p) => p.onlyRound === undefined || p.onlyRound === round);

  const { available, skipped } = selectProviders(env, testsms);

  printPlan({
    probes,
    available,
    skipped,
    recipients,
    round,
    confirm,
    testsms,
  });

  if (!confirm) {
    console.log(
      '\nDRY RUN — nothing was sent. Add --confirm to send this matrix.',
    );
    return;
  }
  if (available.length === 0) {
    console.error(
      '\nnothing to send: no provider is both funded and eligible.',
    );
    process.exitCode = 1;
    return;
  }

  const captured = captureProviderLogs();
  const rows: Row[] = [];
  for (const { kind, provider } of available) {
    for (const probe of probes) {
      for (const operator of ['LMT', 'Tele2', 'Bite'] as const) {
        rows.push(
          await sendOne({
            round,
            kind,
            provider,
            operator,
            phone: recipients[operator],
            probe,
            captured,
          }),
        );
      }
    }
  }

  printRows(rows);
}

async function sendOne(args: {
  round: number;
  kind: ProviderKind;
  provider: { send(phone: string, body: string): Promise<void> };
  operator: Operator;
  phone: string;
  probe: Probe;
  captured: Record<string, unknown>[];
}): Promise<Row> {
  const { round, kind, provider, operator, phone, probe, captured } = args;
  const mark = captured.length;
  // To the second: time-to-inbox is this against the handset's own SMS
  // timestamp, both on network time, and differences under 5 s are clock
  // noise rather than latency.
  const sentAt = new Date().toISOString().slice(11, 19);
  try {
    await provider.send(phone, probe.body);
    // THE VENDOR'S OWN NUMBERS, not this script's estimate. `api segments` is
    // what the API reported — the column exists to settle BulkGate's
    // `expected` `part_id` counting rule, which an estimate cannot do. A
    // `~`-prefixed value means nothing was captured and the estimate is
    // standing in, visibly.
    const sent = captured
      .slice(mark)
      .find(
        (p) => typeof p.event === 'string' && p.event.startsWith('auth.sms.'),
      );
    // `smsId` on the two new providers, `sid` on Twilio.
    const rawId = sent?.smsId ?? sent?.sid;
    const vendorId =
      typeof rawId === 'string' || typeof rawId === 'number'
        ? String(rawId)
        : undefined;
    return {
      round,
      provider: kind,
      operator,
      template: probe.label,
      sentAt,
      apiResult: vendorId === undefined ? 'ok' : `ok ${vendorId}`,
      apiSegments:
        typeof sent?.segments === 'number'
          ? String(sent.segments)
          : `~${segmentsFor(probe.body)}`,
    };
  } catch (err) {
    // The thrown `Error.message` VERBATIM — this is criterion 5's evidence,
    // observed through the real seam contract rather than described. The
    // providers compose these locally and leak neither phone nor body.
    return {
      round,
      provider: kind,
      operator,
      template: probe.label,
      sentAt,
      apiResult: `ERR ${err instanceof Error ? err.message : String(err)}`,
      apiSegments: '—',
    };
  }
}

function selectProviders(
  env: Env,
  testsms: boolean,
): {
  available: {
    kind: ProviderKind;
    provider: { send(phone: string, body: string): Promise<void> };
  }[];
  skipped: string[];
} {
  const available: {
    kind: ProviderKind;
    provider: { send(phone: string, body: string): Promise<void> };
  }[] = [];
  const skipped: string[] = [];

  if (
    env.BUDGETSMS_USERNAME &&
    env.BUDGETSMS_USERID &&
    env.BUDGETSMS_HANDLE &&
    env.BUDGETSMS_FROM
  ) {
    available.push({
      kind: 'budgetsms',
      provider: new BudgetSmsProvider({
        username: env.BUDGETSMS_USERNAME,
        userid: env.BUDGETSMS_USERID,
        handle: env.BUDGETSMS_HANDLE,
        from: env.BUDGETSMS_FROM,
        // The free pre-flight is a SCRIPT concern: same provider class, same
        // request building, same response parsing, different endpoint.
        ...(testsms ? { baseUrl: 'https://api.budgetsms.net/testsms/' } : {}),
      }),
    });
  } else {
    skipped.push('budgetsms (BUDGETSMS_* not set)');
  }

  if (testsms) {
    // Say so rather than implying the pre-flight covered all three.
    skipped.push('bulkgate (--testsms has no BulkGate equivalent)');
    skipped.push('twilio (--testsms has no Twilio equivalent)');
    return { available, skipped };
  }

  if (
    env.BULKGATE_APPLICATION_ID &&
    env.BULKGATE_APPLICATION_TOKEN &&
    env.BULKGATE_SENDER_ID_VALUE
  ) {
    available.push({
      kind: 'bulkgate',
      provider: new BulkGateSmsProvider({
        applicationId: env.BULKGATE_APPLICATION_ID,
        applicationToken: env.BULKGATE_APPLICATION_TOKEN,
        senderIdValue: env.BULKGATE_SENDER_ID_VALUE,
      }),
    });
  } else {
    skipped.push('bulkgate (BULKGATE_* not set)');
  }

  if (
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_FROM_NUMBER
  ) {
    available.push({
      kind: 'twilio',
      provider: new TwilioSmsProvider({
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        from: env.TWILIO_FROM_NUMBER,
      }),
    });
  } else {
    skipped.push('twilio (TWILIO_* not set)');
  }

  return { available, skipped };
}

function printPlan(args: {
  probes: Probe[];
  available: { kind: ProviderKind }[];
  skipped: string[];
  recipients: Record<Operator, string>;
  round: number;
  confirm: boolean;
  testsms: boolean;
}): void {
  const { probes, available, skipped, recipients, round, confirm, testsms } =
    args;

  console.log(`# SMS bake-off (#137) — round ${round}`);
  console.log(
    `mode: ${confirm ? 'SEND' : 'dry run'}${testsms ? ' · --testsms (BudgetSMS only, no credit, no delivery)' : ''}`,
  );
  console.log(
    `handsets: ${(Object.keys(recipients) as Operator[])
      .map((o) => `${o} ${maskRecipient(recipients[o])}`)
      .join(' · ')}`,
  );
  console.log(
    `providers: ${available.map((p) => p.kind).join(', ') || 'none'}`,
  );
  for (const s of skipped) console.log(`  skipped: ${s}`);

  console.log('\n## Matrix');
  console.log('| provider | template | encoding | segments | operators |');
  console.log('|---|---|---|---|---|');
  let totalSegments = 0;
  for (const { kind } of available) {
    for (const probe of probes) {
      const segments = segmentsFor(probe.body);
      totalSegments += segments * 3;
      console.log(
        `| ${kind} | ${probe.label} | ${isGsm7(probe.body) ? 'GSM-7' : 'UCS-2'} | ${segments} | LMT, Tele2, Bite |`,
      );
    }
  }

  console.log(`\n## Spend, this invocation (derived)`);
  console.log(
    `${totalSegments} segments total. Rates are §4.1's, \`observed ${RATES_OBSERVED_ON}\` — #137 says re-observe them at bake-off time, so this is not a quote.`,
  );
  for (const { kind } of available) {
    const segments = probes.reduce((n, p) => n + segmentsFor(p.body) * 3, 0);
    console.log(
      `  ${kind}: ${segments} segments = ${costLabel(kind, segments)}`,
    );
  }
  if (testsms) {
    console.log(
      '  (--testsms: BudgetSMS deducts no credit, so the figure above is what it WOULD cost.)',
    );
  }
}

function printRows(rows: Row[]): void {
  console.log('\n## Rows — paste into docs/research/sms-bakeoff-scorecard.md');
  console.log(
    '| round | provider | operator | template | sent at (UTC) | api result | api segments | received at | sender shown | body intact |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(
      `| ${r.round} | ${r.provider} | ${r.operator} | ${r.template} | ${r.sentAt} | ${r.apiResult} | ${r.apiSegments} | | | |`,
    );
  }
  console.log(
    "\nThe three trailing columns are the handset's half — fill them within ~10 minutes, while it is still obvious which message was which.",
  );
}

function costLabel(kind: ProviderKind, segments: number): string {
  if (kind === 'twilio') {
    const usd = segments * RATE_USD_PER_SEGMENT_TWILIO;
    const low = usd / EUR_PER_USD_RANGE.low;
    const high = usd / EUR_PER_USD_RANGE.high;
    return `$${usd.toFixed(2)} = €${low.toFixed(2)}–€${high.toFixed(2)} (EUR/USD 1.3–1.0)`;
  }
  return `€${(segments * RATE_EUR_PER_SEGMENT[kind]).toFixed(2)}`;
}

/**
 * `derived`, and an ESTIMATE. It feeds the DRY RUN's matrix and spend, where
 * nothing has been sent and no vendor count exists yet; in the rows table the
 * vendors' own counts supersede it, and a `~` prefix marks the rare row where
 * no log line was captured and this stood in.
 *
 * GSM-7 bills 160 chars single / 153 concatenated; UCS-2 bills 70 / 67. The
 * extension-table characters (`^{}\[~]|€`) bill as TWO under GSM-7 and this
 * does not weight them: the only template containing one is the LV
 * `driver_assigned` (`~`), and its diacritics already force UCS-2, where the
 * weighting does not apply. `.length` is UTF-16 units, which is exactly what
 * UCS-2 counts.
 */
function segmentsFor(body: string): number {
  const [single, concatenated] = isGsm7(body) ? [160, 153] : [70, 67];
  return body.length <= single ? 1 : Math.ceil(body.length / concatenated);
}

/** The recipients are the operator's own handsets, but logging-standard.md is logging-standard.md. */
function maskRecipient(phone: string): string {
  return `${phone.slice(0, 4)}${'*'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-3)}`;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
