# Sakta Cab — Lean Hypothesis PRD

**Status: LIVING DRAFT — the project-start gate. Anketa first pass is IN (76/76 answered 2026-07-06/07; translation + synthesis in `anketa-findings.md`). Review with Atis; the spec (01-spec.md) follows once the hypothesis + anketa-derived features settle.**
**Date:** 2026-07-06, evidence updated 2026-07-09 · **Author:** Linards + Claude · **Canon:** second-brain `prd-best-practices.md` (lean PRD, hypothesis with RIGHT and WRONG conditions) · **Evidence:** `anketa-findings.md`

## Problem statement

Rīga's ride-hailing market is dominated by Bolt, and its drivers carry the cost. First-pass anketa numbers (Atis, working Bolt driver, our partner): Bolt's base commission is **25% plus a surge margin the driver never sees** — he cannot see what the passenger pays at all; his single documented worst gap is a ride where **the passenger paid €200 and he received €130** (35%). Add penalties over "mixed-up addresses" and support that didn't resolve his last issue. On the rider side, competitors do specific jobs badly or not at all — no professional dispatcher who knows the city (Panda's phone dispatch exists but "dispatchers don't know Rīga"), unreliable scheduled pickups, no multi-taxi orders, and near-unusable apps for blind users — Atis independently named **blind clients** as demand no service covers. Evidence base: anketa first pass 76/76 answered (2026-07-06/07), translated and synthesized in `anketa-findings.md`; documentary screenshots still to be collected (follow-up round open).

## Why now

- Atis is committed as the business partner and driver-side insider (self-rated readiness **10/10** in the anketa); Dina is the planned dispatcher — and the anketa revealed she **headed the planning & scheduling department at Lady Taxi**, working directly with taxi drivers. The differentiator staffing exists, credentialed, before the software does.
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

*Numbers are provisional — to be pressure-tested against anketa findings and set final with Atis before pilot. The switch test: drivers switch for money (30% → ~10–15% is a raise); riders switch only for reliability at price parity. Solving the driver problem is the bet; rider UX is table stakes. Anketa first pass confirms the wedge: fair commission = **14%**, he wouldn't even consider switching above **16%**, and he prefers a **flat 15% with no bonus games** over 25%-with-bonuses. **Decision (Linards, 2026-07-09): launch commission = 10% flat** — under even the "fair" line, so the driver pitch is unambiguous (Bolt keeps 25, we keep 10). His pilot-guarantee thresholds: €15/h or €500/week; at 0% + guarantee for 3 months he's in.*

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
| Anketa numbers soft where it matters most | Respondents can produce hard weekly numbers + screenshots when nudged | Precizējumi round (12-item list in `anketa-findings.md`) before any number goes into a pitch |

## Open questions

1. ~~Exact commission %~~ **DECIDED (Linards, 2026-07-09): launch at 10% flat, no penalty fees.** Deliberately under the evidenced band (fair = 14%, switch ceiling = 16% — `anketa-findings.md`) to maximize the recruitment wedge. Stays config-not-constant; revisit against pilot unit economics.
2. Driver payout rails — Stripe Connect availability/cost for LV drivers vs SEPA batch transfers? *New wrinkle: instant-payout importance contradicts itself in the anketa (1/10 score vs rank #2 switch reason) — clarify before building rails.*
3. ATD registration requirements for a dispatching platform (vs taxi operator) — exact obligations? *(Still open; Atis's legal status "Other" (S1-4) also unresolved — affects onboarding/tax design.)*
4. Rider acquisition: what makes the first 500 riders download an app with 20 cars? *Partial: phone-booking segments named (elderly, hotels, bars, restaurants); autoosta partnership door = its marketing manager; rider pitch order = cheaper → call-or-app → local.*
5. ~~Which Rīga geozones open first~~ **Evidenced: center + RIX + Old Town/nightlife + autoosta; peaks weekdays 07–09:30 & 16:30–19:00, Fri/Sat nights** — final zone cut with Atis.
6. SIA formation timing (blocks Stripe live mode, Apple company account).
7. **New:** does the evidence dossier materialize? Zero screenshots uploaded so far — the Bolt weekly report (S2-1) is the single most important missing artifact.

## Success metrics (pilot window: first 3 months, Rīga)

- **Driver-side (primary):** active drivers/week · rides per driver per shift · driver M1 retention.
- **Rider-side:** completed rides/week · median pickup ETA · repeat-ride rate within 30 days.
- **Guardrails:** ride cancellation rate <15% · complaints per 100 rides trending down · Google Maps + SMS spend within budget.

## Experiments (thinnest slices first)

1. **Anketa** (first pass complete 2026-07-07; precizējumi round open) — numbers on Bolt economics + feature validation from the two insiders landed in `anketa-findings.md`; screenshots still owed. Output feeds commission model and backlog.
2. **Demo** (no deadline, quality-first) — one ride end-to-end across all four surfaces **plus the three differentiators** (scheduled ride, multi-taxi order, shared-ride price knock-down) shown to Atis & Dina.
3. **Driver LOI test** — before pilot spend, pitch the commission model to drivers from Atis's network; count signed/verbal commitments against the ≥20-driver RIGHT condition.
4. **Rīga soft pilot** — limited geozones, staffed dispatcher hours, measure the RIGHT/WRONG conditions above.

---
*Not here by design: architecture, stack, data model, phases — those live in `docs/skeleton-proposal.md` (spec precursor) and the spec that follows this gate.*
