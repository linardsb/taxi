# Sakta Cab — Product PRD (what & why)

**Status:** ACTIVE — main product PRD. Supersedes `docs/prd/00-lean-prd.md` (kept as historical draft).
**Date:** 2026-08-03 · **Author:** Linards + Claude
**Evidence appendix:** `docs/prd/anketa-findings.md` (EN translation + synthesis of the 76-question anketa answered by Atis & Dina, 2026-07-06/07). The anketa app itself (`app/` + `backend/`) is disposable now that answers are preserved there and in the Google Sheet.

---

## 1. Problem statement

Rīga's ride-hailing market is dominated by Bolt, and drivers carry the cost. A working Bolt driver (Atis, 25 years in the trade) pays a **25% base commission plus a surge margin he never sees** — he cannot see what the passenger pays at all. His single documented worst case: **the passenger paid €200, he received €130** (a 35% gap). Add penalties over "mixed-up addresses" and support that failed to resolve his last issue. The only phone-dispatch alternative (Panda, 19%) staffs dispatchers who "don't know Rīga/Latvia."

On the rider side, specific jobs go unserved: no dispatcher-grade phone booking by someone who knows the city, unreliable scheduled pickups, no multi-car orders, and near-unusable apps for blind users — Atis independently named **blind clients** as demand no service covers.

The cost of not solving it: drivers keep surrendering a quarter-plus of every fare to a foreign platform with no local accountability, and the underserved rider segments (elderly phone-bookers, hotels, blind riders, group transfers) stay underserved.

## 2. Evidence

All from `anketa-findings.md` unless noted. What's evidenced vs assumed:

**Evidenced (anketa, 2026-07-06/07):**
- Bolt base commission 25% + surge margin; Panda 19% (S6-1). Driver cannot see the passenger fare (S2-5). €200→€130 gap on one ride (S2-4). Penalties over address mix-ups (S2-7). Support failed to resolve (S4-1).
- "Fair" commission per both respondents = **14%** (S10-1); Atis wouldn't consider switching above **16%** (S2-9c); he prefers **flat 15% with no bonus games** over 25%-with-bonuses (S2-9a).
- What pulls drivers, ranked (S6-4): lower commission → instant payout → better app → guaranteed minimum → human Latvian support → local company → no penalties → co-op share.
- What pulls riders, ranked (S10-3): cheaper → **can both call and use the app** → local → money stays in Latvia → safer → happier drivers.
- Blind riders = unserved demand, named unprompted (S5-8).
- Dispatch: hybrid model confirmed — auto-assign with **dispatcher override/force-assign** (S9-2, S9-4); district queue fairness and phone-a-real-human are Dina's top carry-overs from the autoosta (S7-2). Phone segment: elderly, hotels, bars, restaurants (S9-3).
- Demand geography & waves: RIX at arrival times, Old Town evenings, nightlife, big events (S5-2); autoosta bus-arrival data exists (S8-5); empty-km ~8%, worse with distance from Rīga (S5-3); peaks weekdays 07:00–09:30 & 16:30–19:00, Fri/Sat nights (S5-5, S7-3).
- Commitment: both rate readiness **10/10** (S11-4). Dina formerly **headed planning & scheduling at Lady Taxi** (S11-1).

**Assumed — validate:**
- Driver reach beyond Atis: honest estimate **~5–10 drivers** via his network (Linards, 2026-08-03); S6-6 came back "don't know". Validate by Atis actually pitching and counting (runs in parallel with the build — not a build gate).
- Hard Bolt weekly numbers: the precizējumi round (13 items, sent 2026-07-09) has produced nothing yet; **decision 2026-08-03: continue as-is**, dossier fills in when it fills in.
- Rider willingness to switch at price parity — no rider-side evidence exists at all yet.

## 3. Thesis — why build it

