# Driver-Side Ride-Hailing UX, 2022–2026 — Evidence Report

**Provenance:** web research agent, 2026-08-07 (session: UI-surface re-slice). ~45 searches + ~40 primary-source fetches: company blogs/help pages, journalism (The Markup, LSM, Reason, Documented NY, The Rideshare Guy), peer-reviewed work (CSCW, FAccT, ACM EC, NBER), driver forums (flagged anecdotal where used).
**Feeds:** tickets #14/#15 (driver app), #25 (radar), #27 (loyalty), `docs/ux-metrics-ledger.md`.

**The single most load-bearing fact found:** an analysis of 31,340 transparency-related driver-forum comments ([CSCW 2025, "Rideshare Transparency", arXiv:2406.10768](https://arxiv.org/html/2406.10768)) shows drivers' top grievances are opaque fare calculation (29% of comments), opaque promotions (37%), and too little information in too little time at offer moment ("you only have a few seconds really to choose"). Sakta Cab's flat 15% + full fare visibility directly attacks the #1 and #2 documented grievances of the incumbent model. Nearly everything below is detail on how to cash that in.

---

## 1. Fare / earnings transparency at offer time

### 1.1 Fare + destination shown before accept is now the industry baseline — drivers love the card, hate the algorithm behind it
- **WHAT:** Offer card showing exact payout, pickup and dropoff (cross-street level), pickup ETA, and trip duration before accepting.
- **WHO:** Uber "Upfront Fares", Columbus test ~Sept 2021 → most US markets by Aug 2022 ([Uber Under the Hood](https://medium.com/uber-under-the-hood/understanding-upfront-fares-7ab69c656101), [The Markup, Mar 2022](https://themarkup.org/working-for-an-algorithm/2022/03/01/secretive-algorithm-will-now-determine-uber-driver-pay-in-many-cities)). Lyft "Upfront Pay", Oct 2022 ([Lyft blog](https://www.lyft.com/blog/posts/upfront-pay-and-the-next-chapter-of-the-lyft-driving-experience)).
- **EVIDENCE it works:** Lyft's 1,000-driver survey: ~80% approved, >70% preferred it to blind dispatch. Rideshare Guy synthesis: drivers universally value declining unprofitable rides with full information ([link](https://therideshareguy.com/uber-rolling-out-new-driver-features/)). **Evidence of the failure mode:** the same rollout carried opaque algorithmic pricing — Uber's median UK take rate rose 25%→29%, >50% on some trips (FAccT 2025, 1.5M trips / 258 drivers, [arXiv:2506.15278](https://arxiv.org/abs/2506.15278)); 78% of 2,552 surveyed US drivers said driving now "feels like gambling" ([SF Public Press, 2025](https://www.sfpublicpress.org/drivers-protest-ubers-black-box-fare-system/)); NELP puts Uber's effective take at ~42% post-upfront-pricing ([NELP](https://www.nelp.org/insights-research/unpacking-uber-and-lyfts-predatory-take-rates/)). Transparency of the *number* doesn't buy trust if the number's *origin* is a black box.
- **APPLICABILITY: YES, core.** Sakta's offer card should show: fare in EUR, destination, pickup distance/ETA, trip duration, and — because the commission is flat — "you keep €X.XX (85%)". With deterministic tariff pricing there is no black box to distrust. Cost: zero beyond the 4-screen loop already planned.

### 1.2 Bolt hid destination and price until a regulator forced disclosure — in the Baltics, this decade
- **WHAT:** Bolt's offer card historically showed only pickup + rider rating; destination/price visibility arrived per-market, under pressure.
- **WHO/EVIDENCE:** Lithuania: drivers saw price only after drop-off until complaints to the State Labor Inspectorate (VDI) made Bolt show destination + price pre-accept; a 20-driver Labor Disputes Commission claim was rejected on jurisdiction because Bolt is registered in Estonia ([MadeinVilnius](https://madeinvilnius.lt/en/verslas/vilniaus-rinka/bolt-vairuotojai-kyla-i-teisine-kova-del-savo-teisiu-12-valandu-darbo-diena-ir-jokio-saugumo/) — direct fetch blocked, facts via excerpts, date unverified). London: Bolt shows only the destination *borough*, which drivers call vague ([appdriver.co.uk](https://appdriver.co.uk/bolt-drivers-will-now-be-able-to-see-riders-destination/)). Feb 2022: Lithuanian Bolt drivers struck over commission hikes to 25%; Bolt suspended strikers' accounts ([LRT](https://www.lrt.lt/en/news-in-english/19/1623365/ride-hailing-app-bolt-bans-some-striking-drivers-in-lithuania)). Bolt Latvia commission today: 25% + VAT = 30.25% ([Bolt LV](https://bolt.eu/en/driver/earn/latvia/riga/)).
- **APPLICABILITY: YES — this is the competitive wedge.** Bolt's regional record (opacity until forced, striker bans, 30% effective take) is documented, local, and recent. Full disclosure at offer time is simultaneously the driver-preferred and the regulator-preferred default (EU Platform Work Directive context: [euobserver](https://euobserver.com/investigations/ar30f725bb)). Gap flagged: current Bolt Rīga offer-card contents unverified — check in-app before writing marketing copy.

### 1.3 What belongs on the offer card (converging evidence)
- **WHAT:** (1) payout for this trip, (2) pickup ETA/distance — unpaid time is the hidden cost drivers resent most, (3) destination + trip duration, (4) effective rate (€/km — drivers compute it themselves when absent; Uber piloted printing per-km earnings on the card in Mexico, [Uber MX blog](https://www.uber.com/en-MX/blog/piloting-estimated-earnings-per-kilometer-on-trip-requests/)), (5) rider rating, (6) Lyft added est. $/hour on the accept screen Oct 2024 ([Lyft](https://www.lyft.com/blog/posts/driving-transparency-clear-communication-on-earnings-for-drivers)).
- **EVIDENCE:** The CSCW paper's driver-stated needs list matches exactly: full addresses (not abbreviated), upfront earnings, rate breakdown, duration/distance, more decision time. Long pickups for short trips = 1,429 complaint comments on their own.
- **APPLICABILITY: YES.** All fields are already in Sakta's data model. Show €/km computed client-side. Confidence: moderate (assembled from guides/excerpts, no single systematic source besides the CSCW paper).

### 1.4 inDrive: driver sees what the passenger pays, always
- **WHAT:** Bidding aside, inDrive's card shows the passenger's offered price and the deductions openly; commission ~10% globally, ~12% Europe.
- **WHO:** [inDrive driver guide](https://blog.indrive.com/article/drivers-101-how-to-use-our-app); Oxford Economics 7-market study (commissioned by inDrive): ~75% of trips negotiated, drivers say negotiation avoids under-compensated trips ([Zag Daily](https://zagdaily.com/featured/in-app-fare-bargaining-leads-to-more-ride-hailing-trips-oxford-economics-finds/)).
- **APPLICABILITY: ADAPTED.** Skip bidding (dispatcher + fixed tariff is Sakta's model, and bidding is UX-heavy for 10 drivers). Take the disclosure norm: rider-paid total visible to the driver on every offer and receipt. Evidence on bidding outcomes is sponsored — moderate confidence only.

---

## 2. Demand positioning

### 2.1 Heatmaps move drivers in aggregate but individual drivers distrust and mis-use them
- **WHAT:** The surge heatmap is the incumbent default; the evidence on it is two-sided.
- **WHO/EVIDENCE (for):** Uber's own natural experiment (heatmap outage, 10 cities, ACM EC '18): heatmap visibility explains 10–60% of positioning decisions and raises revenue *on surged trips* up to 70% ([ACM](https://dl.acm.org/doi/pdf/10.1145/3219166.3219192)) — note Uber-authored, and the 70% is surged-trips-only, widely misquoted. **(against):** dominant driver folk wisdom is "don't chase the surge" — everyone sees the same blob, supply converges, the multiplier collapses, the map lags ([Gridwise](https://gridwise.io/blog/rideshare/why-you-should-never-chase-surges-and-what-to-do-instead/), [Maximum Ridesharing Profits](https://maximumridesharingprofits.com/advice-new-uber-drivers-dont-chase-surge/)); "phantom surge"/"bait and ditch" threads recur for a decade ([UberPeople](https://www.uberpeople.net/threads/scam-sticky-surge-appearing-in-impossible-areas-bait-and-ditch.469088/)); foundational: Rosenblat & Stark, CSCW 2016. Lyft's "Personal Power Zones" (2019) — flat pickup bonuses drivers renamed "personal poverty zones"; a $12 bonus replacing what would have been a $30-ride surge cut payouts, take rate up 8% ([KQED](https://www.kqed.org/news/11765631/who-wins-with-lyfts-new-driver-bonus-formula)). No PPZ lawsuit exists (searched directly).
- **APPLICABILITY: NO to heatmaps.** For 10 drivers in one city a heatmap is worse than useless — with that supply density, showing all drivers the same blob guarantees convergence. This is a feature to *not* build, which fits the budget perfectly.

### 2.2 Explicit "go here now" guidance is the validated alternative — and Sakta already has the agent for it
- **WHAT:** Directed repositioning instructions instead of passive maps.
- **WHO/EVIDENCE:** DiDi's AI Driver Assistant, field experiment with ~1,200 drivers in 3 Chinese cities: explicit RL-driven "go here" instructions beat experienced drivers' own judgment on key metrics ([Transportation Research Part C](https://www.sciencedirect.com/science/article/abs/pii/S0968090X21003004)) — the only *validated* repositioning guidance found. Supporting: TU Delft stated-choice study (n=576): drivers follow guidance, but willingness drops sharply with distance ([Transportation Letters 2023](https://www.tandfonline.com/doi/full/10.1080/19427867.2023.2192581)). NBER (>1M drivers): veterans earn 14% more/hour largely by knowing *where and when* ([w24732](https://www.nber.org/papers/w24732)) — i.e., the valuable thing to ship is encoded local timing knowledge, which heatmaps don't transfer.
- **APPLICABILITY: YES, adapted — this validates the demand-wave radar.** Sakta's human dispatcher + RIX flight/bus-arrival triggers is exactly the "explicit, trusted, short-distance guidance" the evidence favors, at Rīga scale where a human genuinely knows the rhythms. Two evidence-backed design rules: keep suggestions near (distance kills compliance) and keep them *optional with zero penalty* (Lyft's airport pre-dispatch was explicitly no-penalty, [Gridwise](https://gridwise.io/blog/uber-lyft-airport-tips-know-before-you-go)).

### 2.3 Flight-arrival data as driver-facing UX is proven, shipped, and loved
- **WHAT:** Showing drivers upcoming flight arrivals + queue depth + estimated time to request, per airport.
- **WHO:** Uber — tapping the airport marker shows wait class (0–15/15–30/>30 min), drivers currently in queue, and **arriving flights in the next hour**; the forecast model explicitly ingests flight distributions ([Uber engineering blog, Mar 2023](https://www.uber.com/us/en/blog/demand-and-etr-forecasting-at-airports/)). Third-party Gridwise built its flagship feature on live flight data + hourly passenger-demand graphs; reviewers cite it as the reason they stopped "waiting in a dead queue" ([Gridwise](https://gridwise.io/blog/gridwise-airport-demand-feature), [Rideshare Guy review](https://therideshareguy.com/gridwise-review-maximize-earnings/)).
- **EVIDENCE:** Uber's is a primary engineering source; Gridwise is vendor-plus-independent-review. Strong.
- **APPLICABILITY: YES — strongest external validation of a planned Sakta feature.** One airport (RIX) + one bus station makes this nearly free: a public arrivals feed, a screen showing "3 flights / ~410 seats landing 22:10–23:00, 2 drivers positioned" is a genuine differentiator Bolt does not offer in any documented market (Bolt's entire demand guidance is "areas coloured red on the map", [Bolt support](https://bolt.eu/en/support/articles/4405582174994/)).

---

## 3. Earnings clarity, receipts, payouts

### 3.1 Per-trip receipt showing the full split — shipped late, under duress, and still not trusted at incumbents
- **WHAT:** Receipt per trip: what the rider paid, each deduction, what the driver kept; weekly take-rate summary.
- **WHO:** Lyft, Feb 2024 — "see a breakdown of where every cent of the rider fare goes" + the 70% weekly earnings floor ([Lyft](https://www.lyft.com/blog/posts/driving-transparency-clear-communication-on-earnings-for-drivers)). Uber, Dec 2024 — weekly *average* take rate disclosed in-app, still no per-trip rate ([Rideshare Guy](https://therideshareguy.com/uber-finally-comes-clean-with-take-rates-more-transparency/)).
- **EVIDENCE:** Lyft's own post-launch metrics: +20pp of drivers saying they're paid fairly, 75% reporting better understanding of earnings within a month (company-sourced, moderate). Uber's disclosure landed flat: screenshots show weekly "take rates" from ~20% to *negative 75%* once insurance deductions churn through, and the Rideshare Guy verdict was "trust… has left the building a long time ago." Lyft also paid a $2.1M FTC penalty for misleading earnings-guarantee ads ([DOJ](https://www.justice.gov/archives/opa/pr/lyft-pay-civil-penalty-resolve-allegations-misleading-drivers-about-their-potential-earnings)) — inflated claims backfire legally.
- **APPLICABILITY: YES, trivially.** Incumbents struggle because their split *varies per trip*; Sakta's is a constant 15%. `Rider paid €12.40 → Sakta €1.86 → You €10.54` on every receipt, identical arithmetic every time, is the whole feature. The evidence says consistency-of-arithmetic is precisely what rebuilds the trust incumbents lost. Never promise average earnings figures (FTC lesson).

### 3.2 Fast payout access measurably increases driving supply
- **WHAT:** On-demand cash-out instead of weekly settlement.
- **WHO:** Uber Instant Pay (up to 6×/day, $0.85/cashout, [Uber](https://www.uber.com/us/en/drive/driver-app/instant-pay/)).
- **EVIDENCE:** Strong — quasi-experimental academic study: Instant Pay availability increased daily labor supply and earnings by ~2.4% ([Chen et al., UCLA Anderson](https://www.anderson.ucla.edu/faculty_pages/keith.chen/papers/WP_InstantPay.pdf)); 70% of Uber driver payments went through it by 2019; $1.3B cashed out in year one ([TechCrunch](https://techcrunch.com/?p=1473015)). Bolt pays weekly, with 24–72h balance lag ([Bolt](https://bolt.eu/en-lv/driver/guide/earnings/)) — a directly attackable weakness.
- **APPLICABILITY: ADAPTED.** True instant pay needs card-push infrastructure; but Latvia is a SEPA Instant country — daily (or on-demand, capped) SEPA instant payouts cost cents and beat Bolt's weekly cycle. At 10 drivers this is a manual-plus-script operation well under budget. Verify Stripe test-mode constraints before the pilot (no SIA yet).

### 3.3 Glanceable running earnings total
- **WHAT:** Always-visible today's-earnings card on the home screen.
- **WHO:** Uber Real-time Earnings Tracker, part of the Carbon driver-app rewrite ([Uber blog, 2019](https://www.uber.com/us/en/blog/real-time-earnings-tracker/); rewrite rationale: [eng.uber.com](https://eng.uber.com/rewrite-uber-carbon-app/)).
- **EVIDENCE:** Uber reports 86% of drivers use it on driving days — the highest engagement figure any driver-app feature has published. Company-sourced but plausible; moderate-strong.
- **APPLICABILITY: YES.** One number ("Today: €84.20, 7 rides") on the online screen. Hours of work, not days.

---

## 4. Driver-first challengers and co-ops — what actually happened

### 4.1 Empower (Washington DC): the only challenger that proved rider demand — killed by non-compliance, not the market
- **WHAT:** Drivers pay a flat subscription ($14.99/wk–$29.99/mo in Houston), keep 100% of fares, set prices from a *suggested rate card*; fares ~20% under Uber.
- **WHO/EVIDENCE:** 15,000+ drivers, 6M+ rides, ~100K riders/month in DC (partly company-sourced); driver quote: "I only use Empower because I make more money" ([51st News](https://51st.news/empower-dc-uber-ride-hailing/)). Death: not demand but law — ~$50.4M in accumulated fines/taxes, CEO contempt and jail threat, Maryland cease-and-desist Jul 2026 ([Reason](https://reason.com/2026/02/23/it-looks-like-the-end-of-the-road-for-rideshare-alternative-empower-in-d-c/), [Baltimore Banner](https://www.thebanner.com/community/transportation/empower-rideshare-maryland-operations-CM2WNYD22FB7BIWZNSGRLPTFCQ/)). Root violations: no commercial insurance, unverified background checks, unpaid taxes.
- **APPLICABILITY: YES as economics proof, NO as conduct.** Driver-first pricing demonstrably pulls both sides of the market. The lesson is that compliance *is the moat*: Sakta being the aggressively licensed operator (vs Bolt's Estonian-registration jurisdiction dodging, per the Lithuanian case) is a defensible position Empower refused to build.

### 4.2 The Drivers Cooperative (NYC + Colorado): driver-side virtue does not create rider demand
- **WHAT/EVIDENCE:** NYC co-op, 15% commission, $30/hr floor, in-house app. Recruited ~12,000 drivers, but 2022 net loss $318K on $5.9M revenue; missed driver payments, governance revolt, and a survival pivot to Medicaid paratransit ([Documented NY](https://documentedny.com/2024/10/07/forman-nyc-driver-cooperative-taxi-ride-share/), [HN financials](https://news.ycombinator.com/item?id=36766844)). Colorado sibling: 2 years to build an app, ~1,500 drivers, ~2,000 rides/month total — 1.3 rides/driver/month ([Rocky Mountain PBS](https://www.rmpbs.org/news/business-economy/drivers-cooperative-colorado)).
- **APPLICABILITY: cautionary, central.** Same commission as Sakta (15%), same driver-first pitch — starved on the demand side twice. For a Q4 2026 pilot: anchored demand (RIX access, hotel/corporate accounts, the human dispatcher's phone book) matters more than any driver-app feature. Also: paying drivers on time beats every UX innovation on this list.

### 4.3 RideAustin: died when the incumbent returned; left an MIT-licensed full platform
- **WHAT/EVIDENCE:** Nonprofit, peak 59K rides/week while Uber/Lyft were absent; rides fell 62% in the week they returned (Texas HB 100, May 2017); shut down Jun 2020; lifetime 3M rides/$38M to drivers ([Texas Monthly](https://www.texasmonthly.com/the-daily-post/the-saga-of-rideaustin/), [Community Impact](https://communityimpact.com/austin/central-austin/impacts/2020/06/12/rideaustin-shuts-down-operations/)). Open-sourced rider/driver apps + server + admin console under MIT: [github.com/ride-austin](https://github.com/ride-austin).
- **APPLICABILITY: YES twice.** (a) Strategic: a challenger whose only edge is presence dies when Bolt reacts — the moat must be driver loyalty + dispatcher relationships + contracts. (b) Practical: a free, production-proven (3M rides) reference architecture for dispatch/admin feature scope. 2019-era stack — mine for scope, don't port.

### 4.4 The rest, briefly
- **Juno (NYC 2016–19):** low commission + driver equity; equity promise voided after the $200M Gett sale (drivers got ~$100), shut down 2019 at 3% share ([Vice](https://www.vice.com/en/article/juno-was-supposed-to-be-the-ethical-uber-then-it-sold-out-and-died/)). Lesson: never promise drivers future value you can't contractually guarantee — loyalty tiers must vest simply and immediately.
- **Eva (Montreal):** alive, but as a delivery co-op (~10,000 couriers); consumer ride-hail faded; blockchain layer quietly abandoned ([La Presse](https://www.lapresse.ca/affaires/2025-12-26/plateforme-de-livraison-quebecoise/eva-une-solution-de-rechange-a-amazon.php)).
- **Nomad Rides (Indiana):** $25/mo subscription, cash payment, no licensing — quiet death ~2020. 70 drivers × $25 = $1,750/mo ceiling; do that arithmetic for any subscription idea at 10 drivers.
- **Arcade City:** ideology + Facebook group, no dispatch product, token PR; never produced measurable volume ([TechCrunch](https://techcrunch.com/2016/06/21/austin-police-are-now-impounding-drivers-in-the-peer-to-peer-ridesharing-group)).
- **Forus (Estonia):** Tulika Takso rebrand on white-label software (TaxiGo), €3.6M revenue and first profit €54K in 2023 beside Bolt ([Postimees](https://majandus.postimees.ee/7841704/soorumaa-forus-takso-enam-kui-kahekordistas-kaibe-ja-joudis-kasumisse)); its "ownership token" produced no visible follow-through (PR). Lesson: a Baltic local *can* be small-profitable next to Bolt by inheriting licensed fleet + existing demand.
- **Latvia locals (Dispocars, ZIP Taxi, MOBI, Panda, Red Cab):** directory-grade evidence only; no outcome reporting — meaning no local has yet paired the documented anti-Bolt grievance ([Lente.lv](https://lente.lv/auto/raksts/taksometru-nozares-sasutums-vietejie-uznemumi-versas-pret-bolt-monopolu-un-negodigu-konkurenci-27470.html), 3.5x Song-Festival surge anger) with a credible driver-first product. The seat Sakta wants is empty.

---

## 5. Offer-flow ergonomics while driving

### 5.1 Accept timer: longer is safer and reduces cancellations
- **WHO/EVIDENCE:** Uber officially 15 seconds, up from ~10 via pilots; rationale: fewer rushed accepts → fewer cancellations/no-shows; driver sentiment: "we will take all the seconds we can get" ([Uber help](https://help.uber.com/driving-and-delivering/article/getting-a-trip-request?nodeId=e7228ac8-7c7f-4ad6-b120-086d39f2c94c), [Rideshare Guy](https://therideshareguy.com/uber-extends-offer-acceptance-time-ping-for-drivers/)). The CSCW paper's #1 design recommendation is a pause/hold to decide while safely stopped. Lyft/Bolt ride timers unpublished (flagged gap).
- **APPLICABILITY: YES.** With a human dispatcher and no competing driver pool of thousands, Sakta can afford 20–30s + audible countdown, and "no penalty for declining" as policy — both directly counter documented Bolt behavior (declines and timeouts cut Bolt's acceptance metric, [Bolt LV FAQ](https://bolt.eu/en-lv/driver/guide/faq/)).

### 5.2 Speed-gated interaction (the only published distraction-safety mechanic)
- **WHO:** Uber Trip Radar — browsable offer list gated to stationary/slow movement, "pull over" in the official copy; explicitly no acceptance-rate impact ([Uber help](https://help.uber.com/en/driving-and-delivering/article/what-is-trip-radar?nodeId=aa3d4d28-1fd6-45eb-bd08-1a043ca0ba4b)).
- **APPLICABILITY: ADAPTED.** Skip Trip Radar itself; adopt the principle: anything beyond accept/decline (queue browsing, radar detail, earnings) collapses to a minimal glanceable state above ~10 km/h. Cheap with existing GPS plumbing.

### 5.3 Accept ergonomics: giant target, redundant channels
- **WHO/EVIDENCE:** Uber: tap-anywhere black bar / flashing button + ping; Lyft: audio announcement for queued rides, "flash for new rides" accessibility option for deaf drivers ([Lyft help](https://help.lyft.com/hc/en-us/driver/articles/115012927627-Accessibility-features-for-drivers)); white-label Onde pitches "large fonts, bold buttons, high-contrast" + lock-screen accept ([Onde](https://onde.app/driver-app)). Auto-added queue rides that skip the inspect-moment are a documented complaint ([UberPeople](https://www.uberpeople.net/threads/a-way-to-avoid-lyft-rides-being-auto-added-to-queue.303786/)); Bolt's only mid-trip control is a one-way "stop new orders AND go offline" hand icon — an anti-pattern.
- **APPLICABILITY: YES.** Full-screen offer, whole-card tap target (well past the 44px rule), sound + flash + haptic. Notably: **no platform publishes anything about TalkBack/VoiceOver on the driver offer screen** — genuine white space that matches Sakta's screen-reader-excellent launch differentiator. Confidence on the a11y gap: strong-negative (searched, absent).

### 5.4 Navigation: deep-link out, don't build
- **WHO/EVIDENCE:** Lyft never built turn-by-turn (Waze default 2017, embedded Google 2018 — [TechCrunch](https://techcrunch.com/?p=1554343)); Uber has in-app nav that forum consensus says to ignore in favor of Google/Waze ([UberPeople](https://www.uberpeople.net/threads/new-driver-which-navigation.487731/) — anecdotal but uniform); small-fleet practice: Onde deep-links to the driver's preferred nav app; iCabbi's embedded Google Fleet Engine build is an enterprise-scale investment ([iCabbi](https://icabbi.etgl.co.uk/2024/03/07/google-maps-integration/)); a Lyft update *reducing* external-nav integration drew complaints.
- **APPLICABILITY: YES — decision-grade.** Deep-link to Google Maps/Waze with a reliable return path; never build nav. Also the budget-correct choice (<€100/mo).

---

## 6. Queue fairness

### 6.1 Displayed position + FIFO still fails if any movement is unexplained
- **WHO/EVIDENCE:** Uber shows numeric position in-zone, driver count from outside, FIFO with documented dequeue rules ([Uber help](https://help.uber.com/en/driving-and-delivering/article/queue-access?nodeId=1275528f-2ba7-4ca4-982f-6aca4e3fad99)) — and *still* accumulates years of "queue is rigged" threads, mostly because multi-vehicle-class matching makes skips look arbitrary (being #6 and watching #9 get the long trip) ([UberPeople](https://www.uberpeople.net/threads/airport-queue-manipulation.353471/), anecdotal individually, overwhelming as a pattern). Uber has been drifting from raw position to dynamic "estimated time to request" ([Uber blog 2019](https://www.uber.com/en-US/blog/airports-drivers/)). A 2025 arXiv model formalizes FIFO's failure modes (short-trip gaming, lot oversupply) ([arXiv:2509.25071](https://arxiv.org/pdf/2509.25071)).
- **APPLICABILITY: YES.** Sakta's advantage: one vehicle class, 10 drivers — strict FIFO can actually *be* strict. Show the number ("2nd in Vecrīga queue"), and put an explanation in-UI for every deviation ("Jānis was dispatched ahead: wheelchair-accessible request"). The evidence says an unexplained skip destroys more trust than no number at all.

### 6.2 Short-trip position hold is the fairness valve drivers value
- **WHO:** Uber: short airport trip → queue spot held on return, priority persists across offline periods; QuickPass; rematch-at-dropoff ([Uber help](https://help.uber.com/en/driving-and-delivering/article/queue-access?nodeId=1275528f-2ba7-4ca4-982f-6aca4e3fad99)). Anti-pattern flag: Uber gates *priority* rematch behind Uber Pro tiers.
- **APPLICABILITY: YES.** Directly reusable for the RIX queue and for return-ride matching: a short fare out of a queue zone re-inserts the driver at their old position. Trivial in Redis; never tier-gate it.

### 6.3 Bolt's Baltic queue mechanics — the local benchmark to beat
- **WHO/EVIDENCE:** Auto-join geofenced airport queue; drivers see per-category "cars ahead" counts, not one position number; reject/ignore → back of queue; twice in a row → 2-hour area ban (Estonia); spot lost on exit/logout/cancel ([Bolt Estonia](https://bolt.eu/en/support/articles/7406794048786/), [Bolt Lithuania](https://bolt.eu/en-lt/driver/guide/airports-info/)). No Baltic-language driver sentiment found (language gap, flagged unknown). RIX context: curb monopoly for licensed card-holders since 2019, Bolt relegated to P1 car park, fare caps since Mar 2024 after overcharging scandals, and a live taxi-vs-Bolt protest in Apr 2026 ([LSM](https://eng.lsm.lv/article/economy/transport/13.04.2026-hundreds-of-taxi-drivers-protest-in-riga-monday.a642639/)).
- **APPLICABILITY: YES.** Sakta beats this benchmark by (a) exact position instead of category counts, (b) no punitive bans — declining costs your turn, nothing else, (c) explained deviations. RIX curb access is a *business* prerequisite (license card) that outweighs any queue UX — confirm before building the airport screen. Small-fleet dispatch vendors (Autocab "Dual Queue Zones", TaxiCaller zone queues) confirm per-zone position queues are the traditional-taxi norm, but public UX detail is thin (vendor pages only).

---

## Hype / AI-slop to avoid
- **App-clone agency SEO** dominates searches for inDrive, Bolt-competitor, and "taxi app features": Miracuves, Oyelabs, Grepix, Drivemond, Mobion, CabZen, "UBERApps", Taxi Web Design ranking itself #1. Zero evidentiary value; excluded throughout.
- **Blockchain/token "driver ownership"**: Eva's EOSIO layer (abandoned), Forus's "US Token" (no follow-through), Arcade City's ARCD (nothing). Three-for-three failure as product substance; pure PR.
- **Student/portfolio "driver app redesign" case studies** on Medium — inspiration at best, not evidence.
- **Company-reported reception metrics** (Lyft's "80% approved", Empower's "$100M earned", Gridwise's own feature claims) — used above only where corroborated, always labeled.
- **Vendor-authored white-label comparisons** (Onde ranking Onde) — no independent small-fleet feature evidence exists at all; that absence is itself the finding.
- **Uber Pro-style gamified tiers tied to acceptance rate**: >75% of a driver poll called Uber Pro worthless; drivers call it "manipulative games"; peer-reviewed support in Vasudevan & Chan, New Media & Society 2022 ([SAGE](https://journals.sagepub.com/doi/full/10.1177/14614448221079028)). Directly relevant caution for Sakta's loyalty commission tiers: tie tiers to tenure/quality only, pay them in commission points (real money), and never condition them on acceptance rate.

---

## Top-10 shortlist (evidence strength × Sakta fit)

| # | Pattern | Evidence anchor | Sakta fit |
|---|---------|-----------------|-----------|
| 1 | **Full-information offer card** (fare, "you keep €X (85%)", destination, pickup km/ETA, duration, €/km, rider rating) | CSCW 31K-comment study; Uber/Lyft shipped it; Lithuanian regulator forced it on Bolt | Direct — core of the 4-screen loop |
| 2 | **Constant-arithmetic per-trip receipt** (rider paid → 15% → driver kept, identical math every trip) | NELP/FAccT/Oxford: variable hidden take is grievance #1; Uber's Dec-2024 weekly disclosure flopped because the math still varied | Direct — flat commission makes it trivial |
| 3 | **RIX flight-arrival demand screen** (arrivals next hour + drivers positioned + wait class) | Uber engineering blog (shipped, model uses flight data); Gridwise built a beloved product on it | Direct — validates demand-wave radar; one airport = cheap |
| 4 | **Dispatcher "go here now" nudges, near-radius, zero-penalty** — instead of heatmaps | DiDi field experiment (beat driver judgment); TU Delft distance-decay; decade of heatmap distrust | Adapted — the human dispatcher is the mechanism |
| 5 | **Strict FIFO queue with visible position + in-UI explanation of every deviation + short-trip position hold** | Uber queue docs + pervasive "rigged queue" complaints where skips are unexplained; Bolt's punitive Baltic variant as local anti-benchmark | Direct — single vehicle class makes true FIFO possible |
| 6 | **Fast payouts** (daily / on-demand SEPA instant vs Bolt weekly) | UCLA quasi-experiment: +2.4% labor supply; 70% of Uber payments via Instant Pay by 2019 | Adapted — SEPA instant, near-zero cost at 10 drivers |
| 7 | **Nav deep-link handoff (Google Maps/Waze), never in-app nav** | Lyft never built one; uniform driver preference; small-fleet norm (Onde) | Direct — also the only budget-sane option |
| 8 | **Generous accept timer (20–30s) + no acceptance-rate penalties, ever** | Uber's own extension to 15s to cut cancellations; CSCW pause/hold recommendation; Bolt's penalty metric as local foil | Direct — cheap policy + one countdown widget |
| 9 | **Glanceable running daily-earnings card** | Uber: 86% of drivers use it on driving days — best engagement stat published for any driver feature | Direct — one number on the online screen |
| 10 | **Loyalty tiers decoupled from acceptance behavior** (tenure/volume → commission %, vests immediately) | Uber Pro backlash + Vasudevan & Chan 2022; Juno's voided-equity betrayal | Adapted — shapes the already-planned commission tiers |

**Strategic findings that outrank any UX item:** (a) every driver-first challenger recruited drivers easily and starved for riders — anchored demand (RIX access card, dispatcher phone book, corporate accounts) is the pilot's real risk, per TDC ×2, RideAustin, Eva; (b) compliance is the moat — Empower proved the economics and died of regulatory arbitrage, while Bolt's jurisdiction-dodging is a documented local grievance; (c) paying drivers correctly and on time beats every feature above (TDC's collapse); (d) [github.com/ride-austin](https://github.com/ride-austin) is a free MIT-licensed, 3M-ride-proven reference for dispatch/admin scope.

**Evidence gaps flagged for follow-up:** current Bolt Rīga offer-card contents and timer (verify in-app); Bolt's RIX driver-queue mechanics; Baltic-language driver sentiment (LV/RU forums unsearched); TalkBack/VoiceOver behavior of any driver app (white space); Lyft's exact accept timer.
