# Dispatch Console & Small-Fleet Ops UX — Evidence Report (2022–2026)

**Provenance:** web research agent, 2026-08-07 (session: UI-surface re-slice). Every finding names who shipped it, with sources; fit judged against: one dispatcher (Dina), 10 drivers, solo builder, <€100/mo, reliability as ask #1.
**Feeds:** tickets #18/#19 (dispatch console), #20 (admin), `docs/ux-metrics-ledger.md`.

---

## 1. Modern taxi dispatch console UX

### F1.1 — Autocab 365 B&D dispatch screen: the reference anatomy for a zone-queue console
- **WHAT**: Autocab (UK market leader, owned by Uber since 2021) documents its shipped dispatch screen layout in operator help articles: (1) vehicle-summary strip top-left with counts per status — clear / busy / on job / soon clear / unavailable — plus a "bookings with warnings" icon; (2) vehicle queue panel showing callsign, current zone, and **time since last job completion**; (3) a central **zones grid** showing each zone's shortcode with vehicle numbers and their queue positions ("vehicles that are first in the queue order receive booking priority"); (4) driver-messages panel; (5) active-bookings list at bottom with customizable columns. `Z`/`M` toggles zones-grid vs map view. `W` opens a dedicated Warnings screen for problem jobs.
- **WHO**: Autocab official support docs — https://support.autocab.com/hc/en-gb/articles/4418515554193-Using-the-Dispatch-Screen-365-B-D
- **EVIDENCE**: Strong — official operator documentation of shipped software used by thousands of UK fleets.
- **APPLICABILITY**: Direct blueprint. Note the zones **grid** (not map) is the primary view — dispatchers of zone-based fleets work off a textual queue table; the map is a secondary toggle. For 10 drivers over ~6 Rīga districts this scales down beautifully: one small grid, one bookings list, one warnings surface.

### F1.2 — TaxiCaller: closest comparable product; operators praise one-screen density, complain about refresh reliability
- **WHAT**: TaxiCaller is the canonical small-fleet cloud dispatch product ($20/vehicle/month pay-as-you-go, browser console). Capterra operator reviews (named dispatchers/managers): praise = "all in one package with a lot of features on one screen", "quick and responsive", "GPS replay has been great", browser-based enables remote work. The recurring complaint: "Sometimes it have some bugs and glitches and **do not refresh automatically**."
- **WHO**: Capterra reviews — https://www.capterra.com/p/190946/TaxiCaller/reviews/ ; pricing — https://www.taxicaller.com/en/pricing
- **EVIDENCE**: Strong — verified operator reviews, named roles (one reviewer is literally a dispatcher).
- **APPLICABILITY**: High. This is the product Sakta's console competes with in spirit. The #1 complaint of its actual users is *stale data in a browser console* — exactly Dina's frozen-console trauma. Also a budget datapoint: off-the-shelf for 10 cars ≈ $200/mo, i.e., building it in-house is what makes the <€100/mo budget possible.

### F1.3 — iCabbi and Cordic: what the high end sells (and what to skip)
- **WHAT**: iCabbi markets "over 1,000 real-time configuration options", zone profiles scheduled by day/time, "Overbooking Protection" that auto-holds bookings and **alerts the dispatch team** when driver supply drops, and a 99.999% uptime claim. Cordic sells "smart dispatch using closest car, longest waiting driver and auto bidding" plus **MILES**, an AI assist that "spots trouble before it starts and recommends the best action" to controllers. Cordic operators on review sites: "amazing dispatch system... ease of use for operators", "you get what you pay for" (cost noted). Autocab G2 reviewer: system "bit slow and hangs sometimes"; Trustpilot reviewers complain of late pre-booked pickups and slow support.
- **WHO**: https://icabbi.com/platform/dispatch/ ; https://www.cordic.com/dispatch ; https://www.g2.com/products/autocab-dispatch-system/reviews ; https://www.trustpilot.com/review/autocab.com ; https://www.capterra.com/p/74152/cPAQ/
- **EVIDENCE**: Medium — vendor claims plus scattered verified reviews.
- **APPLICABILITY**: The transferable ideas are (a) supply-shortage alerting and (b) exception-spotting assist. The 1,000-option config surface, scheduled zone profiles, and partner-fleet redirection are **enterprise bloat to avoid** at 10 drivers. Note even big vendors' consoles "hang sometimes" per their own users — reliability is a real differentiator, not table stakes.