**Drivers switch for money; riders follow supply.** A flat **15% commission** — exactly the model Atis said he'd prefer, no penalties, no bonus games, full fare transparency — is a direct raise of ~10 percentage points per ride for any Bolt driver. That wedge, delivered by a **local company with a dispatcher who actually knows Rīga**, is something Bolt structurally won't match (their margin) and Panda can't staff (their dispatchers).

**Why now:** Atis (driver-side insider, partner) and Dina (professionally credentialed taxi dispatcher) are committed 10/10, on equity — the differentiator staffing exists before the software does. SIA formation and ATD registration are already in progress. Linards is building **full-time**; AI-assisted solo development makes a four-surface platform buildable at near-zero payroll, which is the cost structure that historically made "compete with Bolt" absurd.

**Why they'd switch from how they cope today:** drivers today cope by tolerating Bolt or running Bolt+Panda in parallel (S6-2) — a 15% flat rate with transparency beats both on the #1 ranked switch reason. Riders today cope with Bolt's app or Panda's disoriented phone line — Sakta Cab is the only offer that does **both channels well**, plus scheduled rides, group orders, and a screen-reader-first app nobody else provides.

## 4. Hypothesis

> **We believe** a driver-first platform (flat 15% commission, no penalties, fare transparency, district queue fairness, human phone dispatch) **will cause** licensed independent taxi drivers in greater Rīga, recruited through Atis's network and its word-of-mouth edges, **to** join, stay online, and route their working hours through the platform, **resulting in** enough reliable supply that riders get competitive pickup times — supply is the whole game; riders follow supply.
>
> **We'll know we're RIGHT if** ≥10 drivers are active (≥1 shift/week) and the platform completes **≥100 rides/week** within 3 months of pilot opening (target: **Q4 2026**), with ≥30% of riders taking a repeat ride within a month.
>
> **We'll know we're WRONG if** after 3 months we have **<5 active drivers**, or monthly driver churn exceeds 50%, or median pickup ETA in the pilot area exceeds 15 minutes — riders won't switch regardless of driver goodwill.

Decisions locked 2026-08-03 (Linards): **commission 15% flat from day one, for everyone — no intro promo** (config-not-constant in code). Driver targets lowered from the lean draft's ≥20 to ≥10 to match honest reach. Build proceeds regardless of LOI outcomes; LOI conversations still happen and feed the RIGHT condition.

## 5. Target user & JTBD

**Primary — the driver.** Licensed independent taxi driver in greater Rīga, dissatisfied with Bolt's commission and treatment.
*JTBD:* "When I finish a working week of 60 hours at the wheel, I want to keep a transparent, predictable share of every fare I earned, so I can stop feeling like the platform's employee-without-rights and see the work pay."

**Secondary — underserved riders.** Elderly phone-bookers, hotels/bars/restaurants, groups needing multi-car orders, scheduled-pickup users, and blind riders.
*JTBD (phone segment):* "When I need a taxi, I want to call a real person who knows the city and confirms my ride, so I can trust it will actually come." *JTBD (blind rider):* "When I book a ride, I want the entire flow to work flawlessly with my screen reader, so I can travel independently."

**Non-users (v1):** other cities' supply, price-only mass-market riders who'd need to be bought with subsidies, fleet owners, delivery of anything that isn't a person in a car.

## 6. MVP

The thinnest line that proves the hypothesis is a driver-visible, rider-usable ride loop with the differentiators the pitch depends on:

