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
 *   charge.
 * - NO `balance` OR `corporate` SETTLEMENT. Both are `PAYMENT_METHOD_TYPES`
 *   values and both are post-MVP; `settle` answers 409
 *   `payment_method_unsupported`. The ledger SHAPE accommodates them — each
 *   would simply omit the collection pair — but the flow does not.
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
 *   the query below can tell a ride that was charged from one that never was —
 *   and unsettled money is one query:
 *     SELECT id, order_id, driver_id, payment_method, total_cents, updated_at
 *     FROM rides WHERE status = 'completed' ORDER BY updated_at;
 *   The real fix is #15 calling `settle` right after `complete` and retrying.
 *   THE EXITS THAT NEVER REACH THE PROVIDER LOG NOTHING — six of them, tabulated
 *   in #70. `payment_method_unsupported` and `payment_instrument_missing` are
 *   the two that will bite: the query above surfaces the stuck ride, and nothing
 *   says why. A diagnosis gap, not a loss one — no provider call happens on any
 *   of them.
 * - NO PAYOUT RAIL. Getting money TO a driver is a separate ticket; see the
 *   ledger barrel for how `'payout'` entries accommodate both rails spike #5
 *   names.
 */
export { PaymentsModule, paymentsProviderFactory } from './payments.module';
export { SettlementService } from './settlement.service';
export type { SettleInput, SettlementActor } from './settlement.service';
export { settlementIdempotencyKey } from './settlement.policy';
export { PAYMENTS_PROVIDER } from './payments.tokens';