### F1.4 — Baltic context: Bolt is the incumbent toolchain; Yandex proves auto-first economics
- **WHAT**: No serious local Latvian dispatch software surfaced (ClickTaxi is a nearest-car ordering app — https://www.clicktaxi.lv/). Rīga fleets that drive for Bolt use the **Bolt Fleet Portal**: real-time map (green dot = online/free, purple = on trip), trips tab with per-driver history and CSV export, weekly/daily payout reports, driver+vehicle management, mobile-optimized. Yandex published that with classic (human) dispatch drivers spend 10–15% of time carrying passengers vs 60%+ under algorithmic dispatch.
- **WHO**: https://bolt.eu/en/support/articles/360012344613/ ; https://bolt.eu/en-pt/fleet/guide/fleet-management/ ; https://medium.com/@underthehood21/under-the-hood-of-yandex-taxi-2a57701b1e43
- **EVIDENCE**: Strong for Bolt (official docs of shipped portal); medium for the Yandex stat (company blog).
- **APPLICABILITY**: High. The Bolt Fleet Portal defines the *minimum familiar* for Latvian drivers/owners (map with two-color dots, trips CSV, weekly payouts). The Yandex stat justifies auto-assign-first with Dina as exception handler, not primary allocator.

---

## 2. Phone-order entry speed

### F2.1 — Caller-ID screen pop: measurably 15–45 seconds saved per call
- **WHAT**: CTI screen pop (caller number matched against customer DB, record pops on answer) is the one phone feature with measured time savings: industry figures of 15–30s and 15–45s saved per call from auto-loaded context; one mid-sized org reported average handle time down 18% in the first quarter after CTI rollout.
- **WHO**: https://aloware.com/blog/what-is-call-pop ; https://www.phoneiq.co/blog/using-cti-to-boost-call-center-agent-performance ; https://www.novelvox.com/blog/cti-screen-pop-for-improved-agent-caller-interaction/
- **EVIDENCE**: Medium-strong — consistent numbers across independent CTI vendors; call-center domain, transfers directly to phone bookings.
- **APPLICABILITY**: Very high. On a 2-minute booking call, 15–45s is a 15–35% cut. For elderly repeat callers the pop is also a service-quality feature ("your usual address on Brīvības iela?").

### F2.2 — TaxiCaller PhoneLink: caller-ID autofill shipped in a small-fleet product
- **WHAT**: TaxiCaller's Caller ID uses **PhoneLink**, a gateway holding a WebSocket connection between the operator's SIP/VoIP provider and the dispatch console; on an incoming call the **new-job form autopopulates with the caller's details and previous job**. A "Clean jobs" toggle controls prefill depth: enabled = only pickup, drop-off, passenger, phone; disabled = everything including passenger count, vehicle type, tags. Setup works with any SIP-standard VoIP (documented with VoIPstudio).
- **WHO**: https://www.taxicaller.com/en/help/kb/349751 ; https://voipstudio.com/docs/administrator/integrations/taxicaller/
- **EVIDENCE**: Strong — shipped feature with public KB and third-party integration docs.
- **APPLICABILITY**: Very high and cheap to replicate: one SIP/webhook listener + phone-number lookup + last-3-jobs prefill. The "Clean jobs" nuance is a real UX lesson: prefill the stable fields, not the per-trip ones.

### F2.3 — iCabbi: repeat-caller "call pops of previous bookings"; >50% of calls automatable by IVR
- **WHAT**: iCabbi's phone stack creates "call pops of previous bookings for repeat selection"; its IVR uses caller ID to suggest the caller's most popular pickup places so regulars rebook by keypad without an operator; iCabbi claims "over 50% of your phone calls can be dealt with via IVR."
- **WHO**: https://icabbi.etgl.co.uk/discover-icabbi/voice-and-phone-solution/ ; https://icabbi.com/platform/bookvoice/
- **EVIDENCE**: Medium — vendor claims, but the feature set is shipped and widely used in UK fleets.
- **APPLICABILITY**: The *pattern* (caller → their historical pickup addresses, ranked by frequency) is the takeaway. Full IVR/AI-voice (iCabbi BookVoice, Cordic IVR, AI receptionists are the 2024–2026 trend) is **bloat for one dispatcher** — Dina answering is the product's warmth; don't automate her away in the pilot.

### F2.4 — Autocab 365: keyboard-first booking entry, shipped and documented
- **WHAT**: Autocab's operator workflow is keyboard-first: `Space` opens the booking form from the dispatch screen; arrow keys navigate fields; address entry against a streets database is "house number, space, first few letters of the street, then the search type"; `Delete` + arrows sets pickup time elements; `F11` shows shortcuts; a printable Shortcuts Cheat Sheet exists for operator training; a Call History screen stores/plays operator calls; IVR "Caller ID Booking Fields" configure what prefills.
- **WHO**: https://support.autocab.com/hc/en-gb/articles/4973551912221-Shortcuts-Cheat-Sheet-365-B-D ; https://support.autocab.com/hc/en-gb/articles/4418517193105-Using-the-Booking-Form-365-B-D ; https://support.autocab.com/hc/en-gb/articles/4405685299101-Configuring-the-Interactive-Voice-Response-IVR-System-365-Management
- **EVIDENCE**: Strong — official docs of the workflow professional taxi operators are actually trained on.
- **APPLICABILITY**: Very high. A 25-year dispatcher's hands live on the keyboard. Design the booking form for zero-mouse completion: one hotkey to open, tab/arrow field order matching how callers speak (phone → pickup → destination → time → notes), typeahead address search tuned for "iela + number" Latvian addresses. Hotel/bar quick-book = a saved account whose caller-ID pop pre-selects the venue as pickup — same mechanism as F2.2, no separate feature needed.

---

## 3. Hybrid auto + manual assignment

### F3.1 — TaxiCaller's cascade → exception bucket → hard-assign loop
- **WHAT**: TaxiCaller's shipped auto-dispatch: configurable number of assignment attempts; per-driver **accept timeout** ("set the amount of time a driver has to accept before the system moves on to the next driver"); on rejection it moves to the next driver; optional "Reset rejects" re-includes previous decliners; if every attempt fails, options include Broadcast to more drivers, and finally **"the job lands into Unassigned in the Dispatch Console, [where] you will be able to hard-assign the job directly to a driver."**
- **WHO**: https://www.taxicaller.com/manuals/admin-panel/2/en/topic/assignment-settings ; https://www.taxicaller.com/en/blog/63bd21725c8c77522649f2e5/the-ins-and-outs-of-taxicaller-auto-dispatch-settings ; https://www.taxicaller.com/manuals/admin-panel/2/en/topic/advanced-auto-dispatch
- **EVIDENCE**: Strong — shipped product manuals.
- **APPLICABILITY**: This is exactly Sakta's model, proven at small-fleet scale: cascade runs; only exhausted jobs demand Dina; the Unassigned bucket is the exception surface she watches.

### F3.2 — Offer vs Force Assign as two distinct dispatcher verbs
- **WHAT**: Onro's dispatcher docs distinguish: **Manual Offer** (order stays Pending, appears in driver's "For You" tab, driver may accept/reject within a configurable offering time) vs **Force Assignment** (status flips to Assigned, lands in driver's "Assigned" tab, "eliminating the acceptance decision"). Onde ships the same pair: Manual (search driver by name/board#/phone, offer) and "Force Assign... assigns the order directly to the driver."
- **WHO**: https://help.onro.io/en/articles/10259691-how-to-assign-offer-an-order-to-a-driver ; https://support.onde.app/en/articles/1047504-how-to-assign-driver-manually
- **EVIDENCE**: Strong — two independent shipped products with the same two-verb model.
- **APPLICABILITY**: High. Sakta's state machine should encode both verbs: *offer* (respects driver agency, normal case) and *force* (bus-station-queue reality, driver notified, no accept step). Both products treat force-assign as a status write, which maps cleanly onto `assertTransition()`.

### F3.3 — Explainability: dispatchers override confidently only when they see the logic; drivers want post-hoc explanations
- **WHAT**: PCS Software (trucking dispatch AI): "When dispatchers can review the logic behind a decision — the margin calculation, the driver match — they can agree with it, adjust it, or override it with confidence"; AI that "shows its work" lets dispatchers focus on exceptions. Academic side: a 2024 study translating gig-driver insights to policy found drivers want explanations of task-allocation decisions, provided post-hoc, so they can reflect on work strategy. Sherlock Taxi's shipped allocator is multi-factor ("best driver": closest car + driver empty time + more) with offers/bids as explicit fallbacks — i.e., even 100%-automated systems expose *which* mechanism allocated a job.
- **WHO**: https://pcssoft.com/blog/dispatcher-ai-dispatch-tools/ ; https://arxiv.org/pdf/2406.10768 (Rideshare Transparency: Translating Gig Worker Insights on AI Platform Design to Policy) ; https://www.sherlocktaxi.com/product/operations/
- **EVIDENCE**: Medium-strong — one peer-reviewed-track paper, one practitioner essay, one shipped multi-mechanism allocator.
- **APPLICABILITY**: Very high for a district-fairness fleet. The cascade panel should answer "why is driver X first?" in one line: "Āgenskalns queue #1 · in zone 47 min · 4 min away". Same string doubles as the driver-facing fairness explanation, which the arxiv study says drivers explicitly want.

---

## 4. Control-room cognitive-load research (CAD transfer)

### F4.1 — Alarm-management standards give hard numbers for alert budgets
- **WHAT**: ISA-18.2 / EEMUA 191 (born from Piper Alpha) quantify operator limits: an operator can process roughly **1 alarm per minute** max; **>10 alarms in 10 minutes = alarm flood** (operator can no longer process individually); a well-managed system averages **fewer than ~6 alarms per operator per hour**; core rationalization rule: an alarm exists **only if it requires an operator response**.
- **WHO**: https://www.eemua.org/products/publications/digital/eemua-publication-191 ; https://plcprogramming.io/blog/what-is-alarm-management ; https://www.processvue.com/resources/alarm-management-guidelines/
- **EVIDENCE**: Strong — 25-year-old international standards, safety-incident-driven.
- **APPLICABILITY**: Direct design budget for Dina's console: sounds/toasts only for states requiring her action (cascade exhausted, driver no-show, socket down, caller waiting). Ride-progress events (accepted, arrived, completed) change color in place — they are *status*, not *alarms*. This single discipline is what separates calm consoles from the wall-of-blinking she left behind.

### F4.2 — Modern CAD design: optimize the critical path, role-specific views, degraded-mode backup
- **WHAT**: Mark43 (modern browser-based emergency CAD) design practice: make the dispatched path "as fast and frictionless as possible" while keeping non-dispatch routes accessible without cluttering it; dispatcher UI is explicitly 1-to-many (vs officer 1-to-1) and delivers "the right information at the right moment — unit recommendations, location context, responder status". Mark43 also ships **Alternate CAD** — a browser-based *backup dispatch console* on separate infrastructure for when the primary CAD is down, sold after real weather/cyber outages; Nashville's ECC director: dispatchers need "tools that they can rely on in a true emergency."
- **WHO**: https://mark43.com/platform/cad/ ; https://mark43.com/platform/cad/alternate-cad/ ; https://medium.com/mark43-engineering/creating-design-principles-at-mark43-4d414db8e0bf
- **EVIDENCE**: Medium-strong — shipped product + customer quotes; the alarm numbers above are the harder science.
- **APPLICABILITY**: High conceptually. Emergency dispatch's answer to "must not freeze" is not just uptime — it's a **planned degraded mode**. Sakta's cheap equivalent: when realtime dies, the console falls back to HTTP-polling read-only + a printed/on-screen phone list of the 10 drivers. Dina can always dispatch by voice; the console must never trap the data.

---

## 5. Zone / district queue implementations

### F5.1 — How shipped consoles display zone queues
- **WHAT**: Autocab: central zones grid, each zone showing its queued vehicles and their positions; vehicle list shows callsign + zone + time since last job; first-in-queue gets priority. TaxiCaller: zone-queue rules = "vehicles that have been available the longest in a zone will be prioritized"; **queue-entry trigger is configurable** (start queueing after drop-off, on job start, when driver presses "waiting", or on street job); the driver app shows the driver **their own position** ("Queue section shows the position of your vehicle in the zone queue") and a "MY ZONE QUEUE" view of all vehicles in their zone.
- **WHO**: https://support.autocab.com/hc/en-gb/articles/4418515554193-Using-the-Dispatch-Screen-365-B-D ; https://www.taxicaller.com/manuals/admin-panel/2/en/topic/advanced-zone-queues ; https://www.taxicaller.com/manuals/driver-app/1/en/topic/adding-a-new-job
- **EVIDENCE**: Strong — official docs of both products.
- **APPLICABILITY**: Very high. Two lessons: (1) dispatcher sees queues as a compact per-district table with positions and wait times; (2) **drivers seeing their own position is the fairness feature** — it converts "why did Jānis get that job?" phone arguments into self-service. For 10 drivers this is one small screen each.

### F5.2 — FIFO gaming patterns and countermeasures (documented at scale)
- **WHAT**: Uber/Lyft airport FIFO queues generated a rich documented abuse catalog: GPS spoofing into the staging zone and airplane-mode tricks to "fly back" to the queue; enabling premium service classes then toggling near queue-front to cherry-pick; drivers flagged for too many back-to-back short airport trips. Countermeasures shipped: queue position lost on going offline, leaving the geofence, declining multiple requests, or cancelling; re-entry protection; time-in-zone (not GPS position within zone) determines order. Research: with free declines, pure FIFO "incentivizes excessive cherry-picking" — randomized FIFO mechanisms mitigate (arxiv). A ScienceDirect study of NYC taxis ("Cheating when in the hole") shows rule-edge geography drives fraud: overcharging on 46% of NJ-bound rides vs 4.6% in-borough, because backtracking rules punish honest behavior.
- **WHO**: https://help.lyft.com/hc/en-us/all/articles/115012922787-Receiving-Airport-FIFO-pickup-requests ; https://help.uber.com/en/driving-and-delivering/article/queue-access ; https://www.uberpeople.net/threads/ultimate-guide-how-to-trick-the-fifo-queue-system-xl-lux-suv.205228/ ; https://arxiv.org/pdf/2111.10706 ; https://www.sciencedirect.com/science/article/abs/pii/S0361368219300650
- **EVIDENCE**: Strong — platform policy docs + first-hand driver-forum admissions + peer-reviewed work.
- **APPLICABILITY**: Medium-high. At 10 known drivers, social pressure does most enforcement, but encode the two cheap rules from day 1 because they define the data model: (a) queue position earned by *time available in zone since drop-off*, not GPS wiggling; (b) decline/timeout sends you back or down the queue (visible to the driver). Also heed iCabbi's published position that a **hybrid of zones + proximity** ("powerful rules and logic offers the best of both worlds") beats either pure mode — e.g., zone FIFO normally, closest-car override for ASAP jobs with an empty zone queue: https://icabbi.com/blog/taxi-dispatch-logic/
- **Gaming risk unique to Sakta**: FIFO + free declines = cherry-picking short fares to keep queue position; the arxiv result says exactly this. Countermeasure: declining a dispatched job costs the queue slot.

---

## 6. Reliability patterns — the console that must not freeze

### F6.1 — Reconnection state machine with visible status (industry reference guide)
- **WHAT**: websocket.org's reconnection guide (Matthew O'Riordan, co-founder of Ably; updated 2026) prescribes: exponential backoff 500ms → 30s cap with 50–100% jitter; heartbeat-based dead-connection detection; outbound **pending queue with IDs, retained until server ack** (at-least-once); sequence-numbered messages with replay-from-last-seq on reconnect; UI status surfaced *after the first failed retry*, cycling connecting → connected → reconnecting → disconnected, with a manual "click to reconnect" after max retries.
- **WHO**: https://websocket.org/guides/reconnection/
- **EVIDENCE**: Strong — canonical practitioner reference from the realtime-infrastructure industry.
- **APPLICABILITY**: Direct spec. The status pill ("Live / Atjaunojas... / Bezsaistē") is Dina's trust anchor — the TaxiCaller complaint ("does not refresh automatically", F1.2) is what happens without it: consoles that *look* alive while stale are worse than dead ones.

