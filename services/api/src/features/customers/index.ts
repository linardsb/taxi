/**
 * The customers slice's public API — the phone channel's caller record (#19).
 *
 * `CustomersRepository` is exported alongside the service because the
 * dispatcher-booking slice resolves a caller's identity through it, inside
 * `RidesService.requestForCaller`: that path needs find-or-create on a `users`
 * row inside its own flow, which is a repository operation and not a lookup.
 *
 * PROVISIONAL IDENTITIES (#123). The phone path mints `users` rows the person
 * never took part in creating, so every such row carries `provisioned_by` — the
 * dispatcher who filed it — and the person's first OTP signup ADOPTS it at the
 * role they signed up for (`AuthRepository.adoptProvisional`), rather than
 * keeping the `rider` role a booking gave them. `findOrCreateUser`'s conflict
 * clause still never sets `role` or the marker: a row its owner created stays
 * untouchable. A booking mints nothing until the reservation, the dispatcher's
 * cap and the quote have all cleared, so a refused one leaves no row behind.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - `CustomersService.upsert` still lets a dispatcher file a row for any
 *   number with no booking behind it. It is marked provisional now, so it
 *   blocks nobody's signup, and it names who filed it.
 * - Rows minted between #19 Phase B (PR #122) and #123 have NULL
 *   `provisioned_by` and are not adoptable; nothing backfills them, because no
 *   column recorded which rows the phone path created. An OTP signup on one
 *   still keeps the `rider` role, exactly as before #123.
 * - A booking whose ride INSERT fails after the quote (a database fault, not a
 *   refusal) keeps the caller's rows. They are provisional, so adoptable.
 */
export { CustomersModule } from './customers.module';
export { CustomersService } from './customers.service';
export { CustomersRepository } from './customers.repository';
