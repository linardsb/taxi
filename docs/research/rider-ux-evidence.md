# Rider-Side UX Innovations in Ride-Hailing (2022–2026) — Evidence Report

**Provenance:** web research agent, 2026-08-07 (session: UI-surface re-slice). Shipped features only, with named owners and outcome evidence where it exists.
**Feeds:** tickets #16/#17 (rider app), #21 (scheduled rides), the SMS + live-tracking-page ticket, `docs/ux-metrics-ledger.md`. Its PWA-vs-native verdict (end of doc) decided the rider-app delivery question — see `docs/epics/sakta-cab.architecture.md`.

Fit assessments assume: solo developer, <€100/mo, Q4 2026 Rīga pilot, ~10 drivers, phone+app booking, screen-reader-first launch requirement, Expo/RN rider app.

---

## 1. Screen-reader-excellent ride booking

### 1.1 Full VoiceOver/TalkBack parity as the baseline, not the differentiator
- **WHAT**: Uber and Lyft apps are fully operable with VoiceOver/TalkBack — request, cancel, contact driver, pay — with braille display support.
- **WHO**: Uber ([accessibility hub](https://www.uber.com/us/en/about/accessibility/), [newsroom commitment, with NFB and LightHouse SF partnerships](https://www.uber.com/newsroom/commitment-to-innovation-for-the-blind-and-low-vision-community)); Lyft; Gett shipped VoiceOver/TalkBack integration as early as 2015 ([IBTimes](https://www.ibtimes.com/gett-updates-app-blind-passengers-voiceover-talkback-technology-2009309)).
- **EVIDENCE**: AFB's AccessWorld reviewed both apps as "completely accessible with VoiceOver, although a bit of a learning curve is involved" and credited ride-hailing with changing blind mobility ([AFB AccessWorld](https://afb.org/aw/17/11/15386)). Mike May (Sendero Group): "the single best advancement for the mobility of blind people in the past decade." AFB/GDB's 2020–21 survey of 500+ blind travelers found a measurable shift *to* rideshare from transit and walking ([BusinessWire](https://www.businesswire.com/news/home/20220922005306/en)).
- **APPLICABILITY**: **Yes, directly.** Blind riders already prefer ride-hailing when the app works. The bar is genuine parity, which a small app built accessible-from-day-one can hit more easily than a retrofit.

### 1.2 The two flows that actually break for blind users: map/pin interaction and vehicle identification
- **WHAT**: Published research and community reports converge on two failure points, and neither is "labels missing on buttons": (a) map-pin pickup placement and walk-to-pickup-point flows; (b) identifying the arrived vehicle.
- **WHO/EVIDENCE**:
  - Uber's own VoiceOver design case study (Stephanie Brisendine, Uber design) names Express Pool pickup-point navigation and "which car is mine" as the core unsolved problems; documented workarounds are calling the driver and describing yourself, or asking strangers ([sbrisendine.com](https://sbrisendine.com/designing-voiceover-experiences/)). It also notes blind users consume audio at up to 3x speed — verbose hints are a cost, not a courtesy.
  - A 2025 in-the-wild study with 10 blind participants supported by remote O&M guides characterizes the origin-to-vehicle "last 50 feet" as the hardest segment: degraded GPS, ambient noise, locating a specific car door ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S107158192500151X)).
  - AppleVis threads document gesture/flow breakage in Uber's booking UI and third-party workarounds (BlindSquare's Uber gateway) ([AppleVis](https://www.applevis.com/forum/accessibility-advocacy/how-deal-ubers-brush)).
  - NFB runs a standing rideshare discrimination survey; a March 2026 report found blind/low-vision riders still report discrimination (mostly guide-dog refusals) despite accessible apps ([NFB](https://nfb.org/programs-services/legal-program/rideshare-discrimination-survey), [Healio](https://www.healio.com/news/optometry/20260305/people-who-are-blind-have-low-vision-report-discrimination-with-rideshare-services)).
- **APPLICABILITY**: **Yes — this defines the spec.** For Sakta: text-first booking (search field + saved addresses, map never required to complete a booking), no pin-dragging on the critical path, and an explicit driver-arrival protocol (below). The state-of-the-art apps still haven't solved arrival identification — a 10-driver operation can, procedurally.

### 1.3 Shipped arrival-identification solutions: human help and car-emitted sound
- **WHAT**: (a) Lyft×Aira: remote sighted agents book the Lyft, relay vehicle details, track the ride, and guide the last 50 feet ([Aira/Medium](https://medium.com/aira-io/aira-partners-with-lyft-to-make-traveling-more-accessible-for-the-blind-and-low-vision-ce7f9f7c7ac8), [Smart Cities Dive](https://www.smartcitiesdive.com/news/lyft-aira-partnership-increase-accessibility-blind-riders/513657/)). (b) Waymo: "Find my car" with turn-by-turn visual+audio+haptic cues, plus rider-triggered "Play melody" / "Honk the horn" ([Waymo Help](https://support.google.com/waymo/answer/9566824?hl=en)).
- **EVIDENCE**: Waymo's features were co-designed with blind organizations (Texas School for the Blind, NFB engagement), recognized by USDOT ([Waymo](https://waymo.com/community/articles/waymos-accessibility-work-with-advocates-recognized-by-usdot/)), and blind-community reception is strongly positive ([SFist](https://sfist.com/2025/01/02/turns-out-blind-people-really-love-taking-trips-in-waymos-self-driving-robotaxis/)). Aira's model works but costs riders ~$89/mo — a price barrier Sakta's human dispatcher removes.
- **APPLICABILITY**: **Adapted — this is Sakta's cheapest genuine differentiator.** The dispatcher *is* a free Aira agent: a "Call dispatch" affordance inside the active-ride screen, and a driver-side protocol flag ("rider is blind — get out, announce company + rider name") set at booking. A rider-triggered "ask driver to honk / announce" button is a Socket.IO event plus a driver-app prompt — near-zero cost, directly addresses the top documented failure. No hardware.

### 1.4 react-native-web accessibility vs native RN
- **WHAT**: RN's accessibility props map to native iOS/Android accessibility APIs and are mature; react-native-web re-derives ARIA from RN props and has documented gaps.
- **WHO/EVIDENCE**: RN docs ([reactnative.dev/docs/accessibility](https://reactnative.dev/docs/accessibility)); react-native-web issue tracker: `accessibilityState={{checked}}` fails to render `aria-checked` on Pressable ([issue #2403](https://github.com/necolas/react-native-web/issues/2403)); `aria-labelledby`/`aria-describedby` need DOM-id plumbing RN's model doesn't natively express ([issue #1116](https://github.com/necolas/react-native-web/issues/1116)); no automatic focus management on screen transitions in either environment, but on web there is no screen-reader-focus convention handled for you by a navigator ([RNW docs](https://necolas.github.io/react-native-web/docs/accessibility/)). RN native side has its own known gap: focus does not reset to the first element on new screens — must be managed manually with `AccessibilityInfo`/focus refs ([oneuptime guide](https://oneuptime.com/blog/post/2026-01-15-react-native-screen-reader-support/view)).
- **APPLICABILITY**: **Yes — decisive input to the PWA question** (verdict at end). Screen-reader-first on RN-web means owning ARIA-mapping bugs in a translation layer; on native RN it means disciplined use of first-class, well-trodden APIs.

---

## 2. Ride tracking without opening the app

### 2.1 iOS Live Activities — shipped, with measured funnel impact
- **WHAT**: Lock-screen/Dynamic Island live card: ETA, trip stage, plate, driver, progress bar.
- **WHO**: Uber, worldwide rollout Feb 2023 ([MacRumors](https://www.macrumors.com/2023/02/22/uber-live-activities-support-worldwide/), [Engadget](https://www.engadget.com/uber-ride-tracker-iphone-lock-screen-060908235.html)); Lyft shipped its own, designed WCAG-AA and VoiceOver-optimized ([Lyft Design+](https://design.lyft.com/that-little-island-changes-everything-b89b108f45b4)).
- **EVIDENCE — the strongest quantified finding in this report**: Uber's engineering blog reports **2.26% reduction in driver cancellations at pickup, 2.13% reduction in rider cancellations, 1.06% fewer pickup defects per request** attributable to Live Activities; implementation moved from app-driven to push-driven updates after betas showed gaps ([Uber engineering](https://www.uber.com/us/en/blog/live-activity-on-ios/)). The plate number on the lock screen is also an incidental accessibility/identification win.
- **APPLICABILITY**: **Adapted, phase 2.** Expo needs a native widget extension — feasible via `react-native-widget-extension`, `@bacons/apple-targets`, or `expo-widgets` config plugins, with SwiftUI for the widget and push-to-update ([guide](https://christopher.engineering/en/blog/live-activity-with-react-native/), [GitHub](https://github.com/bndkt/react-native-widget-extension)). Real but nonzero solo-dev cost; not pilot-blocking.

### 2.2 Android — ordinary ongoing notifications now standardized as "Live Updates"
- **WHAT**: Android 16 (stable June 2025; full support in QPR1) adds a first-class Live Updates notification class with progress template for rideshare/delivery; before that, apps shipped custom ongoing notifications for years.
- **WHO/EVIDENCE**: [Android Developers](https://developer.android.com/develop/ui/views/notifications/live-update), [Android Authority](https://www.androidauthority.com/android-16-qpr1-live-updates-3573399/).
- **APPLICABILITY**: **Yes, pilot-ready.** A plain FCM-driven ongoing notification (ETA + plate + status) works on every Android version today and is cheap. Adopt the Live Updates template opportunistically. Note for Rīga: Android share is high in Latvia, so this is the higher-value platform anyway.

### 2.3 Web push / PWA reality in 2025–26
- **WHAT**: iOS web push exists since 16.4 but **only** for PWAs installed via Safari Share → Add to Home Screen; permission must be requested from a user gesture; no silent pushes; Safari 18.4 added Declarative Web Push ([Brainhub state-of-PWA-on-iOS](https://brainhub.eu/library/pwa-on-ios), [MagicBell guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)). In the EU, Apple's Feb 2024 plan to kill home-screen web apps under DMA was reversed on March 1, 2024 — they remain WebKit-based with the pre-existing capabilities ([TechCrunch](https://techcrunch.com/2024/03/01/apple-reverses-decision-about-blocking-web-apps-on-iphones-in-the-eu/), [9to5Mac](https://9to5mac.com/2024/03/01/apple-home-screen-web-apps-ios-17-eu/)) — but the episode shows this surface exists at Apple's pleasure. No web equivalent of Live Activities; no background geolocation.
- **PWA ride-hailing case studies**: The canonical one is **m.uber (2017)**: 50kB core bundle, ~3s load on 2G, Preact ([Uber engineering](https://www.uber.com/blog/m-uber/) — note: the official post has **no adoption metrics**; the widely-quoted "150% engagement / 500k homescreen installs" figures appear only in third-party PWA-vendor blogs like [Tigren](https://www.tigren.com/blog/uber-pwa/) — treat as unverified marketing). Uber still operates no-app web booking at [uber.com/go](https://www.uber.com/us/en/ride/how-it-works/request-an-uber-ride-without-the-app/), and Careem offers web booking at careem.com ([Careem help](https://help.careem.com/hc/en-us/articles/360001583568-How-to-book-a-ride-from-the-web-)) — but notably, **no major operator has moved its primary rider experience to PWA in 2022–2026**; the trend went the other way (Live Activities, deeper native OS integration). Uber's newest no-app investment is physical **kiosks** (LaGuardia, Dec 2025, printed receipt) ([Engadget](https://www.engadget.com/transportation/uber-is-installing-kiosks-for-booking-rides-without-the-mobile-app-220904106.html)) — no-app demand is real, but nobody is betting on installed PWAs to serve it.
- **APPLICABILITY**: See verdict at the end. Short version: PWA as the *app* is weak; a plain web page as the *tracking link* is excellent.

---

## 3. Phone/dispatcher-hybrid booking

### 3.1 Uber's own phone line — the exact pattern Sakta needs
- **WHAT**: 1-833-USE-UBER: live agent books the ride; rider needs only a phone that receives SMS. Rider gets a **text with driver name, photo link, plate, and ETA, then a follow-up text on arrival**.
- **WHO/EVIDENCE**: Uber, US-wide, aimed at seniors ([uber.com/ride/call-to-ride](https://www.uber.com/us/en/ride/call-to-ride), [AARP coverage](https://www.aarp.org/personal-technology/dial-uber-ride/)). Uber keeping and expanding this since 2021, plus the 2025 kiosk rollout, is revealed-preference evidence that no-app booking has durable demand even for the biggest app on earth.
- **APPLICABILITY**: **Yes, verbatim.** Phone booking → dispatcher creates ride in the same backend → SMS to rider with driver/plate/ETA → arrival SMS. This makes phone-booked rides first-class citizens of the same ride state machine, which Sakta's architecture already supports.

### 3.2 GoGoGrandparent — a whole business built on the phone-to-app bridge
- **WHAT**: 24/7 operators book Uber/Lyft for people without smartphones; touchtone shortcuts for repeat orders; family members can book and monitor remotely; concierge fee $0.27/min of ride.
- **WHO/EVIDENCE**: [GoGoGrandparent](https://www.gogograndparent.com/about/how-we-work); operating profitably since 2016 — the existence proof that people pay a *premium* for human-mediated booking ([their own positioning research](https://www.gogograndparent.com/blog/older-adults-use-ride-services-without-smartphones)).
- **APPLICABILITY**: **Yes conceptually.** Sakta gets this for free — the dispatcher is in-house, not a reseller markup. Copy the touchtone-free part: dispatcher sees caller ID → rider profile → saved addresses → one-question booking ("Home again, Anna kundze?"). Also copy "family books for rider" as a dispatch-console capability, not an app feature.

### 3.3 SMS live-tracking links — commodity tech in the taxi-dispatch industry
- **WHAT**: Booking-confirmed / dispatched / arrived SMS with a link to a live web map; standard in white-label dispatch stacks.
- **WHO/EVIDENCE**: Autocab "Automatic Text Back" + SMS tracking ([Autocab](https://www.autocab.com/solution/passenger-app)); TaxiCaller SMS with live-map link ([TaxiCaller](https://www.taxicaller.com/en/features/online-office)); iCabbi WebBooker for no-app web booking feeding the same dispatch ([iCabbi](https://icabbi.com/products/web-booker/)). Uber's share-trip recipient page proves the no-login live-map web view pattern at scale ([Uber](https://www.uber.com/us/en/ride/how-it-works/share-status/)).
- **APPLICABILITY**: **Yes — the single highest fit-per-euro item in this report.** One public, token-URL web page (plate, driver name, live position, ETA, dispatcher phone number) serves: phone-booked riders, app riders' families (share-trip), and blind riders' sighted assistants. Watch SMS volume against the €100/mo guardrail — send booking-confirm + arrival SMS by default, link SMS only for phone bookings.

---

## 4. Scheduled-ride reliability UX

### 4.1 What makes users trust a future pickup: a named, compensated promise
- **WHAT**: Uber Reserve: driver assigned in advance ("your ride is confirmed once you receive your driver details"), driver arrives 5 min early, on-time guarantee backed by up to $50 Uber Cash (reservations ≥2h ahead, max 3 credits/30 days) ([Uber Reserve](https://www.uber.com/us/en/ride/how-it-works/reserve/), [Uber Help](https://help.uber.com/riders/article/what-is-uber-reserve?nodeId=ccb9a8da-9e44-4038-921f-0360bbabc518)). Lyft's On-Time Pickup Promise: within 10 min of scheduled time or automatic credits — $15 if late, $50 if never matched, up to $50 more for alternate transport; launched as a holiday promo, made permanent ([Lyft](https://www.lyft.com/rider/scheduled-rides/on-time-pickup-promise), [TimeOut](https://www.timeout.com/usa/news/lyft-now-guarantees-on-time-pickup-for-airport-ridesor-theyll-pay-you-110923)).
- **EVIDENCE**: Both companies converged on the same mechanism (automatic compensation, not apology) and kept it — Lyft promoted it from promo to permanent, and Uber execs cite Reserve as a growth product in earnings calls ([Q4 2024 transcript](https://seekingalpha.com/article/4755114-uber-technologies-inc-uber-q4-2024-earnings-call-transcript)). The trust ingredients across both: (1) early driver assignment shown to the rider, (2) driver arrives early by contract, (3) automatic, pre-stated compensation.
- **CONTRAST — the local weakness**: Bolt's scheduled rides are explicitly *not* guaranteed: if no driver accepts, the rider merely gets a cancellation SMS ([Bolt Support](https://bolt.eu/en/support/articles/7392556548114/), [driver-side rules](https://bolt.eu/en/support/articles/7769413257746/)). This is precisely the "scheduled rides that actually show up" gap in Sakta's pitch.
- **APPLICABILITY**: **Yes, adapted.** With 10 known drivers, Sakta can do what Bolt structurally can't: dispatcher-confirmed assignment the evening before, rider notified "Jānis, LX-1234, will be there 07:55" — and a modest automatic credit (integer cents, platform_config) if late. The *communication pattern* (named driver early + stated compensation) is the product; the guarantee fund at pilot scale is pocket money.

---

## 5. Simplicity for elderly/low-tech riders

### 5.1 Uber Senior Accounts + Simple Mode
- **WHAT**: June 4, 2025 nationwide US launch (plus FR, PT, MX, CL, BR, ZA, HK, TW): bigger text/icons, fewer buttons, saved go-to places, fewer steps; Senior Accounts add family-managed booking/payment/monitoring via Family Profiles ([Uber IR press release](https://investor.uber.com/news-events/news/press-release-details/2025/Uber-Launches-Senior-Accounts-and-Simple-Mode-Nationwide/), [Fast Company](https://www.fastcompany.com/91346140/ubers-new-senior-mode-aims-to-remove-barriers-for-aging-riders)).
- **EVIDENCE**: Too new for published adoption numbers. The design signal is still strong: Uber's own research concluded the barrier was cognitive load and family trust, not price.
- **APPLICABILITY**: **Adapted.** Sakta should not build a "mode" — build the simple version as the only version (big type via the semantic theme, saved places, minimal steps — this also serves the friction-audit rule), and route the truly low-tech to the phone line. "Family orders for the rider" belongs in the dispatch console.

### 5.2 DiDi elderly mode + hotline — the documented pioneer
- **WHAT**: Jan 2021: "one-click" large-font mini-app with up to 10 pre-saved addresses (registered with family/community help), plus a national phone hotline for taxi calls; folded into the main app mid-2021 ([Yicai](https://www.yicaiglobal.com/news/didi-chuxing-launches-one-click-car-hailing-app-phone-hotline-for-the-elderly), [EqualOcean](https://equalocean.com/briefing/20210603230050974)).
- **EVIDENCE**: Driven by Chinese government pressure on digital exclusion; no public per-feature usage metrics found. The durable design insight: **pre-saved addresses + one action** is the floor for elderly UX, and the hotline is a peer channel, not a fallback.
- **APPLICABILITY**: **Yes.** The saved-address + one-tap rebook pattern is trivially cheap and doubles as the screen-reader-optimal flow (1.2). This is one build serving two named user groups.

---

## 6. Trust/safety patterns cheap enough for a pilot

### 6.1 PIN pickup verification
- **WHAT**: Opt-in 4-digit PIN; rider speaks it, driver must enter it to start the trip; 5 attempts; all-trips or night-only setting.
- **WHO/EVIDENCE**: Uber, rolled out after the 2019 Samantha Josephson murder (fake-driver pickup) ([Uber blog](https://www.uber.com/pl/en/blog/pin-number/), [CBS](https://www.cbsnews.com/amp/philadelphia/news/uber-new-safety-feature-aftermath-samantha-josephson-murder)). No public efficacy stats, but it structurally prevents wrong-car starts, and — noteworthy for Sakta — it is a fully **non-visual** verification handshake, praised in accessibility write-ups for exactly that.
- **APPLICABILITY**: **Yes.** Cheap: PIN on the ride record, driver app gates the `arrive → in_progress` transition on PIN entry (fits `assertTransition()`), works identically for phone-booked rides read aloud by the dispatcher.

### 6.2 Driver photo/plate prominence + share-trip link
- **WHAT**: Plate and driver identity surfaced at every stage (in-app, lock screen, SMS); share-trip sends up to 5 contacts a no-app live web view of driver name, plate, position ([Uber](https://www.uber.com/us/en/ride/how-it-works/share-status/)).
- **EVIDENCE**: Industry-universal (Uber, Lyft, Bolt); Uber's Live Activity deliberately promotes plate to the lock screen ([Uber engineering](https://www.uber.com/us/en/blog/live-activity-on-ios/)).
- **APPLICABILITY**: **Yes.** The share-trip recipient page and the SMS tracking page from 3.3 are the same artifact — build once.

---

## 7. Cash + card in one flow

- **WHAT**: Bolt (EE and Sakta's direct competitor) runs cash and card side by side in most markets; payment method is selectable per-ride from a visible payment row, but **cannot be changed after the trip request is accepted** ([Bolt Support](https://bolt.eu/en/support/articles/115002917734/)); paying cash on an in-app-payment trip is treated as an incident ([Bolt Support](https://bolt.eu/en/support/articles/6084040505618/)). inDrive added card payments in South Africa in 2025–26 while explicitly keeping cash, positioning both as permanent equals ([Sowetan](https://www.sowetan.co.za/s-mag/2026-06-05-cash-or-card-indrive-expands-payment-options-to-make-hailing-a-ride-even-easier/)).
- **EVIDENCE**: In cash-heavy markets cash is 30–45% of ride-hailing transactions ([PayAtlas](https://payatlas.com/industry/ride-hailing-4942)); inDrive's "add card, never remove cash" is the shipped consensus. UX pattern across both: payment method is a single visible chip on the confirm screen, switchable freely *before* request, frozen after acceptance — pricing shown is identical for both methods, avoiding the distrust created when cash and card prices diverge.
- **APPLICABILITY**: **Yes — and validating.** Bolt's freeze-after-acceptance is exactly Sakta's `isPaymentMethodLocked()` rule; the research confirms the industry converged on the same seam. The one addition worth copying from Bolt's support-ticket patterns: make the *driver* app show the payment method unmissably at accept-time, since cash/card confusion at drop-off is their top payment complaint.

---

## Top-10 shortlist (ranked by evidence × Sakta fit)

| # | Finding | Evidence strength | Fit / cost |
|---|---|---|---|
| 1 | **SMS status texts + no-login live web tracking link** for every ride, incl. phone bookings (Uber call-to-ride, Autocab/TaxiCaller, Uber share-trip) | Industry-standard, shipped everywhere | Perfect; one web page + SMS budget |
| 2 | **Named-driver-early + automatic-compensation scheduled rides** (Uber Reserve / Lyft promise; Bolt's documented non-guarantee is the gap) | Two majors converged and kept it | Perfect; dispatcher assignment + small credit |
| 3 | **PIN verification gating trip start** (Uber) | Shipped globally; non-visual by design | Trivial; fits state machine |
| 4 | **Text-first, saved-address, one-tap booking** as the only flow (DiDi elderly mode, Uber Simple Mode, AFB/AppleVis map-pin findings) | Strong qualitative convergence | Perfect; serves blind + elderly with one build |
| 5 | **Dispatcher-as-Aira**: human pickup assistance for blind riders (Lyft×Aira, 2025 remote-support study) | Shipped (paid); study-backed need | Sakta uniquely gets it free |
| 6 | **Ongoing-ride notification on Android** (custom now, Live Updates template later) | Uber's measured cancellation reductions transfer | Cheap; Android-heavy market |
| 7 | **Driver-arrival protocol for blind riders**: announce-yourself prompt + honk-on-request (Waymo honk/melody, USDOT-recognized; vehicle-ID named top gap in all research) | Shipped by Waymo; strong community reception | Cheap adaptation via driver app event |
| 8 | **iOS Live Activity for ride ETA** (Uber: −2.26% driver cancels, −2.13% rider cancels) | Best quantified evidence in the space | Adapted, phase 2 (Expo config-plugin + Swift widget) |
| 9 | **Share-trip link to family** (Uber, up to 5 contacts, no app needed) | Universal; reuses item #1's page | Near-free |
| 10 | **Cash+card equal citizens, frozen at acceptance, one price** (Bolt, inDrive) | Shipped consensus in EE/Africa | Already in Sakta's rules; add driver-side payment prominence |

## Verdict: PWA-first vs native-first for the rider pilot

**Native-first (Expo → TestFlight/APK), with a deliberately boring server-rendered web page as the companion surface — not react-native-web of the app.** Three findings force this. First, the tracking problem: the pilot's core promise ("your taxi will actually come") lives in the minutes between booking and pickup, and on iOS a PWA can only push to riders who have performed the Share → Add to Home Screen ritual on iOS 16.4+ — a step Sakta's priority users (blind, elderly, phone-first) are the least likely to complete — while native gets FCM/APNs, ongoing Android notifications, and eventually the Live Activity whose measured effect is precisely fewer pickup failures; the EU DMA episode of Feb 2024, though reversed, showed this surface can be revoked by Apple unilaterally. Second, the accessibility requirement: screen-reader-first on RN-web means inheriting a translation layer with open ARIA bugs (aria-checked not rendered, id-based label relationships unsupported, hand-rolled focus management) on the least-audited path, whereas native RN maps to VoiceOver/TalkBack directly and every published blind-community endorsement of ride-hailing is of native apps. Third, the m.uber lesson cuts the other way than PWA advocates claim: its verified value was *no-install reach on bad networks* — and Sakta already has a superior no-install channel in the dispatcher phone line plus SMS live-tracking links, which need no push, no install, and no app store. So: rider app native via Expo; the web gets (a) the token-URL live tracking page and (b) optionally an iCabbi-WebBooker-style plain booking form. That combination captures everything a PWA would offer, without betting the launch differentiator (screen-reader excellence) on react-native-web.

## Hype to avoid

- **Hardware beacons** (Uber Beacon, Lyft Amp): both effectively dead programs; Uber's software-only Spotlight (colored phone screen) achieved the same and is itself useless to blind riders. Solve arrival-ID procedurally (item 7), not with LEDs.
- **Third-party PWA case-study numbers**: the "m.uber 150% engagement" figures circulate only in PWA-vendor marketing blogs; Uber's own post contains no such metrics. Do not cite them into the architecture doc.
- **Voice-assistant booking** (Alexa/Google Home ride skills): quietly discontinued by both Uber and Lyft; the phone line beat them.
- **Kiosks**: interesting Uber signal about no-app demand, absurd at pilot scale.
- **A separate "senior app" SKU**: DiDi folded its standalone elderly app back into the main app within months; Uber shipped a *setting*. Build simple once.
- **AR/haptic wayfinding to the car** as an app feature: research-grade (Waymo's works because they control the vehicle); for a human-driver fleet the driver and dispatcher are the wayfinding system.