### F6.2 — Socket.IO Connection State Recovery: built-in but explicitly not sufficient
- **WHAT**: Socket.IO v4 ships Connection State Recovery: server retains socket rooms + missed packets for `maxDisconnectionDuration` (example: 2 min); on reconnect `socket.recovered` tells you if replay succeeded; docs explicitly warn recovery "will not always be successful" (server restart, duration exceeded, Redis pub/sub adapter unsupported — Redis Streams adapter works) and you **must implement full-state resync when `recovered === false`**.
- **WHO**: https://socket.io/docs/v4/connection-state-recovery
- **EVIDENCE**: Strong — official docs of the exact library Sakta uses.
- **APPLICABILITY**: Direct. At 10 drivers the full console state (rides + drivers + queues) is a few KB — the winning pattern is **snapshot-on-reconnect always** (fetch full state via REST, then resume socket), using CSR only as a fast path. This also survives API restarts on cheap infra.

### F6.3 — Optimistic UI with pending-operation queue; degraded mode as designed state
- **WHAT**: Production offline-first guidance (RxDB and others): render from confirmed base state + pending-intent deltas; queue mutations with ID/timestamp/status; reconcile on server response to avoid flicker. Emergency dispatch (Mark43 Alternate CAD, F4.2) shows the mature stance: assume the primary console *will* fail and design the fallback workflow.
- **WHO**: https://rxdb.info/articles/optimistic-ui.html ; https://mark43.com/platform/cad/alternate-cad/
- **EVIDENCE**: Medium — practitioner patterns, consistent across sources.
- **APPLICABILITY**: Medium. Full optimistic-UI machinery is overkill day-1; the day-1 slice is: booking form **never loses typed input** on disconnect (local draft), actions disabled-with-reason when offline, read-only polling fallback. That covers Dina's actual failure story at a fraction of the code.

