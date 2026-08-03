# Post-MVP Depth — the parked backlog for the next epic

**Status:** parked, deliberately unplanned. Written 2026-08-03, companion to epic [#1](https://github.com/linardsb/taxi/issues/1) (tickets #2–#27). Nothing here is scheduled; this file exists so nothing is lost. The PRD (`docs/epics/sakta-cab.prd.md` §8/§9) stays the source of truth for *decisions*; this is the working list for the next epic's slicing.

**Promotion paths** (when an item earns it):
- Single small feature → `/piv-plan-implementation "<one-sentence description>"` directly; add an issue to epic #1 only if it belongs to the pilot re-cut.
- Cluster / new phase → small epic PRD → `plan-architecture` (only if real decisions are open) → `/piv-slice-epic`.
- Scheduled re-cut moments: demo feedback (#24) and the post-pilot review (`docs/build-playbook.md` Step 11) — both end in a backlog re-cut against this file.

---

## Next-epic candidates

Everything below rides on a seam or schema the MVP epic already builds — adding one later is a normal PIV ticket, not an architecture project. "Still to plan" = the decisions a future planning session must make.

### Pricing depth

| Item | Source | Lands on | Still to plan |
|---|---|---|---|
| Taximeter pricing | Skeleton decision: all three pricing models | `PricingStrategy` seam (#9) | Tariff structure; whether ATD rules ever *require* it |
| Rider-offers-price (bidding) | Skeleton decision | `PricingStrategy` seam (#9) | Offer/counter UX, floor rules |
| Vehicle classes: fastest / limo / VIP | Atis outline (categories list) | Vehicle attributes (#8) + pricing config | Class definitions, per-class pricing; needs fleet diversity to matter |

### Money depth

| Item | Source | Lands on | Still to plan |
|---|---|---|---|
| Prepaid EUR balance ("always visible") | Atis outline; skeleton kickoff (all four payment methods) | Ledger (#12) + `PaymentsProvider` | Top-up flow, refund policy |
| Corporate invoicing | Skeleton kickoff; ties to hotels/bars phone segment (S9-3) | Ledger (#12) | Account model, billing cycle; likely pulled early if hotel partnerships land |
| Automated driver payout execution | Spike #5 decides the rail; #12 may ship it as a stub | #12's payout interface | Cadence, minimums; blocked on SIA + Atis's tax status |

### Support & safety

| Item | Source | Lands on | Still to plan |
|---|---|---|---|
| AI complaints agent | Skeleton kickoff ("stub in MVP") | `ComplaintTriage` seam (#20) | Model/provider, escalation rules; trigger = support volume |
| **Safety escalation via dispatcher (SOS)** | Atis outline differentiator ("Kas nav konkurentiem"); never sliced into the MVP | Dispatch console + both apps | Whole product definition: rider/driver SOS button, dispatcher protocol, 112 handoff. **Strongest candidate for the next epic** — it's on the original differentiator list |
| Driver pre-shift car photo check | Atis outline ("photograph the car before going online") | Driver app availability slice (#14) | Review flow (auto vs Dina), storage cost |

### Rider experience depth

| Item | Source | Lands on | Still to plan |
|---|---|---|---|
| Multi-stop booking UI | Atis outline; schema fields ship in #9 | Rider booking (#16) | UI only — schema is ready |
| Rider push notifications for ride events | Gap noted at slicing (driver-side push ships in #15) | Rider app (#17) + notifications | Small; fold into a rider polish ticket |
| Rider↔driver contact channel (masked call / chat) | Unscoped in MVP — the dispatcher relays (phone-first) | Telephony seam (#19) or new chat slice | Channel choice first; chat auto-translation (PRD non-goal v1) rides on this later |
| Voice-guided booking flow | Skeleton kickoff ("later"); S5-8 blind riders | On top of #16/#17 screen-reader baseline | Flow design with actual blind users post-pilot |
| Family profiles | Skeleton Phase 4 | Rider app + user schema | Account linking model |

### Driver & ops depth

| Item | Source | Lands on | Still to plan |
|---|---|---|---|
| Driver language badges | Skeleton Phase 4 | Driver attributes (#8) + rider display | Trivial slice; bundle with a driver polish ticket |
| Deeper stats / analytics dashboards | Skeleton Phase 4; #20 ships only the RIGHT/WRONG counters | Admin (#20) | What Dina/Linards actually need after 4 weeks of pilot data |
| Full call-center integration | Skeleton kickoff ("eventually") | `TelephonyProvider` seam (#19) | Provider choice; trigger = phone-channel share metric (#20) proving the channel |

---

## PRD §8 non-goals — NOT next-epic candidates

Return only via a deliberate PRD change, not via this backlog: full pooling engine (v1 knock-down #23 stays), own-fleet operations (`fleet_id` extension point exists in #6), driver co-op legal structure (parallel track, ranked 8/8 as a switch reason), Konkurences padome / advocacy track, other cities (data model is multi-city-ready), food/parcel/scooters.

## Business open questions (not features)

Live in PRD §9, owned by the business track — not duplicated here: unit economics at 15%, rider acquisition plan, cash-settlement thresholds, Atis's tax status, ATD obligations, equity split, first pilot geozones (with Dina).
