# MVP Traceability Map — PRD intent → tickets

**Created:** 2026-08-07 (surface re-slice session). **Purpose:** prove the re-slice lost no PRD functionality. Every MVP component and differentiator from `sakta-cab.prd.md` §6 maps to the ticket(s) that carry it. Update whenever tickets are re-cut. Rule: a row may change *packaging*; it may never silently lose *capability* — any deferral must be flagged in the last column and accepted by Linards.

## Core loop (PRD §6)

| PRD capability | Ticket(s) | Status 2026-08-07 | Packaging change / deferral |
|---|---|---|---|
| Rider requests via app | #16 | open (re-cut: native, text-first, screen-reader AC) | none — native confirmed, PWA rejected |
| Rider requests via phone (Dina) | #19 | open (re-cut: keyboard-first form, caller-ID pop, venue accounts) | none — scope grew (venue quick-book) |
| Auto-match with dispatcher override | #10 (engine) ✅ + #18/#19 (console UI) | engine shipped; console open | none |
| Ride execution loop (accept→…→paid) | #11 ✅ | shipped | none |
| Payment: card and cash | #12 | open, next up | none (SEPA batch + Stripe test mode per spike #5) |
| Driver sees full fare + 15% split | #15 | open (re-cut: offer card "you keep €X", constant-arithmetic receipt) | none — scope sharpened |
| DB / contracts / auth / realtime foundation | #6 #7 #8 #9 ✅ | shipped | none |

## Differentiators (PRD §6, all 8 preserved)

| # | Differentiator | Ticket(s) | Status | Packaging change / deferral |
|---|---|---|---|---|
| 1 | Scheduled rides | #21 | open (re-cut: named-driver-early + auto-credit-if-late guarantee) | none — scope grew (the anti-Bolt guarantee) |
| 2 | Multi-taxi orders | #22 | open, untouched | none |
| 3 | Shared-ride knock-down | #23 | open, untouched | none |
| 4 | Demand-wave radar | #25 | open (re-cut: RIX arrivals screen, no heatmaps) | autoosta half re-scoped to scheduled±buffer (spike #3 finding — no live feed exists anywhere) |
| 5 | Return-ride matching | #26 | open, untouched (+ queue-position-hold note from research) | none |
| 6 | Loyalty commission | #27 | open (re-cut note: tenure/quality only, never acceptance rate, vests immediately) | none — guardrail added |
| 7 | Screen-reader-first rider app | #16/#17 | open (re-cut: SR task-success = acceptance criterion) | none — strengthened by native decision |
| 8 | Hybrid dispatch console, boring reliability | #18/#19 | open (re-cut: connection pill, snapshot resync, alarm budget, degraded mode) | none — reliability now specified, not aspirational |

## Supporting surfaces & new capabilities

| Capability | Ticket(s) | Status | Packaging change / deferral |
|---|---|---|---|
| Admin: driver approval, config, stats | #20 | open (re-cut: minimal bespoke in merged app) | **stats** → Metabase (capability preserved, tool changed); **support-inbox stub → DEFERRED** (accepted 2026-08-07: pilot support = Dina's phone + direct line to Linards); **legal** → public static pages (was never really admin UI) |
| Dispatch+admin as separate web apps | #18/#19/#20 | — | **merged into one Next.js app** (role route groups) — packaging only, role boundaries intact |
| SMS statuses + live-tracking web page (phone bookings, share-trip, blind-rider assistants) | NEW ticket (2026-08-07) | open | new capability — replaces what a rider PWA would have offered, serves PRD phone-segment JTBD |
| Deploy (Railway) | #13 | open, untouched | none |
| Demo checkpoint to Atis & Dina | #24 | open, untouched | none (stays a checkpoint, not a scope gate) |
| Driver app foundation (gated by spike #4) | #14 | open (field drive scheduled) | none |

## Deferral register (needs explicit acceptance)

> Admin-side deferrals are consolidated with their triggers in GitHub issue **#64** (admin post-pilot backlog) — that issue is the operational parking lot; this register stays the acceptance record.

| Deferral | Accepted by | Date | Revisit trigger |
|---|---|---|---|
| Support-inbox stub (was in #20) | Linards | 2026-08-07 | first pilot week where phone-support load is unmanageable |
| iOS Live Activity (lock-screen ride card) | Linards | 2026-08-07 | post-pilot phase 2 (evidence: Uber −2.26%/−2.13% cancellations — worth building, not pilot-blocking) |
| Metabase deployment | Linards | 2026-08-07 | first recurring stats question Linards answers manually twice |
| SIP screen-pop automation (caller-ID works via manual number entry day-1) | Linards | 2026-08-07 | week 2+ of pilot, if call volume justifies VoIP setup |