---

## 7. Small-operation admin reality

### F7.1 — The Bolt Fleet Portal is what a 10-car Rīga operation uses today
- **WHAT**: Bolt's fleet-owner portal (the tool any Latvian mini-fleet already knows): live map with green (free) / purple (on trip) driver dots; Trips tab filterable by period and driver, **CSV download**; weekly/daily payout reports and invoices; add/manage drivers and vehicles. That is the whole admin surface, and fleets run on it.
- **WHO**: https://bolt.eu/en/support/articles/360012344613/ ; https://bolt.eu/en-pt/fleet/guide/fleet-management/
- **EVIDENCE**: Strong — official docs of the incumbent product in Sakta's exact market.
- **APPLICABILITY**: Very high. Day-1 admin = driver/vehicle CRUD, trips list with CSV export, commission config. Anything beyond that exceeds what the incumbent offers small fleets.

### F7.2 — Sub-20-vehicle operators run on radios/whiteboards/spreadsheets or cheap SaaS, not bespoke BI
- **WHAT**: Industry writing consistently describes small fleets pre-software as "radios, whiteboards, and spreadsheets"; the commercial step-up is per-vehicle SaaS (TaxiCaller $20/vehicle/mo, Onde.Light entry tier, Mobion free tier). No evidence anywhere of sub-20-vehicle operators using bespoke admin/analytics panels.
- **WHO**: https://mobion.tech/blog/articles/best-free-taxi-dispatch-software ; https://www.taxicaller.com/en/pricing ; https://onde.app/ondelight-taxi-operator-panel
- **EVIDENCE**: Medium — vendor/industry content, but unanimous and consistent with F7.1.
- **APPLICABILITY**: High. Validates minimal bespoke admin.

