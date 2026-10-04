# PRD — Sakta Cab compliance: lawful to operate in Latvia

**Status:** draft, 2026-10-04. **Parent:** `docs/epics/sakta-cab.prd.md` (this epic is a launch prerequisite of that product). **Evidence:**
- `docs/research/vid-platform-reporting.md`: Latvian platform law, with verbatim quotes;
- `docs/research/gdpr-platform-obligations.md`;
- `docs/research/compliance-code-gaps.md`;
- `docs/research/append-only-enforcement-options.md` (engineering input, for `plan-architecture`).

**Trigger:** Atis's message of 30.09.2026, which relayed VID's confirmation that online data submission is in force.

## 1. Problem statement

Sakta Cab cannot lawfully take a single paid ride in Latvia today. Three groups are affected.

- **The founders (Linards, Atis).** Their pilot will be blocked or shut down: under Autopārvadājumu likums 35.² (3), an unregistered app is blocked. ATD (the road transport authority) checks the app's functionality before it registers a platform (MK 541 p. 2.4, p. 3), and supervises it every year (p. 13).
- **The carriers and drivers who join.** They are jointly liable with the platform for the service (40. (14)). The platform must not list a carrier, driver or car that lacks the licences the law requires (35.² (4)); doing so carries a fine.
- **Riders.** Their trip and location data is processed with no privacy notice, no stated retention period and no way to exercise their rights. The regulator's DPIA list makes a data protection impact assessment mandatory for this kind of tracking.

**Cost of not solving it:** no launch at all, or a launch the regulator can shut down. The trip records written before compliance existed are also non-compliant: the platform may not delete or correct them (35.² (5)), so data built up in the wrong shape cannot be fixed afterwards.

## 2. Evidence

**Decided:** Sakta Cab operates under the *vieglais automobilis* regime: app-booked rides in passenger cars, licensed under MK 389 (Linards, 2026-10-04). Every 40. (13) rule therefore applies in full:
- the driver calculates the fare in the app;
- no ride may run while the app is offline;
- no cash;
- no passenger may be taken through any other way of ordering.

**Evidenced** (primary text, verified against likumi.lv on 2026-10-04):
- **Registration.** It requires an EU-registered *komersants* and costs €2 800 (35.² (1) 1); MK 848 p. 33). A UK company does not qualify.
- **Reporting.** Offered, carrier-refused and provided trips, drivers and vehicles must be reported to VID (35.² (6)). Nine fields go "immediately" after each completed trip (MK 541 p. 11).
- **No deleting or correcting.** Accepted, refused and provided trips, drivers and vehicles may not be deleted or corrected (35.² (5)). They must be kept for at least 5 years in an EU or NATO country (35.² (6)).
- **Cash.** No cash for app-booked rides (40. (13) 3)). The rider must get online cashless payment and an e-invoice by email (35.² (1) 5) c)).
- **What the app must provide:**
  - the carrier registers its own drivers and cars (MK 541 p. 7.1);
  - payment method chosen before the request (p. 7.2);
  - a refusal reason given to the passenger (p. 7.3);
  - 3 months of trips for the driver (p. 7.4);
  - 5 years of trips for the carrier (p. 7.5);
  - what the rider sees (p. 8): the carrier, the driver's register number, the plate, the tariffs and an estimate.
- **VID access.** VID gets access, including the encryption keys, within 10 working days (MK 541 p. 10).
- **Where the code falls short:** a driver can delete a car and erase its link to past rides (G1, G2); there is no ride history (G4); no carrier record and no licence fields (G5); cancel and refusal reasons are not stored (G3); backups are deleted after 30 days (G7); there is no staff access log (G10). Full list: `compliance-code-gaps.md`.

**Assumed (validate as stated):**
- That phone bookings entered by a dispatcher are lawful under 40. (13) 4). Lawyer.
- That a rider's identity is not among the records protected from deletion, so an erasure request can pseudonymise it. Lawyer.

## 3. Thesis — why build it, why now

- **Why this.** A driver-first platform that loses its registration loses the drivers who trusted it. Compliance is the ground the pilot stands on, not a feature. Building it in now costs a slice of work. Bolting it on later costs data that can never be corrected (35.² (5)) and a re-registration.
- **Why now.** Atis relayed VID's confirmation that online submission is in force. The pilot is planned for Q4 2026. Nothing is in production, so the data model can still change freely; after the first real trip it cannot.
- **Why it beats how the founders cope today.** Today the plan is "launch, then sort out the paperwork", and the law makes that impossible: unregistered means blocked, and wrongly recorded data cannot be corrected. Doing it upfront also gives the pitch something extra: drivers are told their trip history can never be quietly edited, which is the transparency promise already in the parent PRD.

## 4. Hypothesis

