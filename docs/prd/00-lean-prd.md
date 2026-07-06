# Sakta Cab — Lean Hypothesis PRD

**Status: LIVING DRAFT — the project-start gate. The exact feature list is deliberately NOT final here: it gets added/finalized from the anketa answers (Atis & Dina, the product developers, questionnaire in progress). Review with Atis; the spec (01-spec.md) follows once the hypothesis + anketa-derived features settle.**
**Date:** 2026-07-06 · **Author:** Linards + Claude · **Canon:** second-brain `prd-best-practices.md` (lean PRD, hypothesis with RIGHT and WRONG conditions)

## Problem statement

Rīga's ride-hailing market is dominated by Bolt, and its drivers carry the cost: Atis (working Bolt driver, our partner) pays an **effective ~30% commission** and describes penalty and support practices bad enough that we are collecting documentary evidence (screenshots via the anketa). On the rider side, competitors do specific jobs badly or not at all — no professional 24/7 dispatcher, unreliable scheduled pickups, no multi-taxi orders, and near-unusable apps for blind users. Evidence base: firsthand from Atis (driver, Bolt) and Dina (working dispatcher, Rīga autoosta), being formalized in the Sakta Cab anketa (76 questions, running).

## Why now

- Atis is committed as the business partner and driver-side insider; Dina is the planned dispatcher — the differentiator staffing exists before the software does.
- Bolt's driver terms create a recruitment wedge: a platform taking ~half the commission is a direct raise for a driver who switches.
- AI-assisted solo development makes a four-surface platform buildable by one person at near-zero payroll — the cost structure that historically made "compete with Bolt" absurd no longer holds.
- The anketa is already gathering the numbers that turn this from opinion into evidence.

## Hypothesis

> **We believe that** a driver-first taxi platform (per-ride commission far below Bolt's ~30%, geozone queue fairness, a human 24/7 dispatcher)
> **will cause** licensed independent taxi drivers in Rīga, recruited from zero through Atis's driver network,
> **to** join, stay online, and route their working hours through the platform,
> **resulting in** enough reliable supply that riders in central Rīga get competitive pickup times — and supply is the whole game; riders follow supply.
>
> **We'll know we're RIGHT if** ≥20 drivers are active (≥1 shift/week) and the platform completes ≥200 rides/week within 3 months of the Rīga pilot opening, with ≥30% of riders taking a repeat ride within a month.
> **We'll know we're WRONG if** after 3 months of pilot we have <10 active drivers, or monthly driver churn exceeds 50%, or the median pickup ETA in the pilot geozones exceeds 15 minutes (riders won't switch, regardless of driver goodwill).

*Numbers are provisional — to be pressure-tested against anketa findings and set final with Atis before pilot. The switch test: drivers switch for money (30% → ~10–15% is a raise); riders switch only for reliability at price parity. Solving the driver problem is the bet; rider UX is table stakes.*

## Target user

- **Primary:** licensed independent taxi drivers in Rīga dissatisfied with Bolt's commission and treatment.
- **Secondary:** riders underserved by competitors — people needing scheduled pickups, transfers (multi-taxi), dispatcher-grade phone service, corporate accounts, and blind riders (screen-reader-first booking).
- **Explicitly NOT (v1):** other cities' supply, price-only mass-market riders we'd have to buy with subsidies, fleet owners.

## Non-goals (v1)

- Food/parcel delivery, scooters, or anything that isn't a person in a car.
- Own fleet operations (schema supports it later; not in v1 ops).
- The driver-cooperative legal structure (parallel track, not blocking the platform).
- Full-scale shared-ride pooling optimization — v1 ships the basic version (route-overlap price knock-down), not a pooling engine.
- In-app rider↔driver chat auto-translation (flagged "for discussion" in the outline; later).

## Risks & assumptions

| Risk | Assumption it rests on | De-risk |
|---|---|---|
| Driver supply from zero | Atis's network + commission wedge actually convert | Anketa evidence → pitch deck → driver LOIs before pilot spend |
| Regulatory (ATD platform registration, SIA needed) | Registration is attainable for a small platform | Legal research early; SIA formation before pilot; Atis's ATD folder |
| One dispatcher (Dina) ≠ 24/7 | Pilot volume fits staffed hours | Phase dispatcher hours; dispatcher-off fallback = pure auto-match |
| €100/mo budget vs Google Maps costs | Free credit + caching covers pilot volume | Cache geocodes/routes, monitor spend weekly, OSM fallback seam |
| Solo builder bus factor | Strict conventions keep the repo handoff-able | Per-app CLAUDE.md, VSA, deterministic validation gates |

## Open questions

1. Exact commission % (anketa → what feels like a raise but sustains the platform?)
2. Driver payout rails — Stripe Connect availability/cost for LV drivers vs SEPA batch transfers?
3. ATD registration requirements for a dispatching platform (vs taxi operator) — exact obligations?
4. Rider acquisition: what makes the first 500 riders download an app with 20 cars?
5. Which Rīga geozones open first (center + RIX + autoosta?)
6. SIA formation timing (blocks Stripe live mode, Apple company account).

## Success metrics (pilot window: first 3 months, Rīga)

- **Driver-side (primary):** active drivers/week · rides per driver per shift · driver M1 retention.
- **Rider-side:** completed rides/week · median pickup ETA · repeat-ride rate within 30 days.
- **Guardrails:** ride cancellation rate <15% · complaints per 100 rides trending down · Google Maps + SMS spend within budget.

## Experiments (thinnest slices first)

1. **Anketa** (running) — hard numbers on Bolt economics + feature validation from the two insiders. Output feeds commission model and backlog.
2. **Demo** (no deadline, quality-first) — one ride end-to-end across all four surfaces **plus the three differentiators** (scheduled ride, multi-taxi order, shared-ride price knock-down) shown to Atis & Dina.
3. **Driver LOI test** — before pilot spend, pitch the commission model to drivers from Atis's network; count signed/verbal commitments against the ≥20-driver RIGHT condition.
4. **Rīga soft pilot** — limited geozones, staffed dispatcher hours, measure the RIGHT/WRONG conditions above.

---
*Not here by design: architecture, stack, data model, phases — those live in `docs/skeleton-proposal.md` (spec precursor) and the spec that follows this gate.*
