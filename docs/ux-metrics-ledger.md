# UX Metrics Ledger — Sakta Cab

**Created:** 2026-08-07 (surface re-slice session). **Owner:** Linards. **Cadence:** weekly review during pilot (same sitting as the budget review in PRD §7); pre-pilot, review at each ticket's validation gate.
**Principle** (from the ST×UX synthesis, `~/Desktop/Linards_current/UX_UI_docs/ST_UX_fusion.txt`): measure **outcomes, not outputs** — the transition from frustration to delight, not feature counts or raw usage. A metric exists here only if it would change what we build or fix next; anything else is noise (the alarm-budget rule applied to ourselves).

How to use: each ticket's acceptance criteria bind to rows here (column "Ticket"). At weekly review, fill "Latest" from platform data; a red row generates next week's fix, not a debate. Targets are absolute standards — never ratchet a target down because we missed it ("drift to low performance" trap).

## Rider (app + phone channel)

| Metric (outcome) | Target | Ticket | Measured how | Latest |
|---|---|---|---|---|
| Taps from intent → booked (saved-address repeat ride) | ≤ 4 | #16 | manual friction audit per release; later event log | — |
| Screen-reader task success: book + track + pay, VoiceOver & TalkBack, unassisted | 100% of the critical path | #16/#17 | scripted SR audit per release (audit script lives in ticket) | — |
| Rider knows the car: plate + driver visible ≤ 2 interactions from any active-ride state | 100% | #17 | flow review + SR audit | — |
| Phone-booked rider gets confirmation + tracking link SMS | 100% of phone bookings, ≤ 30 s from booking save | SMS/tracking ticket | api logs (SMS provider seam) | — |
| Wrong-car starts (PIN mismatch events) | 0 | #17 | platform data | — |
| Scheduled ride: named driver + plate communicated before pickup window | 100%; late-pickup auto-credit paid without rider asking | #21 | platform data | — |
| Rider cancellation rate between match and pickup | < 10% (feeds PRD guardrail < 15% overall) | #17 | platform data, weekly | — |

## Driver

| Metric (outcome) | Target | Ticket | Measured how | Latest |
|---|---|---|---|---|
| Offer card answers accept/decline without any further tap (fare, keep-€, destination, pickup km/ETA, €/km, payment method, rider rating) | 100% of offers; 20–30 s timer | #15 | offer-card spec review + field feedback | — |
| Driver can state their queue position and why any skip happened | position always visible; every deviation carries a one-line explanation | #15 (+#10 engine) | UI review; driver interviews at pilot | — |
| Per-trip receipt shows constant arithmetic: rider paid → 15% → driver kept | 100% of trips, no exceptions ever | #15 (+#12 ledger) | receipt spec + ledger tests | — |
| Time from ride completed → earnings visible in today's total | ≤ 5 s | #15 | field check | — |
| Offer → accept rate | tracked, no target (informational — never a penalty input) | #15 | platform data | — |
| Driver-app fix gap during a shift (GPS stream continuity) | per spike #4 pass criteria (moving gaps p95 ≤ 30 s, max ≤ 120 s) | #14 | fixes telemetry | — |

## Dispatch (Dina's console)

| Metric (outcome) | Target | Ticket | Measured how | Latest |
|---|---|---|---|---|
| Phone booking entered, repeat caller (lookup → prefill → save) | ≤ 30 s | #19 | console event timestamps (call-start proxy: form-open) | — |
| Phone booking entered, new caller | ≤ 60 s | #19 | same | — |
| Booking form data lost on disconnect/refresh | 0 (draft persists) | #18/#19 | chaos test in validation; Dina's report | — |
| Console staleness without visible warning | 0 — connection pill always truthful; snapshot resync on reconnect | #18 | fault-injection test | — |
| Alarm budget: audible/toast alerts requiring no action | 0 by design; total alerts < 6/hour in normal ops (ISA-18.2) | #18 | alert-event log, weekly | — |
| Cascade-exhausted (Unassigned) rides visibly surfaced ≤ 2 s | 100% | #18 | e2e test | — |
| Venue (hotel/bar) booking via quick-book account | ≤ 15 s | #19 | console event timestamps | — |

## Pilot-level additions to PRD §7 (tracked here, reported alongside PRD metrics)

| Metric | Why it's here |
|---|---|
| Phone-booking entry time (median) | The channel bet — validates Dina's console as a competitive weapon, not just a fallback |
| Rider taps-to-book (repeat) | The friction-audit rule made measurable |
| Driver offer→accept rate + decline reasons | Early-warning for offer-card or fare problems (never a driver penalty) |
| SMS spend €/week | Budget guardrail feed (tracking-link + status SMS volume) |

## Review log

| Date | Red rows | Action taken |
|---|---|---|
| — | — | — |
