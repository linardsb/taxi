/**
 * The telephony slice's public API.
 *
 * KNOWN GAP — seen and accepted, not overlooked: no gateway is bound, and
 * nothing injects `TELEPHONY_PROVIDER` yet. The slice exists so that screen-pop
 * automation is a binding change rather than a console rewrite (#19 Q4 / the
 * architecture's named missing piece). The caller-ID path ships on manual
 * entry: `POST /customers/lookup`'s input is whatever Dina typed.
 */
export { TelephonyModule } from './telephony.module';
export { StubTelephonyProvider } from './stub-telephony.provider';
export { TELEPHONY_PROVIDER } from './telephony.tokens';
