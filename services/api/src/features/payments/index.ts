/**
 * The payments slice's public API — nothing outside imports past this file.
 *
 * Owns the `PaymentsProvider` seam wiring (Stripe in TEST MODE ONLY) and the
 * settlement orchestration behind `POST /rides/:rideId/settle`: charge (card
 * only, OUTSIDE the transaction), then in one transaction take
 * `completed → settled`, post the ledger and apply the balance delta.
 *
 * THE STRIPE SDK IS IMPORTED IN NO FILE OUTSIDE THIS FOLDER — only
 * `stripe-payments.provider.ts` (types) and `payments.module.ts` (the client).
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - NO RIDER CARD ENROLLMENT. `users.payment_customer_ref` /
 *   `payment_instrument_ref` are filled by #17; a card ride for a rider missing
 *   either answers 409 `payment_instrument_missing` rather than inventing a
 *   charge — and, since #70, logs `payment.settlement.refused` with the
 *   rideId.
 * - NO `balance` OR `corporate` SETTLEMENT — and, since #70, NO `balance` OR
 *   `corporate` BOOKING: `BOOKABLE_PAYMENT_METHODS` (`@taxi/shared`) narrows
 *   both wire bodies (`POST /rides` and
 *   `PATCH /rides/:rideId/payment-method`), so a ride that cannot settle can
 *   no longer be created. Both stay `PAYMENT_METHOD_TYPES` values and both
 *   are post-MVP; `settle`'s 409 `payment_method_unsupported` remains as
 *   defence in depth and now logs `payment.settlement.refused`. The ledger
 *   SHAPE accommodates them — each would simply omit the collection pair —
 *   but the flow does not.
 * - NO WEBHOOKS. `STRIPE_WEBHOOK_SECRET` sits unused in `.env.example` and stays
 *   unused: the charge is synchronous and confirmed in the same call, and no
 *   asynchronous payment method (SEPA Direct Debit, Bancontact) is enabled.
 * - NO REFUNDS, NO PARTIAL CAPTURES, NO CANCELLATION FEES, NO NO-SHOW CHARGES.
 *   All are money movements with no evidenced policy.
 * - NO PRE-AUTHORIZATION AT BOOKING, therefore `cancelled_by_system` STILL HAS
 *   NO PRODUCER. The rides barrel names "#12's payment-preauth failure" as its
 *   eventual caller; this ticket charges at settlement instead, so that gap
 *   survives. Whether to pre-authorize at request time is undecided — it costs a
 *   Stripe call per booking and would let the platform refuse a ride the rider
 *   cannot pay for.
 * - NO SETTLEMENT SWEEPER AND NO RETRY AUTOMATION. A `completed` ride that never
 *   settles sits there: no sweeper, no alert, no admin view. Accepted because no
 *   production client calls this route yet (#15 and #17 are unbuilt), and
 *   mitigated three ways rather than none — the route is idempotent and callable
 *   by `dispatcher`/`admin` (so a stuck ride is recoverable by hand today),
 *   every CHARGE AND WRITE failure logs a distinct `payment.settlement.*` event
 *   with the rideId — including `write_failed`, the
 *   charge-succeeded-then-rolled-back case, which carries the PaymentIntent so
 *   the LOG can tell a ride that was charged from one that never was (the query
 *   below surfaces the stuck ride, the log explains it — the query selects no
 *   `payment_provider_ref`, and the rollback has set that column back to NULL
 *   anyway). NOT EVERY CHARGED RIDE LOGS AN INTENT, THOUGH: a `charge_failed`
 *   carrying a NULL ref may ALSO have been charged — a timeout after Stripe took
 *   the money has no intent to carry (`settlement.service.ts`), and re-POSTing
 *   `settle` is only safe inside the bound `settlement.policy.ts` states. And
 *   unsettled money is one query:
 *     SELECT id, order_id, driver_id, payment_method, total_cents, updated_at
 *     FROM rides WHERE status = 'completed' ORDER BY updated_at;
 *   The real fix is #15 calling `settle` right after `complete` and retrying.
 *   MOST EXITS THAT NEVER REACH THE PROVIDER STILL LOG NOTHING — #70
 *   tabulates them (no count here: the table is the one place worth keeping
 *   exact). The exceptions, since #70, are `payment_method_unsupported` and
 *   `payment_instrument_missing`, the two that bite: each now logs a
 *   warn-level `payment.settlement.refused` carrying the rideId and cause,
 *   so the query above surfaces the stuck ride and the log says why. The
 *   benign `already_settled` exit keeps its debug-level
 *   `payment.settlement.rejected`, as it did before #70. The rest are
 *   silent on purpose: the request-shape guards (404 / 403 /
 *   `ride_not_completed`) mean the caller sent the wrong thing — the ride is
 *   not stuck because of them — and the data-bug 500s throw loud `Error`s
 *   that surface through Nest's exception logging.
 * - NO PAYOUT RAIL. Getting money TO a driver is a separate ticket; see the
 *   ledger barrel for how `'payout'` entries accommodate both rails spike #5
 *   names.
 */
export { PaymentsModule, paymentsProviderFactory } from './payments.module';
export { SettlementService } from './settlement.service';
export type { SettleInput, SettlementActor } from './settlement.service';
export { settlementIdempotencyKey } from './settlement.policy';
export { PAYMENTS_PROVIDER } from './payments.tokens';
