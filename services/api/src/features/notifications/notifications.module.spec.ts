import { APP_ENV } from '../../common/config/env.schema';
import { smsProviderFactory, SMS_PROVIDER } from '../auth';
import { NotificationsModule } from './notifications.module';

describe('NotificationsModule SMS binding', () => {
  it("binds SMS_PROVIDER to auth's smsProviderFactory (edge)", () => {
    // MODULE METADATA IS THE ONLY POSSIBLE HOME FOR THIS ASSERTION, and that
    // is a finding rather than a shortcut. #137's AC — "OTP and ride SMS both
    // go through the selected provider" — is structurally true only while this
    // module binds the SAME factory the auth slice does, and IDENTITY is the
    // half no integration test can see: `test/harness.ts` calls
    // `.overrideProvider(SMS_PROVIDER).useValue(sms)`, so whatever this module
    // names, every integration test is handed a `RecordingSmsProvider`. Swap
    // this entry for a same-shaped local fork and the whole suite stays green
    // — while the fork carries no production boot-refusal, because forking
    // the factory forks that guarantee (`auth/index.ts` says so where it
    // exports this one).
    //
    // What an integration test DOES catch is this binding's ABSENCE, and
    // loudly: `overrideProvider` merges into modules that already declare the
    // token and never creates one (`@nestjs/core`'s `Module.replace` is gated
    // on `hasProvider`), nothing this module imports exports `SMS_PROVIDER`,
    // and `ride-notifications.service.ts` injects it non-optionally. So the
    // shape to guard against here is a SILENT FORK, not a deletion.
    //
    // Both halves proven by reverting, at PR #241 review round 1: deleting
    // the `SMS_PROVIDER` entry from `notifications.module.ts`'s `providers`
    // makes this case red AND makes `dispatch.integration.spec.ts` fail to
    // build the graph ("Nest can't resolve dependencies of the
    // RideNotificationsService", 28 failed of 28); changing only the factory
    // reference leaves that integration suite green and this case red.
    // Binding restored after both.
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