**Core loop:** rider requests (app **or** phone via Dina's console) → auto-match with dispatcher override → ride → payment (**card and cash**) → driver sees the full fare and the 15% split.

**Differentiators in MVP** (each traces to evidence):
1. **Scheduled rides** — book a future pickup (hotels, airport).
2. **Multi-taxi orders** — one booking, several cars.
3. **Shared-ride price knock-down** — basic route-overlap discount, not a pooling engine.
4. **Demand-wave radar** — RIX flight + autoosta bus arrival data drive a "position yourself now" signal for drivers (S8-5: the data exists).
5. **Return-ride matching** — out-of-Rīga rides auto-search a paid return pickup, attacking empty kilometres (S5-3).
6. **Loyalty commission** — tenure/quality-based % discount, config-driven (S4-5).
7. **Screen-reader-first rider app** — launch requirement, not fast-follow.
8. **Hybrid dispatch console** — Dina's screen: auto-assign + force-assign, district queue fairness, boring reliability (her autoosta system "often freezes" — ours must not).

**Geography:** greater Rīga (city + surrounding areas like Pierīga/Jūrmala), with the evidenced hotspots (centre, RIX, Old Town/nightlife, autoosta) as the queue-fairness districts.

**Sequencing within the MVP** (thinnest-first, so the hypothesis is testable before everything ships): core loop + driver fare transparency + phone dispatch prove the driver wedge; differentiators 1–6 layer on before/at pilot. *Scope honesty: this is a fat MVP for one builder against a Q4 2026 pilot — see open question #1.*

## 7. Success metrics (pilot window: first 3 months)

| Metric | Target | Measured how |
|---|---|---|
| Active drivers (≥1 shift/week) | ≥10 | platform data, weekly |
| Completed rides/week | ≥100 by month 3 | platform data |
| Repeat-ride rate | ≥30% of riders ride again within 30 days | platform data |
| Median pickup ETA (pilot area) | ≤15 min | platform data |
| Driver monthly churn | <50% (guardrail) | platform data |
| Cancellation rate | <15% (guardrail) | platform data |
| Phone-channel share | tracked, no target — validates the channel bet | dispatch console |
| Infra + maps + SMS spend | within budget guardrail | weekly review |

## 8. Non-goals (v1)

- **The Konkurences padome / evidence-dossier advocacy track** — continues as a separate track, not part of this product.
- Food/parcel delivery, scooters — nothing that isn't a person in a car.
- Own fleet operations (schema may allow later; not v1 ops).
- The driver-cooperative legal structure (parallel track; ranked last, 8/8, as a driver switch reason).
- Full pooling optimization engine (v1 = basic knock-down only).
- Rider↔driver chat auto-translation.
- Other cities.
- Gating the build on driver LOIs (decided: build regardless).

## 9. Open questions

- [ ] **MVP scope vs Q4 2026** — 8 MVP components, solo builder, ~4 months. What gets cut or staged if the date slips? (The architecture/spec stage must sequence this.)
- [ ] **Unit economics at 15%** — was pilot revenue-vs-cost modeled after the move from 10%→15%? Whether the pilot must self-sustain was not decided.
- [ ] **Rider acquisition** — what makes the first 500 riders try an app/phone line with ~10 cars? Phone segments are named (elderly, hotels, bars, restaurants); the autoosta partnership door is its marketing manager (S8-4). No plan yet.
- [ ] **Driver payout rails** — Stripe Connect for LV drivers vs SEPA batch; the anketa's instant-payout contradiction (1/10 importance vs #2 switch rank, S2-8 vs S6-4) is still unresolved.
- [ ] **Atis's legal/tax status** (S1-4 "Other", never clarified) — affects onboarding and payout design.
- [ ] **Precizējumi evidence** — Bolt weekly screenshot, Dina's console drawing, all screenshots still outstanding; continuing without them, but any public/pitch number waits for verification.
- [ ] **Cash-ride commission settlement** — how the 15% on cash rides is collected from drivers (product-level policy; mechanics go to the spec).
- [ ] **Equity split** — Atis & Dina are on equity/partnership; the actual split and vesting are undocumented.
- [ ] **ATD registration detail** — in progress; exact obligations for a dispatch platform still to be confirmed.

---

Architecture: [sakta-cab.architecture.md](./sakta-cab.architecture.md) (decided 2026-08-03; builds on `docs/skeleton-proposal.md`, supersedes it where they disagree).
