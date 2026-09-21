import { Logger } from '@nestjs/common';
import type { Env } from '../../common/config/env.schema';
import { APP_ENV } from '../../common/config/env.schema';
import { smsEnvFields } from '../../common/config/sms-env.schema';
import { AuthModule, smsProviderFactory } from './auth.module';
import { BudgetSmsProvider } from './sms/budgetsms.provider';
import { BulkGateSmsProvider } from './sms/bulkgate-sms.provider';
import { SMS_PROVIDER } from './sms/sms.tokens';
import { StubSmsProvider } from './sms/stub-sms.provider';
import { TwilioSmsProvider } from './sms/twilio-sms.provider';

// `SMS_PROVIDER: 'stub'` is the schema's default (#137 retired `'auto'`), so
// every case that does not name a kind describes a realistic `Env`. The cast
// is still needed — these literals are deliberately partial — but
// `satisfies Partial<Env>` runs FIRST and checks the keys against the schema,
// so a typo like `SMS_PROVDER` is a TS2561 rather than a green suite testing a
// field the factory never reads. It has to wrap the whole literal:
// `SMS_PROVIDER: 'stub' satisfies Env['SMS_PROVIDER']` checks the value and
// says nothing about the key.
const env = (NODE_ENV: Env['NODE_ENV'], over: Partial<Env> = {}) =>
  ({ NODE_ENV, SMS_PROVIDER: 'stub', ...over }) satisfies Partial<Env> as Env;

const TRIO: Partial<Env> = {
  TWILIO_ACCOUNT_SID: 'AC' + 'f'.repeat(32),
  TWILIO_AUTH_TOKEN: 'auth-token-secret',
  TWILIO_FROM_NUMBER: '+37167000000',
};

const BULKGATE_GROUP: Partial<Env> = {
  BULKGATE_APPLICATION_ID: '12345',
  BULKGATE_APPLICATION_TOKEN: 'application-token-secret',
  BULKGATE_SENDER_ID_VALUE: 'SaktaCab',
};

const BUDGETSMS_GROUP: Partial<Env> = {
  BUDGETSMS_USERNAME: 'saktacab',
  BUDGETSMS_USERID: '123456',
  BUDGETSMS_HANDLE: 'handle-secret',
  BUDGETSMS_FROM: 'SaktaCab',
};

/**
 * One credential group per selectable kind. The exhaustiveness case below
 * fails if the enum grows a kind this table does not cover, so it is the
 * second of the three links that make adding a vendor a guided edit (the
 * first is `SMS_GROUPS`, which the compiler forces; the third is the factory
 * branch, which nothing else does).
 */
const CREDENTIAL_FIXTURES: Record<string, Partial<Env>> = {
  twilio: TRIO,
  bulkgate: BULKGATE_GROUP,
  budgetsms: BUDGETSMS_GROUP,
};

/**
 * The enum's own option list, READ BACK off a rejected parse rather than
 * copied into this file — a copy is what the assertion exists to catch.
 * `invalid_enum_value` carries `options` even though `{ message }` replaces
 * the issue's text, so the custom migration message costs nothing here.
 */
const selectableKinds = (): string[] => {
  const rejected = smsEnvFields.SMS_PROVIDER.safeParse('__not-a-selector__');
  if (rejected.success) {
    throw new Error('SMS_PROVIDER accepted a value no kind is named after');
  }
  const issue = rejected.error.issues[0];
  if (issue?.code !== 'invalid_enum_value') {
    throw new Error(`expected invalid_enum_value, got ${issue?.code}`);
  }
  return issue.options.map(String).filter((o) => o !== 'stub');
};

/**
 * Payloads captured from the module-level `Logger` inside the factory, across
 * `log`, `error` AND `warn`.
 *
 * ALL THREE LEVELS, and that is the whole point of the failure case below.
 * `logging-standard.md` puts a `_failed` state at `error` level, so an edit
 * adding `logger.error({ event: 'auth.sms.provider_bind_failed', … })` to the
 * refusal branch is the likely one — and a helper watching only `log` would
 * stay green through exactly the edit the case exists to make visible.
 * Found in PR #241's review round 1 fix pass, before the claim was published.
 */
const captureBootLog = (run: () => void): Record<string, unknown>[] => {
  const levels = ['log', 'error', 'warn'] as const;
  const spies = levels.map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(() => {}),
  );
  try {
    run();
    return spies.flatMap((spy) =>
      spy.mock.calls.map(([payload]) => payload as Record<string, unknown>),
    );
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
};

