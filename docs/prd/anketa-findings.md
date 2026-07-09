# Sakta Cab — Anketa Findings (first pass)

**Status: EVIDENCE APPENDIX to `00-lean-prd.md`.** English translation + synthesis of the questionnaire answers. The PRD cites this; the spec consumes the feature signals. Updated as precizējumi (clarification round) answers arrive.
**Date:** 2026-07-09 · **Source:** Google Sheet "Sakta Cab — atbildes" (answers of 2026-07-06/07) · **Questions:** `JAUTAJUMI.md` (LV originals)
**Respondents:** Atis (driver, sections 1–6), Dina (dispatcher, 7–9), both (10–11).

**Completion: 76/76 questions have answers.** Quality is uneven: ~15 answers are "don't remember / don't know", 2 are already flagged *precizēt* by Linards, and **zero screenshots have been uploaded** — the evidence dossier is still empty. See [Gaps & follow-ups](#gaps--follow-ups-the-precizējumi-round).

---

## TL;DR — what the answers decide

1. **The commission number is in: ~15%.** Fair commission per both = **14%** (S10-1). Atis wouldn't even consider leaving Bolt below **16%** (S2-9c). He prefers a **flat 15% with no bonus games** over 25%-with-bonuses (S2-9a). Bolt's base is **25%** (+ surge margin), Panda is **19%** (S6-1). → A flat low commission, no penalty fees, is the wedge. **Decided (Linards, 2026-07-09): launch at 10% flat** — under the evidenced band, config-not-constant, revisit against pilot economics.
2. **Accessibility differentiator independently validated.** Asked what demand *no* service covers, Atis answered unprompted: **blind clients** (S5-8). The screen-reader-first rider app is not a nice-to-have — it's an unserved market segment named by a working driver.
3. **Dina is a much bigger asset than planned.** Her "what didn't you ask" answer (S11-1): she was **head of planning & scheduling at Lady Taxi** and worked directly with taxi drivers. The dispatcher isn't learning taxi dispatch — she's done it professionally. (Atis also drove for Lady Taxi 9 years — longest of all his platforms.)
4. **Dispatch model confirmed: hybrid.** Algorithm auto-assigns; the dispatcher can **override / force-assign**, especially when an order sits unclaimed (S9-2, S9-4). Queue fairness **by district** and the ability for a customer to **phone a real human** are the two things Dina would carry over from the autoosta (S7-2). Phone customers: elderly, hotels, bars, restaurants (S9-3).
5. **Commitment: 10/10** (S11-4). Atis would drive the pilot at 0% commission + hourly guarantee (S6-7); his guarantee thresholds: **€15/h** (S2-9d) or **€500/week** fixed (S2-10). He would sign a Konkurences padome submission **with his name** (S10-8). Cooperative co-ownership: only "maybe" (S6-8) — keep it a parallel track, not the pitch (it also ranked last, 8/8, in his switch-drivers ranking S6-4).
6. **What actually pulls drivers** (S6-4 ranking): 1. lower commission · 2. instant payout · 3. better app · 4. guaranteed minimum · 5. human support in Latvian · 6. local company · 7. no penalty system · 8. co-op share. What pulls riders (S10-3): 1. cheaper · 2. **can both call and use the app** · 3. local Latvian company · 4. money stays in Latvia · 5. safer · 6. happier drivers.
7. **The evidence base for the anti-Bolt dossier is still thin.** The single most important artifact (Bolt weekly earnings screenshot, S2-1) is missing — Atis answered "don't remember" to the week-in-numbers questions. The strongest number captured: a ride where **the passenger paid €200 and Atis received €130** (35% gap, S2-4). The follow-up round must chase screenshots.

## The numbers that matter

| Metric | Value | Source |
|---|---|---|
| Bolt base commission (per Atis) | 25% (+ surge margin on top) | S6-1 |
| Panda commission | 19% | S6-1 |
| Biggest observed pay gap on one ride | passenger €200 → driver €130 (35%) | S2-4 |
| "Fair" commission | **14%** | S10-1 |
| Commission at which leaving Bolt isn't even worth considering | 16% | S2-9c |
| Preferred model | flat 15%, no bonuses (vs 25% + bonuses) | S2-9a |
| Guaranteed hourly rate threshold | €15/h | S2-9d |
| Fixed weekly "salary" to sign tomorrow | €500/week | S2-10 |
| Atis hours at the wheel / with passenger | 60 h / 45 h per week (75% utilization) | S1-5 |
| Empty-kilometre share | ~8% (rises with distance from Rīga) | S5-3 |
| Monthly costs listed | fuel €500 · insurance €30 · service/tyres €20 · wash €15 · phone €20 · other €50 (≈€635) **+ car rent €500 (S1-3, missing from the table — flag)** | S3-1 |
| Best / worst week last year | €500 / €400 (*flagged precizēt — units & story unclear*) | S2-2 |
| Demand peaks (driver) | weekdays 07:00–09:30, 16:30–19:00 | S5-5 |
| Demand peaks (autoosta) | weekdays 07:30–09:30, 16:00–19:00; Fri+Sat 19:00–04:00 | S7-3 |
| Readiness to commit (0–10) | **10** | S11-4 |

## Feature signals (→ spec backlog)

**Validated / confirmed by answers:**
- **Geozone / district queue fairness** — Dina's #1 carry-over from autoosta practice (S7-2, S8-1). Already a PRD hypothesis pillar.
- **Human phone dispatch as a first-class booking channel** — Dina's #2 carry-over (S7-2); riders rank "can call AND app" #2 (S10-3); phone segment = elderly, hotels, bars, restaurants (S9-3). Panda's phone dispatch is its *plus*, but their dispatchers "don't know Rīga/Latvia" (S6-1) — Dina does.
- **Hybrid dispatch: auto-assign + dispatcher override** — human forces assignment when an order goes unclaimed (S9-2, S9-4). Maps directly to the dispatch engine + Dina's console.
- **Screen-reader-first rider app** — blind riders named as unserved demand (S5-8).
- **Price transparency to the driver** — Atis cannot see what the passenger pays on Bolt (S2-5); the €200/€130 gap (S2-4) is the poster child. Show the driver the full fare split.
- **No penalty system; human, online, Latvian-language support** — Bolt support didn't resolve his last issue (S4-1); a recruiting ad "must promise" lower % and 100% online human communication (S4-6); penalties experienced over "mixed-up addresses" (S2-7).
- **Dispatcher console: reliability first** — Dina's top pain at autoosta is "the system often freezes" (S7-4). Boring reliability beats features.
- **Driver-recognition pricing idea** — as Bolt's boss-for-a-day, Atis would "understand the driver's value and lower their %" (S4-5). Tenure/quality-based commission discount — worth a founder discussion, config-not-constant.

**Pilot geography & timing (dispatch/config inputs):** RIX airport at flight-arrival times, Old Town evenings, nightclubs/bars at night, big events (S5-2); autoosta with bus-arrival waves — arrival data exists, and the partnership door is the **autoosta marketing manager** (S8-4, S8-5). Peaks as tabled above. Sample day: centre→RIX €13, RIX→Teika €22, Teika→Ķengarags €21 (S5-1).

**Later (post-v1, keep as config/notes):** negotiated driver perks ranked: 1. fuel discount · 2. cheaper car rental · 3. cheaper insurance · 4. tyre service (S3-6) — fuel is his largest cost line. Driver's own #1 wish: a newer car (S1-7, S3-5: the % rate is the cost that angers him most).

**Rider-pitch order for marketing copy** (S10-3): cheaper → call-or-app → local → money stays in LV → safer → happier drivers.

## Contradictions & credibility flags

1. **Instant payout: 1/10 vs rank #2.** S2-8 scores instant payout importance **1/10**, but S6-4 ranks "instant payout" **#2** of 8 switch reasons. Likely reading: Bolt's current payout speed is acceptable (no delays experienced), but as a switch pitch it still ranks high. Needs one clarifying question before we build payout rails around it.
2. **"80% stays in my pocket" (S3-4)** is arithmetically impossible next to a 25–30% commission plus ~€1,135/mo costs. He probably answered "% of net after commission" or slid the slider casually. Clarify before using any take-home number publicly.
3. **Cost table omits car rent** (S3-1 rent row empty) while S1-3 says the rented car costs €500/mo. The real monthly cost base is ≈€1,135, not €635.
4. **Weekly numbers don't cohere yet**: best week €500 / worst €400 (S2-2) vs "€500/week salary to sign tomorrow" (S2-10) vs 60 h/week. If €500 is a *gross* good week at 60h, effective hourly is grim — which strengthens the case, but only with verified numbers. Both S2-1 and S2-2 are in the precizēt queue.
5. **Ratings "are OK" (S4-3) and no dangerous situations (S5-7)** — mildly at odds with the oppression narrative; the dossier should lean on commission/penalty/support evidence, not ratings or safety.

## Gaps & follow-ups (the precizējumi round)

**Status: SENT 2026-07-09** — all items below marked ❓ *precizēt* with comments via the admin API and delivered in one 📣 digest email (plus the 2 earlier flags S1-3/S2-2; 13 total). Everything else was approved ✓ as-is per Linards. The list, for the record:

| # | qid | Ask |
|---|---|---|
| 1 | S2-1 | **The Bolt weekly report screenshot** — the most important artifact in the whole anketa. Gross, Bolt's cut, net for a typical week. |
| 2 | S2-2 | *(already flagged)* Which weeks were best/worst and what made them so; are €500/€400 gross or net? |
| 3 | S1-3 | *(already flagged)* Full car list, no abbreviations; confirm €500/mo rent. |
| 4 | S1-4 | Legal status "Other" — what exactly? How are taxes actually paid? (Blocks payout-rails and onboarding design.) |
| 5 | S2-8 vs S6-4 | Instant payout: 1/10 importance but ranked #2 — which is it? Does Bolt pay out fast enough today? |
| 6 | S3-4 | "80% stays" — after commission only, or after all costs? Walk through one real month. |
| 7 | S3-1 | Add car rent to the cost table; confirm fuel really is €500/mo. |
| 8 | S6-7 | He'd drive for 0% + hourly guarantee — **how big must the guarantee be?** (Number missing; €15/h from S2-9d is the hint.) |
| 9 | S9-1 | Dina's dispatcher-console drawing — "I'll do it a bit later." Chase it; it designs her own screen. |
| 10 | S4-8, S11-3 | Evidence boxes are empty — zero screenshots uploaded anywhere. Ask for penalty notices, support chats, ride detail screens. |
| 11 | S6-6 | "How many drivers would switch now?" = don't know → ask him to actually count/ask his circle (feeds the ≥20-driver RIGHT condition and the LOI test). |
| 12 | S9-3 | Dina's answer cuts off mid-sentence ("Es piļajubdomu ka ja…") — what was the rest of the thought? |

## Full translated answers

Statuses: ✓ = approved by Linards · ❓ = flagged *precizēt* · (blank) = not yet reviewed. All translations from Latvian; `[…]` = editorial note.

### Section 1 — Profile & experience (Atis)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S1-1 | Years as taxi driver, cities | 25 years — Rīga, Latvia, Europe |
| S1-2 ✓ | Platforms worked | Alviksa 2 y · Bolt 3 y · Panda 4 y · Yandex 1 y · **Lady Taxi 9 y** · private 7 y *(why-started/left columns empty)* |
| S1-3 ❓ | Car & monthly cost | Rented: Toyota Corolla (diesel), Ford Focus (diesel), VW Transporter (diesel), Audi A6 C6 (diesel), etc. — **€500/mo** |
| S1-4 | Legal status, taxes | "Other" *[no detail — gap]* |
| S1-5 ✓ | Hours/week at wheel / with passenger | 60 h / 45 h |
| S1-6 ✓ | Day you became a taxi driver / first regret | A friend recommended it. [Regret:] a conflict with a client. |
| S1-7 ✓ | One thing you'd change tomorrow | Swap the old car for a newer one |

### Section 2 — Money reality (Atis)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S2-1 | Typical week: gross / Bolt cut / net | Don't remember *[KEY GAP — needs the Bolt weekly screenshot]* |
| S2-2 ❓ | Best & worst week last year | €500 / €400 *[units & story unclear]* |
| S2-3 | Anatomy of Bolt's deductions | Don't remember |
| S2-4 | Ride with the biggest passenger-paid vs driver-received gap | Passenger paid **€200**, received **€130** |
| S2-5 | Can you see what the passenger pays? | **No** |
| S2-6 | Bonuses/quests — real and worth it? | Don't know |
| S2-7 | Penalties/withholdings | Over "mixed-up addresses" |
| S2-8 | Payout speed; instant payout importance 0–10 | **1/10** *[see contradiction #1]* |
| S2-9 | Choice game | a) **15% no bonuses** over 25% with bonuses · c) at **16%** wouldn't even consider leaving Bolt · d) **guaranteed hourly rate**, threshold **€15/h** *(b unanswered)* |
| S2-10 | Fixed weekly salary to sign tomorrow | **€500/week** |

