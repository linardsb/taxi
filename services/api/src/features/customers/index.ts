/**
 * The customers slice's public API — the phone channel's caller record (#19).
 *
 * `CustomersRepository` is exported alongside the service because the
 * dispatcher-booking slice resolves a caller's identity through it before
 * delegating to `RidesService`: that path needs find-or-create on a `users` row
 * inside its own flow, which is a repository operation and not a lookup.
 */
export { CustomersModule } from './customers.module';
export { CustomersService } from './customers.service';
export type { VenueEntry } from './customers.service';
export { CustomersRepository } from './customers.repository';
