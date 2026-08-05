/**
 * The platform-config slice's public API — nothing outside imports past this
 * file. The repository is deliberately absent: the service is the boundary.
 *
 * Reads the per-city knobs the platform runs on. Pricing consumes
 * `commissionPct` today; #10 consumes `offerTimeoutSeconds`,
 * `defaultDispatchMode` and `unclaimedAlertSeconds` next.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - No controller. #20 adds the admin routes that WRITE this table; today it is
 *   read-only and edited by hand or by the seed.
 * - No cache. Every call is a query; see the service docblock for why that is
 *   deliberate rather than pending.
 */
export { PlatformConfigModule } from './platform-config.module';
export { PlatformConfigService } from './platform-config.service';