### Section 3 — Costs (Atis)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S3-1 | Monthly cost table | Fuel €500 · rent *[empty — flag]* · OCTA/KASKO €30 · service+tyres €20 · wash €15 · phone €20 · licences — · taxes — · other €50 |
| S3-2 | Taxi licensing in Rīga | Don't remember |
| S3-3 | How drivers really handle taxes | "Probably fine" |
| S3-4 | % of gross that really stays with you | 80% *[implausible — see contradiction #2]* |
| S3-5 | Most annoying (unfair) cost | The platform % rate |
| S3-6 | Rank negotiated perks | 1. fuel discount · 2. cheaper car rental · 3. cheaper insurance · 4. tyre service |

### Section 4 — Relationship with Bolt (Atis)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S4-1 | Last support contact | They didn't resolve it |
| S4-2 | Blocking/deactivation episodes | Don't remember, "but it dragged on long" |
| S4-3 | Ratings & reviews impact | "It's OK" |
| S4-4 | Rule/commission changes without warning | Don't remember |
| S4-5 | Role-swap: you run Bolt LV for a day | "Understand how valuable each driver is, lower their % rate" |
| S4-6 | Recruiting ad — what it MUST promise | Lower % rate + 100% online communication with a platform representative |
| S4-7 | What would Bolt do to keep you? | "Nothing" [would stop me] |
| S4-8 | Evidence box | Don't remember *[empty — no uploads]* |

### Section 5 — The working day (Atis)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S5-1 | Day reconstruction | 10:00 Rīga centre → RIX, €13 · 10:45 RIX → Teika, €22 · 11:40 Teika → Ķengarags, €21 — all "all cool" |
| S5-2 | Golden map — where's the money | Airport at specific times · Old Town evenings · nightclubs & bars at night · big events |
| S5-3 | Empty kilometres | ~8%; "the farther from Rīga, the bigger the empty runs" |
| S5-4 | Airport/autoosta queues | "All sorts" *[weak]* |
| S5-5 | Best earning hours | Weekdays 07:00–09:30 and 16:30–19:00 |
| S5-6 | Who rides with whom | "All sorts, but mostly Bolt" |
| S5-7 | Most dangerous situation | "Nothing" |
| S5-8 | Demand nobody serves | **Blind clients** |

### Section 6 — Competitors & switching (Atis)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S6-1 | Who operates in Rīga, drivers' word | **Bolt**: 25% commission; + fast pickup; − high commission, expensive surge. **Panda**: 19%; + can phone a dispatcher; − dispatchers mostly don't know Rīga/Latvia |
| S6-2 | Driving two platforms in parallel | Panda + Bolt; "different platforms, but you get used to it" |
| S6-3 | Why has nobody displaced Bolt? | Habit + fast pickup |
| S6-4 | Rank what would pull you to a new service | 1. lower commission · 2. instant payout · 3. better app · 4. guaranteed minimum · 5. human support in Latvian · 6. local company · 7. no penalty system · 8. co-op ownership share |
| S6-5 | What makes you bring 10 colleagues | "An impressive % rate reduction, e.g. for a month" |
| S6-6 | Drivers you know ready to switch | Don't know *[→ follow-up #11]* |
| S6-7 | 0% commission + hourly guarantee for 3 months? | **"Yes, I'd drive"** *(guarantee amount not given)* |
| S6-8 | Invest €500–2000 in a co-op? | "Maybe" |

### Section 7 — Work at the autoosta (Dina)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S7-1 | What the job actually is | Take calls/bookings · control dispatch execution · collect complaints & suggestions |
| S7-2 | Systems you use; what to carry to a taxi console | Would take: **queue order by district for drivers** · **customers can phone a real human (dispatcher)** |
| S7-3 | Volumes & peaks | Can't answer volumes yet; peaks: weekdays 07:30–09:30 & 16:00–19:00, Fri 19:00–04:00, Sat 19:00–04:00 |
| S7-4 | What regularly breaks | **"The system often freezes/hangs"** |
| S7-5 | How you talk to drivers | Phone |
| S7-6 | Handling delays | Call the customer, warn about the delay, explain the problem |
| S7-7 | Full power for a month | Fix the queue order, the visual presentation, and drivers' knowledge for serving customers |

### Section 8 — Taxi flow around the autoosta (Dina)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S8-1 | How taxis get passengers there | Queue order |
| S8-2 | Official agreements with taxi firms | As far as she knows, none currently |
| S8-3 | Passenger complaints about taxis | Price, language, safety |
| S8-4 | Route to official cooperation | **The autoosta marketing manager** decides |
| S8-5 | Bus arrival data as demand waves | Data exists; would also want taxi-demand statistics |

### Section 9 — Dina's dispatcher console

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S9-1 | Design your ideal screen | "I'll do it a bit later" *[PENDING — chase the drawing]* |
| S9-2 | Human role when the app automates | Control; sometimes **manually force-assign** an order |
| S9-3 | Who still wants to phone | Older people, hotels, bars, restaurants *[sentence cuts off — follow-up #12]* |
| S9-4 | Algorithm vs dispatcher power | **Dispatcher can override** — at the moment an order sits unclaimed too long |
| S9-5 | Practical start as our dispatcher | Initially **parallel to the autoosta job**; needs from day 1: schedule, equipment, training |

### Section 10 — Vision & terms (both)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S10-1 | Fair commission % | **14%** — "lower than Bolt" |
| S10-2 | Rides too cheap or too expensive? | Don't know |
| S10-3 | Rank why a rider picks the new service | 1. cheaper · 2. can both call and use app · 3. local Latvian company · 4. money stays in Latvia · 5. safer · 6. happier drivers = better service |
| S10-4 | Name & look | **"The name already exists: Sakta Cab."** Logo unknown; small ~10×10 cm logo on the cars |
| S10-5 | Top-3 reasons this fails | Not solving problems immediately · strong competition · too little advertising · too few taxis and customers |
| S10-6 | 3 years on, ordinary Tuesday | "Everyday routine" *[weak]* |
| S10-7 | Possible allies in Latvia | Don't know |
| S10-8 | Sign a Konkurences padome submission? | **"Yes, with name"** |

### Section 11 — Free microphone (both)

| qid | Question (short) | Answer (EN) |
|---|---|---|
| S11-1 | What Linards should have asked | Both have deep taxi-industry experience; **Dina was head of the planning & scheduling department at Lady Taxi**, incl. working with taxi drivers |
| S11-2 | One story that captures the work | "Communication with people" |
| S11-3 | Big evidence box | Don't know *[empty — no uploads]* |
| S11-4 | Readiness to commit 0–10 | **10** |

---

## Where this flows

- **`00-lean-prd.md`** — problem-statement evidence, commission band, open-questions status, Dina's credentials, evidence-gap risk. (Updated 2026-07-09 from this doc.)
- **Spec (next, gated on PRD review with Atis)** — feature signals above become slices: hybrid dispatch + override, district queues, phone-booking channel, fare-transparency, accessibility-first rider flows, dispatcher console reliability.
- **Precizējumi round** — sent 2026-07-09 (13 ❓ + digest); answers land back in the Sheet with status ↻ Atjaunots.
- **Anti-Bolt dossier** — still requires screenshots; S2-4 (€200→€130) is the anchor once documented.
