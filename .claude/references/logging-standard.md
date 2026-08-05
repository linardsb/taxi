# Logging standard (reference)

Structured JSON logs, event names as `domain.component.action_state`.

- **domain**: ride | dispatch | payment | auth | driver | geo | realtime | support
  - `realtime` is the socket transport itself — handshakes, room joins, token expiry. It is deliberately its own domain rather than folded into `driver`/`dispatch`, because a connection event belongs to no business domain: a dispatcher's handshake is not a `driver` event, and a rider's has no home at all.
- **component**: the feature slice emitting it
- **action_state**: verb + state, e.g. `offer_sent`, `offer_expired`, `match_failed`, `transition_rejected`

Examples: `ride.lifecycle.transition_applied`, `dispatch.auto_match.offer_expired`, `payment.ledger.settlement_written`, `auth.otp.send_failed`.

Rules:
- Always include: `rideId`/`orderId`/`driverId`/`userId` when known, `event`, `at`.
- Never log: full phone numbers (mask to last 3 digits), addresses beyond geozone name, card data (never touches us anyway — Stripe tokens only).
- Every state-machine rejection logs `ride.lifecycle.transition_rejected` with `from`, `to`, `actor` — these are the dispatch bugs you'll debug at 02:00.
