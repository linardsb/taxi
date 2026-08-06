# Ride state machine (reference)

**Source of truth: `packages/shared/src/ride-state-machine.ts`** — this doc explains it; if they disagree, the code wins and this doc gets fixed.

```
scheduled ─────► requested ──► offered ──► accepted ──► arriving ──► arrived ──► in_progress ──► completed ──► settled
 (timer)            │  ▲          │ (decline/timeout
                    │  └──────────┘  re-offer loop)
                    └──► queued ──► offered            (geozone_queue mode)
```

- **Entry**: instant rides enter at `requested`; scheduled rides ("izsaukumi uz laiku") enter at `scheduled` and a timer promotes them to `requested`.
- **Multi-taxi orders**: one order → N rides sharing `orderId`, each running the machine independently.
- **Cancellations** (all terminal): rider/driver can cancel until `in_progress`; dispatcher can cancel anything up to and including `in_progress`; system cancels only pre-acceptance states (no driver found, offer exhausted, payment preauth failed).
- **Payment lock (Atis's hard rule)**: `isPaymentMethodLocked()` is true from `accepted` onward — the rider cannot change payment method once a driver has the job. Enforced by `PATCH /rides/:rideId/payment-method`, which answers 409 `payment_method_locked` from `accepted` on and 409 `ride_not_editable` on a terminal ride (over, not locked).
- **settled** means money movement finished (ledger entries written) — `completed` is the physical end of the ride, `settled` the financial one. `completed → settled` is NOT implemented: it belongs to #12, together with the ledger rows that make it true.
