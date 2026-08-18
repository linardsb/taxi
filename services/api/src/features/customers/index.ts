/**
 * The customers slice's public API — the phone channel's caller record (#19).
 *
 * `CustomersRepository` is exported alongside the service because the
 * dispatcher-booking slice resolves a caller's identity through it before
 * delegating to `RidesService`: that path needs find-or-create on a `users` row
 * inside its own flow, which is a repository operation and not a lookup.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - A `users` ROW IS NOW MINTED WITHOUT THE PERSON PARTICIPATING, and nothing
 *   marks it as provisional. Three faces of one gap:
 *   `findOrCreateUser` deliberately never sets `role` on conflict — that is the
 *   privilege-escalation defence and it stays — so a person Dina phone-booked
 *   who later signs up as a DRIVER silently keeps the `rider` role their
 *   booking created: they get a rider session and a driver app that cannot
 *   work, with no error naming the cause. `CustomersService.upsert` lets a
 *   dispatcher mint a row for any number with no booking behind it. And
 *   identity resolution runs BEFORE both the idempotency reservation and the
 *   rate limit, so a booking that then fails still leaves the rows behind
 *   permanently. The sharper reverse direction is already blocked: a phone
 *   belonging to a driver or dispatcher is refused outright.
 *   The fix is a provisional marker on `users` that an OTP signup ADOPTS
 *   rather than collides with — a schema change plus an auth-path change, which
 *   is its own ticket (#123) and not this slice's to make.
 */
export { CustomersModule } from './customers.module';
export { CustomersService } from './customers.service';
export { CustomersRepository } from './customers.repository';