### F7.3 — Metabase self-hosted is the proven stats delegate for exactly this size
- **WHAT**: Metabase open-source self-hosts free via Docker on a cheap VM ("installs in under an hour"); its typical user is "small-to-mid-size companies where the data team is one or two people"; an 8-month practitioner review confirms viability (~$85/mo only if you buy the cloud Starter tier — self-hosted is $0 + VM). Documented adoption advice: replace **one recurring manual question** first; dashboards nobody checks are the failure mode.
- **WHO**: https://www.metabase.com/case-studies ; https://dev.to/paschalogu/how-i-self-host-metabase-why-your-team-should-too-1a6l ; https://valiotti.com/metabase-review/
- **EVIDENCE**: Strong — open-source product with large deployed base and independent reviews.
- **APPLICABILITY**: Very high. Point Metabase read-only at the existing Postgres; zero bespoke stats code. Fits the €100/mo budget (runs beside the API). Admin panel then shrinks to config + legal + driver CRUD — reinforcing the merge-into-one-app-as-role-routes idea.

---

## Top-10 shortlist (evidence × fit)

1. **Caller-ID screen pop with repeat-caller prefill** — measured 15–45 s/call saved (CTI industry), shipped by TaxiCaller PhoneLink ("Clean jobs" prefill: pickup/dropoff/passenger/phone) and iCabbi call pops. Highest measurable win for a phone-first fleet. (F2.1, F2.2, F2.3)
2. **Cascade → Unassigned exception bucket → force-assign** — TaxiCaller's shipped loop (attempts, accept-timeout, next driver, exhausted jobs land in Unassigned for hard-assign) is precisely Sakta's hybrid model, proven at small-fleet scale. (F3.1)
3. **Visible connection state + snapshot-on-reconnect** — websocket.org reconnection spec + Socket.IO CSR docs (with mandatory full-resync fallback); the top complaint about the closest comparable product is silent staleness. Dina's #1 ask, directly engineerable. (F6.1, F6.2, F1.2)
4. **Keyboard-first booking form** — Autocab 365's Space-to-book, arrow-key fields, "number + first letters" address search, printable shortcut sheet; the workflow professional dispatchers are trained on. (F2.4)
5. **Zones grid with queue positions + time-since-last-job** — Autocab's primary dispatch view is a compact zone/queue table, map secondary. Scales down perfectly to ~6 Rīga districts. (F1.1, F5.1)
6. **Driver-visible own queue position** — TaxiCaller driver app shows position and "MY ZONE QUEUE"; converts fairness disputes into self-service; matches gig-driver demand for allocation transparency. (F5.1, F3.3)
7. **Alarm discipline: alert only when action is required, <6/hour budget** — ISA-18.2/EEMUA 191 hard numbers; status changes recolor in place, alarms are reserved for cascade-exhausted / no-show / offline. (F4.1)
8. **One-line assignment explainability** — "Queue #1 Āgenskalns · in zone 47 min · 4 min away" satisfies both dispatcher-override confidence (PCS) and driver post-hoc explanation demand (arxiv 2406.10768). (F3.3)
9. **Offer vs Force-assign as two distinct verbs** — Onro + Onde both ship the pair; maps cleanly onto Sakta's state machine. (F3.2)
10. **Metabase for stats, Bolt-Fleet-Portal-sized admin** — self-hosted Metabase on the existing Postgres; bespoke admin limited to driver CRUD, trips CSV, commission config. (F7.1, F7.3)

