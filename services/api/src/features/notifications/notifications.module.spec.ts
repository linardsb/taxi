import { APP_ENV } from '../../common/config/env.schema';
import { smsProviderFactory, SMS_PROVIDER } from '../auth';
import { NotificationsModule } from './notifications.module';

describe('NotificationsModule SMS binding', () => {
  it("binds SMS_PROVIDER to auth's smsProviderFactory (edge)", () => {
    // MODULE METADATA IS THE ONLY POSSIBLE HOME FOR THIS ASSERTION, and that
    // is a finding rather than a shortcut. #137's AC — "OTP and ride SMS both
    // go through the selected provider" — is structurally true only while this
    // module binds the SAME factory the auth slice does. An integration test
    // cannot check it: `test/harness.ts` calls
    // `.overrideProvider(SMS_PROVIDER).useValue(sms)`, which resolves by token
    // across the whole compiled graph, so `RideNotificationsService` would be
    // handed a `RecordingSmsProvider` whether this binding exists or not. Such
    // a test is GREEN against a deleted binding — the same defect class as
    // #16's C1, a test that pins the wiring it replaced.
    //
    // Proven by reverting: delete the `SMS_PROVIDER` entry from
    // `notifications.module.ts`'s `providers` and this case goes red
    // (performed at implementation time, binding restored).
    //
    // Identity, not shape: a same-shaped local function would carry no
    // production boot-refusal, and forking the factory forks that guarantee
    // (`auth/index.ts` says so where it exports this one).
    const providers = Reflect.getMetadata('providers', NotificationsModule) as {
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
