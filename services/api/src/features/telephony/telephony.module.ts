import { Module } from '@nestjs/common';
import { StubTelephonyProvider } from './stub-telephony.provider';
import { TELEPHONY_PROVIDER } from './telephony.tokens';

/**
 * Binds the `TelephonyProvider` seam — and, unlike `mapsProviderSourceFactory`,
 * DOES NOT refuse to boot in production on the stub.
 *
 * The difference is what an unbound provider costs. An unbound maps provider
 * quotes real money off straight-line geometry, so a production boot on it is a
 * money bug. An unbound telephony provider means Dina types the caller's number
 * instead of the gateway popping it — the documented day-1 plan for #19, and
 * the console's behaviour is identical either way. Refusing to boot would block
 * the pilot over a feature the pilot deliberately does not have.
 */
@Module({
  providers: [{ provide: TELEPHONY_PROVIDER, useClass: StubTelephonyProvider }],
  exports: [TELEPHONY_PROVIDER],
})
export class TelephonyModule {}