## Dina's console: day-1 vs can-wait

**Day-1 (the pilot fails without these):**
- Keyboard-first phone-booking form (hotkey open, zero-mouse completion, Latvian-address typeahead, draft never lost on disconnect).
- Phone-number lookup → customer record with last 3 pickup/dropoff pairs, one keystroke to reuse (works day-1 even with manual number entry; SIP screen-pop can follow weeks later — same UI).
- Cascade status per ride ("offering to Jānis · 12s left · next: Māra") + Unassigned exception bucket + force-assign verb.
- District queue table: per-district driver order, time-in-queue; driver app shows own position.
- Connection-state pill + snapshot resync on reconnect + read-only polling fallback. Alert only on action-required events.
- Admin: driver/vehicle CRUD, trips list + CSV, commission config row.

**Can wait:**
- SIP/VoIP screen-pop automation (week-2+, not day-1), click-to-dial, call recording.
- Map as primary view (secondary toggle is enough; the zone table is the work surface).
- Optimistic-UI mutation queue; offer-broadcast/bidding fallback modes; "Reset rejects" sophistication.
- Metabase dashboards (start when Linards answers the first recurring stats question manually).
- Scheduled zone profiles, demand heatmaps, driver incentives.

**Enterprise bloat to avoid (evidenced as big-fleet features):** iCabbi's 1,000+ config options and partner-fleet overflow; IVR / AI-voice booking (kills the human-dispatcher differentiator at 10 drivers); driver bidding marketplaces (Sherlock/Cordic); multi-company/white-label switches; scheduled per-zone rule profiles; call-center suite features. Every one exists to solve coordination problems Sakta won't have below ~50 vehicles.
