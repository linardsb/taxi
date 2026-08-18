# Ride state machine (reference)

**Source of truth: `packages/shared/src/ride-state-machine.ts`** — this doc explains it; if they disagree, the code wins and this doc gets fixed.

```
scheduled ─────► requested ──► offered ──► accepted ──► arriving ──► arrived ──► in_progress ──► completed ──► settled
 (timer)            │  ▲  ▲       │ (decline/timeout
                    │  └──┼───────┘  re-offer loop)
                    │     └──────────────────┴─── dispatcher release (#19)
                    └──► queued ──► offered            (geozone_queue mode)
```

- **Dispatcher release** is the one BACKWARD edge in the machine: `accepted → requested` and `arriving → requested`, written by `ReassignService` when Dina swaps the car on a ride that already has one. Deliberately absent from `arrived` and `in_progress` — a driver standing at the pickup, or carrying the passenger, is a cancellation. Consumers written against a forward-only lifecycle need to know this edge exists; `isPaymentMethodLocked()` is a pure function of status, so the release re-opens payment editing for the seconds before a driver re-accepts (decided, see #120).

- **Entry**: instant rides enter at `requested`; scheduled rides ("izsaukumi uz laiku") enter at `scheduled` and a timer promotes them to `requested`.
- **Multi-taxi orders**: one order → N rides sharing `orderId`, each running the machine independently.
- **Cancellations** (all terminal): rider/driver can cancel until `in_progress`; dispatcher can cancel anything up to and including `in_progress`; system cancels only pre-acceptance states (no driver found, offer exhausted, payment preauth failed).
- **Payment lock (Atis's hard rule)**: `isPaymentMethodLocked()` is true from `accepted` onward — the rider cannot change payment method once a driver has the job. Enforced by `PATCH /rides/:rideId/payment-method`, which answers 409 `payment_method_locked` from `accepted` on and 409 `ride_not_editable` on a terminal ride (over, not locked).
- **settled** means money movement finished (ledger entries written) — `completed` is the physical end of the ride, `settled` the financial one. `completed → settled` is implemented by `POST /rides/:rideId/settle` (#12, `features/payments`): a card ride charges through the `PaymentsProvider` seam first (outside the transaction), then the transition, the six ledger entries and the driver's balance delta all commit together. **The transition IS the settlement lock** — exactly one caller wins the edge, and a loser is answered with the already-settled ride rather than a 409, because the Stripe idempotency key is derived from the ride (`settle:<rideId>`) and both attempts are one charge. Settling is therefore idempotent: the route returns the settled ride (201, matching its sibling `complete`) however many times it is called. A `settled` ride therefore always has ledger rows; a `completed` one never does.