describe('smsProviderFactory', () => {
  it('provides the stub outside production (expected)', () => {
    expect(smsProviderFactory(env('development'))).toBeInstanceOf(
      StubSmsProvider,
    );
    expect(smsProviderFactory(env('test'))).toBeInstanceOf(StubSmsProvider);
  });

  it('binds Twilio when SMS_PROVIDER names it (expected)', () => {
    // Presence stopped selecting at #137 and `'auto'` went with it: the trio
    // is now the credential group `SMS_PROVIDER=twilio` DEMANDS, not the thing
    // that chooses Twilio. The values are only present when they passed the
    // schema's refines, so the factory's non-null assertions rest on the
    // superRefine rather than on a duplicated presence test.
    for (const NODE_ENV of ['development', 'test', 'production'] as const) {
      expect(
        smsProviderFactory(env(NODE_ENV, { ...TRIO, SMS_PROVIDER: 'twilio' })),
      ).toBeInstanceOf(TwilioSmsProvider);
    }
  });

  it('binds BulkGate when SMS_PROVIDER names it (expected)', () => {
    // Reachable only once the superRefine has confirmed the whole group, which
    // is what the factory's non-null assertions rest on.
    expect(
      smsProviderFactory(
        env('development', { ...BULKGATE_GROUP, SMS_PROVIDER: 'bulkgate' }),
      ),
    ).toBeInstanceOf(BulkGateSmsProvider);
  });

  it('binds BudgetSMS when SMS_PROVIDER names it (expected)', () => {
    expect(
      smsProviderFactory(
        env('development', { ...BUDGETSMS_GROUP, SMS_PROVIDER: 'budgetsms' }),
      ),
    ).toBeInstanceOf(BudgetSmsProvider);
  });

  it('lets an explicitly named kind beat a present TWILIO_* trio (edge)', () => {
    // The bake-off's whole point: two or three accounts are funded at once, so
    // presence cannot disambiguate them and the selector must win. Before
    // #137 this same Env bound Twilio.
    for (const NODE_ENV of ['development', 'test', 'production'] as const) {
      expect(
        smsProviderFactory(
          env(NODE_ENV, {
            ...TRIO,
            ...BULKGATE_GROUP,
            SMS_PROVIDER: 'bulkgate',
          }),
        ),
      ).toBeInstanceOf(BulkGateSmsProvider);
    }
  });

  it('refuses to boot in production (failure)', () => {
    // The stub delivers no SMS and logs the code in full, so an internet-facing
    // deploy that reached it hands sign-in to anyone with log read access.
    // Failing at boot is the point: a silent stub is worse than no boot.
    expect(() => smsProviderFactory(env('production'))).toThrow(
      /No production SmsProvider is bound/,
    );
  });

  it('throws in production with a trio AND a funded group present but SMS_PROVIDER=stub (edge)', () => {
    // THE REGRESSION THIS LOOP EXISTS TO CLOSE. Under #240's `'auto'` this
    // exact Env bound Twilio — silently, with no log line and no refusal —
    // while the operator had just funded BulkGate. Post bake-off it is the
    // likely shape of a real `.env`: two complete groups and a selector
    // nobody moved. It must now be a boot failure, not a bill.
    expect(() =>
      smsProviderFactory(
        env('production', {
          ...TRIO,
          ...BULKGATE_GROUP,
          SMS_PROVIDER: 'stub',
        }),
      ),
    ).toThrow(/No production SmsProvider is bound/);
  });

  it('binds the stub in development even with a complete TWILIO_* trio (edge)', () => {
    // The dev-ergonomics change #137's retirement makes, pinned so it is a
    // decision rather than a surprise: before it, real `TWILIO_*` values in a
    // developer's env file sent real SMS in development. Now they do not
    // until `SMS_PROVIDER=twilio` says so — and the factory's
    // `auth.sms.provider_bound` line names `stub` at every boot, so the
    // change is visible rather than silent.
    expect(smsProviderFactory(env('development', TRIO))).toBeInstanceOf(
      StubSmsProvider,
    );
  });

  it('names SMS_PROVIDER and the three selectable kinds when it refuses (failure)', () => {
    // The likeliest way to reach the refusal: an operator funds BulkGate, sets
    // all three BULKGATE_* vars and forgets the selector. The message must
    // send them to the variable that actually binds — and must NOT offer the
    // TWILIO_* trio as an alternative route, which it is no longer: since the
    // retirement the trio is the credential group `twilio` demands, and
    // setting it alone binds nothing.
    const boot = () =>
      smsProviderFactory(env('production', { ...BULKGATE_GROUP }));

    expect(boot).toThrow(/No production SmsProvider is bound/);
    expect(boot).toThrow(
      /Set SMS_PROVIDER to twilio, bulkgate or budgetsms together with that kind's whole credential group/,
    );
    expect(boot).toThrow(
      /A complete credential group does NOT bind on its own/,
    );
  });

  it('binds a real provider for every kind the enum lists (edge)', () => {
    // EXHAUSTIVENESS, and the reason it is a test rather than a `never` arm.
    // The factory is an `if` chain with no `default`, so adding a fifth kind
    // and forgetting its branch compiles: dev falls through to the stub while
    // the boot line still names the new vendor, and production throws
    // "SMS_PROVIDER is stub", sending the operator to a variable they set
    // correctly. Worst of all, `hetzner-deploy.md` §5.4 step 5's "two lines,
    // both naming the new kind" rollback check PASSES while the stub is
    // bound — the silent mis-selection this whole ticket exists to kill.
    //
    // Driven off the enum's own options, so it cannot go stale: add a kind
    // and this case demands a fixture above and a factory branch below.
    // Raised as M2 in PR #241's review round 1.
    const kinds = selectableKinds();
    expect(kinds).toEqual(expect.arrayContaining(['twilio']));

    for (const kind of kinds) {
      expect(Object.keys(CREDENTIAL_FIXTURES)).toContain(kind);
      const named = env('development', {
        ...CREDENTIAL_FIXTURES[kind],
        SMS_PROVIDER: kind as Env['SMS_PROVIDER'],
      });

      // Dev half: a missing branch falls through to `bind(new StubSmsProvider())`.
      expect(smsProviderFactory(named)).not.toBeInstanceOf(StubSmsProvider);
      // Production half: a missing branch reaches the refusal instead.
      expect(() =>
        smsProviderFactory({ ...named, NODE_ENV: 'production' }),
      ).not.toThrow();
    }
  });

  it('emits auth.sms.provider_bound naming the bound kind (expected)', () => {
    // `hetzner-deploy.md` §5.4 step 5 hard-codes `grep -c
    // auth.sms.provider_bound` and turns the count into the rollback decision
    // during a live vendor switch. Until this case existed, a rename, a
    // dropped `provider` key or a level change broke that procedure with
    // nothing red anywhere. Raised as M3 in PR #241's review round 1.
    const lines = captureBootLog(() => {
      smsProviderFactory(
        env('development', { ...BULKGATE_GROUP, SMS_PROVIDER: 'bulkgate' }),
      );
    });

    expect(lines).toEqual([
      expect.objectContaining({
        event: 'auth.sms.provider_bound',
        provider: 'bulkgate',
      }),
    ]);
  });

  it('logs the kind and never a credential (edge)', () => {
    // `logging-standard.md`'s never-log list. The BulkGate group's values are
    // all in scope here, so asserting the payload's exact key set is what
    // stops a later "add the sender ID, it helps debugging" edit.
    const [line] = captureBootLog(() => {
      smsProviderFactory(
        env('development', { ...BULKGATE_GROUP, SMS_PROVIDER: 'bulkgate' }),
      );
    });

    expect(Object.keys(line ?? {}).sort()).toEqual(['at', 'event', 'provider']);
    expect(JSON.stringify(line)).not.toContain(
      BULKGATE_GROUP.BULKGATE_APPLICATION_TOKEN,
    );
  });

  it('emits nothing at any level when it refuses to boot (failure)', () => {
    // The refusal is the one branch with no log line, deliberately: the thrown
    // error and the crash-looping container are the signal, and a line here
    // would report a boot that did not happen. Pinned so "add the missing
    // event for consistency" is a decision rather than a drive-by — and pinned
    // at `error` and `warn` as well as `log`, because the review's own
    // suggestion (`auth.sms.provider_bind_failed`) would land at `error`.
    const lines = captureBootLog(() => {
      expect(() => smsProviderFactory(env('production'))).toThrow(
        /No production SmsProvider is bound/,
      );
    });

    expect(lines).toEqual([]);
  });

  it('is what the module actually binds SMS_PROVIDER to (edge)', () => {
    // Without this, the two cases above pass just as happily against the
    // `useClass: StubSmsProvider` registration they exist to replace — the
    // factory would be dead code and production would still boot the stub.
    const providers = Reflect.getMetadata('providers', AuthModule) as {
      provide?: unknown;
      useClass?: unknown;
      useFactory?: unknown;
      inject?: unknown[];
    }[];
    const sms = providers.find((p) => p.provide === SMS_PROVIDER);

    expect(sms?.useFactory).toBe(smsProviderFactory);
    expect(sms?.inject).toEqual([APP_ENV]);
    expect(sms?.useClass).toBeUndefined();
  });
});
