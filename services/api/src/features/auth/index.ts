/** The auth slice's public API — nothing outside imports past this file. */
export { AuthModule } from './auth.module';
export { AuthTokenService } from './auth-token.service';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export { RolesGuard } from './guards/roles.guard';
export { Public, IS_PUBLIC } from './decorators/public.decorator';
export { Roles, ROLES_KEY } from './decorators/roles.decorator';
export { CurrentUser } from './decorators/current-user.decorator';
export { SMS_PROVIDER } from './sms/sms.tokens';
/** For notifications' own SMS_PROVIDER binding — the ONE factory carrying the production boot-refusal; forking it would fork that guarantee. */
export { smsProviderFactory } from './auth.module';
/** The one masker every log with a phone number uses (logging-standard.md). */
export { maskPhone } from './phone-mask';