> **We believe** building the platform-law duties, the GDPR duties and card-only payment into the product before the pilot **will cause** ATD, VID and the lawyer **to** accept Sakta Cab as a lawful platform without rework, **resulting in** a pilot that launches on schedule and is not halted by a regulator.
>
> **We'll know we're RIGHT if**, before the pilot's first paid ride, all four hold:
> 1. ATD approves the registration on the first application, with no request to change the functionality description.
> 2. In a pilot rehearsal, every completed ride reaches VID's test environment, with none lost and none duplicated.
> 3. The lawyer signs off on the data handling and the ride flows.
> 4. An automated test shows that no code path, including admin actions, can delete or overwrite a protected record.
>
> **We'll know we're WRONG if** any of these happen: ATD asks for functional changes; the lawyer finds a breach of 35.², 40. (13) or GDPR in the shipped design; or the rehearsal loses or duplicates a VID submission. Also wrong if the epic pushes the pilot past Q4 2026 because its scope was larger than one person can build. That last one is the guardrail.

## 5. Target users and jobs to be done

| User | Job to be done |
|---|---|
| **Founders** (operator) | When we apply to ATD and face VID control, we want the platform to already do what the law lists, so we can launch and stay open. |
| **Carrier** (pārvadātājs: a licensed company or IK) | When I put my drivers and cars on Sakta Cab, I want to register them myself and see their trips, so I stay accountable for my own fleet without asking the platform. |
| **Driver** | When I finish a shift, I want to see my last 3 months of trips and know a refused ride carries my stated reason, so my record is fair and visible. |
| **Rider** (app and phone) | When I book, I want to pay by card, see who is driving me and get an invoice by email, and know what happens to my data. |
| **Dispatcher** (Dina) | When a phone caller books, I want the ride paid without cash and without the caller installing anything. |

**Non-users:** licensed taxis with meters (the taxi regime; out of scope unless Atis says otherwise); tax authorities as app users (VID receives data, it does not use the app); fleets outside Latvia.

## 6. MVP

The thinnest line that proves the hypothesis end to end is **one pilot rehearsal ride that would pass inspection**:

1. A carrier logs in and registers a driver and a car, with licence details.
2. The rider sees the carrier, driver, plate, tariffs and estimate. They choose card before requesting, by app or by phone through an SMS payment link.
3. A driver refuses an offer and gives a reason.
4. Another driver accepts the offer and completes the ride.
5. The rider is charged by card and receives an e-invoice by email.
6. The completed ride reaches VID's test environment.
7. Every step of the ride is kept: an attempt to delete or overwrite any part of it fails.
8. The driver sees the ride in their 3-month history, and the carrier sees it in theirs.

**Plus the documents** the lawyer and Atis produce outside the code: privacy notices for riders and drivers, the DPIA, processor agreements (DPAs), records of processing, and the procedure for handing VID the keys.

**Card-only switch:** cash goes from every surface. Phone riders pay by SMS payment link (decided by Linards, 2026-10-04).

**Door check:**
- **One-way doors** (spike or decide carefully):
  - The record model for protected data. Once real trips exist, it cannot be corrected.
  - The VID submission identity: what makes a resend count as a duplicate.
  - The legal entity, which is a business decision.
- **Two-way doors:** the carrier portal's screens, invoice layout and staff access-log views.

## 7. Success metrics

| Metric | Target | How measured |
|---|---|---|
| ATD registration | Approved on the first application | ATD decision letter |
| VID delivery in rehearsal | 100% of completed rides accepted, 0 duplicates | Count of submission records against completed rides, plus VID responses |
| Protected-record integrity | 0 code paths can delete or overwrite | Automated test in the gate, plus lawyer review |
| Lawyer sign-off | No open breach findings | Lawyer memo |
| Schedule guardrail | Epic done before the pilot date (Q4 2026) | Epic task list |
| Rider transparency | 100% of completed card rides get an e-invoice | Count of sent invoices against completed rides |

## 8. Non-goals

- Cash, in any form.
- The taxi regime (meters, taxi plates, taximeter cheques). Sakta Cab is vieglais-auto only.
- A full fleet-management product for carriers. Their view covers registering drivers and cars and seeing trips, nothing more.
- Automated deactivation of drivers. Under the Platform Work Directive, a human takes those decisions, and that is already the case today.
- The legal documents themselves (privacy policy text, DPAs, DPIA). The code only provides the hooks for them.
- Reporting to any authority other than VID and ATD.
- Registration with ATD and setting up the company. These are business tasks, tracked here only as dependencies.

## 9. Open questions

- [x] **Regime.** Vieglais automobilis (Linards, 2026-10-04).
- [ ] **Carrier licences.** Do the pilot drivers already work under ATD-licensed carriers with licence cards? (Atis)
- [ ] **Company.** IK or SIA, whose, and when? This gates ATD registration and live card payments. (Linards, Atis)
- [ ] **Phone bookings.** Lawful under 40. (13) 4) when a dispatcher enters the order? (lawyer)
- [ ] **Offered and refused trips.** Only completed trips are pushed to VID. Are the rest only kept and handed over on request? (lawyer; VID question Q3)
- [ ] **Rider erasure.** Do the protected records include the rider's identity and addresses, or only the MK 541 p. 11 fields? (lawyer; question D3)
- [ ] **Invoice issuer.** Platform or carrier? And does the carrier need a cash register for card payments taken in the app (MK 96)? (accountant)
- [ ] **Data protection officer.** Is one required? (lawyer)
- [ ] **Platform Work Directive.** Latvia's transposition is due December 2026. What does it add for drivers? (lawyer)
- [ ] **ATD decision time and the supervision fee's first year.** (ATD)
