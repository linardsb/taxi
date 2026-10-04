# GDPR and platform-law obligations: Sakta Cab

**Status:** research, not legal advice. Written 2026-10-04 for Linards, Atis and whichever lawyer reviews it.
**Scope:** rider app, driver app with background GPS, web dispatch console, phone bookings, SMS tracking links, admin panel.
**Code state cited:** `observed` at `658d052` (main, 2026-10-04).

Throughout this document, **"Source says"** means the cited text says it, quoted or closely paraphrased. **"Interpretation"** means this document's own reading, which a lawyer has to confirm. Every period below is either a statutory figure with its article number or is marked `expected/assumption`. Where no period was found, none is given.

---

## 0. Six findings that change what gets built

1. **Latvian platform law forbids deleting or correcting ride, driver and vehicle records, and sets a retention floor of at least five years with no ceiling.** Source says: Autopārvadājumu likums (APL) Art. 35.² (5)–(6). Erasure under GDPR Art. 17 therefore yields to Art. 17(3)(b) for those records. Rectification under Art. 16 runs into the same "do not correct" wording. Corrections must be **appended as new records, not made by mutation**. See P5–P7.
2. **The VID data set contains no rider identity and no GPS trace.** Source says: MK noteikumi Nr. 541 p.11 lists the carrier, the driver's personas kods, the plate, start and end times, km, fare, commission and payment type. Interpretation: this is the lever for pseudonymising a rider who asks for erasure. Whether the rider link and the pickup/drop-off addresses also fall under APL 35.² (5)'s "informācija par … pakalpojumiem" is the **first lawyer question** (Q1).
3. **A DPIA is mandatory and is not a judgement call.** Source says: DVI's Art. 35(4) list, item 9 ("atrašanās vietas datu izmantošana, kopā ar vismaz vienu no Kritērijiem") together with criterion 3 (systematic monitoring), and item 8 ("plaša mēroga … izsekošana, tostarp … loģistikas uzņēmumi"). From 2 December 2026 the Platform Work Directive Art. 8(1) also deems algorithmic management high risk.
4. **No collecting driver location while they are offline.** Source says: Directive (EU) 2024/2831 Art. 7(1)(c), applying to all persons performing platform work, employees or not (Art. 1(2)). The Italian Garante fined Foodinho EUR 5m in 2024 partly for doing exactly this (secondary sources only). The current code already follows the rule (see P9).
5. **Any decision to suspend or terminate a driver's account must be taken by a human.** Source says: PWD Art. 10(5). On 21 August 2026 the Dutch AP fined Uber EUR 824.99m for automated driver deactivation under GDPR Art. 22; Uber is appealing. This is relevant to #20 (admin approval) and to any future auto-suspend.
6. **"As long as necessary" is not a retention statement.** Source says: AP's EUR 10m Uber decision of 31 January 2024, under Art. 13(2)(a); Uber's objection was rejected in May 2026 and a court appeal is pending. Every data category in the privacy notice needs a concrete period or a concrete criterion, so §4 feeds the notice directly.

---

## 1. Sources

Primary sources unless marked *secondary*. "Fetched" means the text was read during this research on 2026-10-04.

| # | Source | URL | Used for |
|---|---|---|---|
| S1 | GDPR, Regulation (EU) 2016/679 | https://eur-lex.europa.eu/eli/reg/2016/679/oj | Arts. 5, 6, 9, 12–22, 25, 26, 28, 30, 32–35, 37, 44–49. EUR-Lex blocked automated fetches, so the OJ text was fetched from http://publications.europa.eu/resource/celex/32016R0679 and the quoted phrases from Arts. 17(3)(b), 25(2), 29/32(4), 30(5), 32(1)(b) and 37(1)(b) were grep-checked against it. Recital 85 holds the 72-hour wording; Art. 33(1) itself was not separately grepped |
| S2 | Autopārvadājumu likums (APL), consolidated to 24.04.2024 | https://likumi.lv/ta/id/36720-autoparvadajumu-likums | Art. 1 p.32¹–32² (definitions), Art. 35.² (platform duties), Art. 39(5⁴) (per-km / per-minute tariff), Art. 40(14). Fetched. |
| S3 | MK noteikumi Nr. 541 (19.11.2019), "Noteikumi par tīmekļvietņu vai mobilo lietotņu pakalpojuma sniedzējiem pasažieru komercpārvadājumos ar taksometru un vieglo automobili", amended by MK Nr. 313 (18.05.2021) | https://likumi.lv/ta/id/310793 | p.2.1, 6 (storage location declared to ATD), 7.4–7.5, 10, 11–12 (VID real-time report). Fetched. |
| S4 | Fizisko personu datu apstrādes likums (FPDAL) | https://likumi.lv/ta/id/300099 | Arts. 17, 25(1), 26(2), 27(3), 33, 37. Fetched. |
| S5 | Grāmatvedības likums | https://likumi.lv/ta/id/324249 | Art. 28 (retention of accounting documents). Fetched. |
| S6 | DVI, list of processing requiring a DPIA (Art. 35(4)), Rīkojums Nr. 1-2.1/125, 18.12.2018; the copy on the NIDA page updated 11.02.2026 is textually identical (`observed`: pdftotext diff) | https://www.dvi.gov.lv/lv/media/3645/download (landing page https://www.dvi.gov.lv/lv/novertejums-par-ietekmi-uz-datu-aizsardzibu-nida) | criteria 1–9; mandatory cases 5, 7, 8, 9, 11 |
| S7 | DVI, list of processing **not** requiring a DPIA (Art. 35(5)) | https://www.dvi.gov.lv/lv/media/3666/download | items 1 and 4, which exclude systematic monitoring, so neither exempts us |
| S8 | DVI pages: breach notification / DPO appointment / transfers outside the EU | https://www.dvi.gov.lv/lv/pdap · https://www.dvi.gov.lv/lv/pazinojums-par-das-iecelsanu · https://www.dvi.gov.lv/lv/datu-nodosana-arpus-es-un-eez | procedure links (link targets read from the DVI menu, page bodies not read) |
| S9 | EDPB Guidelines 01/2020 on connected vehicles and mobility-related applications, v2.0 (adopted 9 March 2021) | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-012020-processing-personal-data-context_en | paras 28, 32–33 (scope), 63–64 (location data), 113 (retention: raw vs aggregated). Fetched. |
| S10 | EDPB summary "Connected vehicles & mobility data: when to act and what to do", May 2026 | https://www.edpb.europa.eu/system/files/2026-05/edpb-summary-connected-vehicles-mobility-data_en.pdf | "do not collect it continuously by default"; "conduct a DPIA early". Fetched. |
| S11 | Directive (EU) 2024/2831 on platform work (OJ L 11.11.2024) | http://publications.europa.eu/resource/celex/32024L2831 | Arts. 1(2), 2(1), 7, 8, 9, 10, 11(5), 15, 29; recital 49 (business users). Fetched. |
| S12 | Dutch AP, Uber EUR 290m (26.08.2024), transfers of drivers' data to the US | https://www.autoriteitpersoonsgegevens.nl/en/current/dutch-dpa-imposes-a-fine-of-290-million-euro-on-uber-because-of-transfers-of-drivers-data-to-the-us | Chapter V; under objection. Fetched. |
| S13 | Dutch AP, Uber EUR 10m (31.01.2024), retention periods and access-request obstacles | https://www.autoriteitpersoonsgegevens.nl/en/current/uber-fined-eu10-million-for-infringement-of-privacy-regulations | Arts. 12, 13(2)(a), 15; objection rejected May 2026, court appeal pending. Fetched. |
| S14 | Dutch AP, Uber EUR 824.99m (21.08.2026), automated driver deactivation | https://www.autoriteitpersoonsgegevens.nl/en/current/uber-fined-nearly-825-million-euros-for-automated-driver-blocking | Art. 22, transparency; under appeal. Fetched. |
| S15 | Gerechtshof Amsterdam, 4.4.2023, Uber/Ola drivers (ECLI:NL:GHAMS:2023:793, :796, :804) | https://www.rechtspraak.nl/organisatie-en-contact/organisatie/gerechtshoven/gerechtshof-amsterdam/nieuws/2023/04/uber-en-ola-cabs-moeten-londense-taxichauffeurs-beter-informeren-over-automatische-besluiten | Art. 15(1)(h) access to ADM logic (search summary; judgment not read) |
| S16 | CJEU C-203/22 *Dun & Bradstreet Austria*, 27.02.2025 | https://curia.europa.eu/site/upload/docs/application/pdf/2025-02/cp250022en.pdf | Art. 15(1)(h): explain "the procedure and principles actually applied" (search summary of the press release) |
| S17 | Estonian AKI, Bolt passenger ratings (order 2022, closed spring 2024) | https://www.aki.ee/uudised/bolt-taksoteenuse-raames-reisijate-hindamine | Art. 6(1)(b) rejected for ratings; legitimate interest required. Fetched. |
| S18 | *Secondary.* Garante, Foodinho/Glovo EUR 5m (Nov 2024): location tracked while offline, automated deactivation | https://unipd-centrodirittiumani.it/en/news/the-privacy-supervisor-sanctions-foodinho-for-personal-data-breaches · https://apps.eurofound.europa.eu/platformeconomydb/italy-privacy-authority-fines-foodinho-5-million-euro-for-rider-data-breaches-110198 | primary Garante decision not retrieved |
| S19 | WP29 / EDPB Guidelines on DPOs (WP243 rev.01) | https://ec.europa.eu/information_society/newsroom/image/document/2016-51/wp243_en_40855.pdf | "location tracking, for example, by mobile apps" as regular and systematic monitoring; large-scale factors (search summary) |
| S20 | Commission Implementing Decision (EU) 2023/1795 (EU-US DPF); General Court T-553/23 *Latombe*, 3.9.2025 (dismissed); appeal C-703/25 P pending | https://digitalpolicyalert.org/event/35459-latombe-filed-appeal-against-general-court-dismissal-of-challenge-to-european-unionunited-states-data-protection-framework-adequacy-decision-in-latombe-v-commission | US transfers (*secondary* tracker for the appeal) |
| S21 | Latvian transposition of 2024/2831: "Digitālo darba platformu likums" draft, public consultation 15–29 June 2026 (LM) | https://ifinanses.lv/zinas/actual-sagatavots-digitalo-darba-platformu-likums/31040 (*secondary*); LM page https://www.lm.gov.lv/lv/eiropas-parlamenta-un-padomes-2024-gada-23-oktobra-direktiva-20242831-par-darba-nosacijumu-uzlabosanu-platformu-darba | status only; draft text not read |
| S22 | Vendor statements: Stripe privacy centre (SPEL is a joint controller for some EEA processing); Expo "data and privacy protection" (push tokens processed, not stored; DPF-certified per Expo) | https://stripe.com/en-gb/legal/privacy-center · https://docs.expo.dev/regulatory-compliance/data-and-privacy-protection/ | *vendor self-description*, not verified against the DPF list |

**Not found:** no DVI decision on a taxi or ride-hailing platform, and no Estonian or Latvian decision on Bolt drivers' location data (searched, nothing surfaced). No regulator-accepted retention period for ride-hailing GPS traces was found in any source above.

---

## 2. Lawful basis per data category (question 1)

| Data category | Basis | Source says | Interpretation / caveat |
|---|---|---|---|
| Rider identity, phone (OTP login) | Art. 6(1)(b) | GDPR Art. 6(1)(b): necessary for a contract or pre-contract steps at the data subject's request | The phone is the account key and the driver's contact channel. |
| Rider email | 6(1)(b); possibly **6(1)(c)** | APL 35.² (1)(5)(c): for **vieglais automobilis** rides the app must email an e-invoice to "the passenger's e-mail address registered in the app" at the end of the ride | Applies only if Sakta rides are classed as vieglais automobilis rather than taxi (Q6). |
| Phone booking (caller) | 6(1)(b) | GDPR Art. 13 applies when data is collected from the data subject | Caller is told orally (short script plus a link in the confirmation SMS). |
| Phone or hotel booking **for someone else** (passenger) | 6(1)(f) or 6(1)(b) | GDPR Art. 14 (data not obtained from the data subject) | Passenger name and phone came from a third party, so Art. 14 notice is owed, e.g. in the tracking SMS. Art. 14(5)(b) exemption is unlikely to fit. |
| Ride records reported to VID (carrier, driver personas kods, plate, times, km, fare, commission, payment type) | **6(1)(c)** | APL 35.² (6); MK 541 p.11–12 (sent "nekavējoties pēc komercpārvadājuma beigām"); FPDAL 25(1) says the Art. 6(3) basis for legal-obligation processing is set by the sectoral law | Clean legal-obligation basis. The data set holds no rider fields. |
| Retaining ride / driver / vehicle records, including refused and accepted offers | **6(1)(c)** | APL 35.² (5) (no deleting or correcting), 35.² (6) (keep "vismaz piecus gadus", in an EU or NATO member state); MK 541 p.7.5 (carrier sees ≥5 years) | See §4 and Q1 for which fields count as such information. |
| Driver identity, licence, register number, vehicle | 6(1)(b) + 6(1)(c) | APL 35.² (4): platform may not register a driver or vehicle that fails Art. 35(1),(5),(8); MK 541 p.8.2–8.3 (show the rider driver name, register no., plate) | Showing driver name and plate to the rider is a legal duty, not a choice. |
| **Driver GPS while online** | 6(1)(b), alternatively 6(1)(f) | EDPB 01/2020 paras 63–64 (frequency and precision proportionate; location only when a function needs it). Para 33: commercial vehicles and shared transport are **out of scope** of those guidelines, though "many of the principles … will also be applicable" | Applied by analogy only. Consent is a poor fit given the imbalance (interpretation). Purpose is dispatch, ETA and the queue. |
| **Driver GPS while offline** | **none** | PWD Art. 7(1)(c): platforms shall not "collect any personal data of a person performing platform work while that person is not offering or performing platform work" (from transposition, deadline 2.12.2026); Garante/Foodinho (S18, secondary) | Prohibited outright, so no balancing applies. |
| In-ride trace (route during a paid ride) | 6(1)(b); 6(1)(f) for disputes and safety | APL 39(5⁴): fare is computed per km and per minute; MK 541 p.11.6 needs km only | Keep the raw trace only until fare and dispute are settled, then reduce it (EDPB para 113 by analogy). See R4. |
| Payment data (card) | Stripe holds it; Sakta holds the Stripe ids, amounts and payment method | Stripe privacy centre: SPEL / STC are joint controllers for some EEA processing (S22) | Art. 26 or Art. 28 split per Stripe's DPA (Q8). Amounts are accounting documents (S5 Art. 28). |
| Ledger, commission, payouts | 6(1)(c) | Grāmatvedības likums Art. 28(2), (5) | §4 R6. |
| Call recordings | **none today** | `observed`: `TelephonyProvider` seam is unbound at pilot ("NOTHING is bound at pilot", `packages/shared/src/seams/telephony-provider.ts`) | If added later: 6(1)(f), a notice at the start of the call, and a DPIA update. DVI's no-DPIA item 1 example covers recording **employees'** calls only, not callers. |
| Ratings of riders, if ever added | 6(1)(f), **not** 6(1)(b) | AKI on Bolt (S17): ratings "cannot be treated as contract fulfilment"; legitimate-interest assessment required | Not built today. |
| SMS tracking link (public `t/[token]` page) | 6(1)(b) for the rider; 6(1)(f) for showing the driver's position and plate to the link holder | (none specific) | Token expiry and payload minimisation: P31, R10. |

---

## 3. Obligations

Type: **E** = engineering (code, config, infrastructure) · **L** = legal document or process · **E+L** = both.

| ID | Obligation | Source (URL in §1) | Applies to | Type |
|---|---|---|---|---|
| P1 | Register with ATD in the Autopārvadātāju informatīvā datu bāze before operating; the application declares **where trip, driver and vehicle data are processed and stored**; changes to that information must be filed within **5 working days** | S2 APL 35.² (1); S3 MK 541 p.2.1, p.6 | hosting location (Hetzner region, R2 bucket) | L (+E: any move of the DB or backups is a filing) |
| P2 | Send each ride to VID immediately after it ends, in VID's published structure: carrier reg. no., driver personas kods (or VID taxpayer code), plate, start/end date-time, km, fare, commission, payment type | S3 MK 541 p.11–12; S2 APL 35.² (6) | ride records, driver ID number | E |
| P3 | Give VID electronic access to stored data within **10 working days** of a request, **including encryption keys** where the data is encrypted | S3 MK 541 p.10 | DB and **encrypted R2 backups** | E+L (key escrow procedure) |
| P4 | Store trip, driver and vehicle information in an **EU or NATO member state** for at least 5 years | S2 APL 35.² (6) | primary DB, backups | E (Hetzner DE/FI qualifies; R2 bucket location must be pinned) |
| P5 | **Do not delete or correct** information about accepted, refused and completed rides, drivers and vehicles | S2 APL 35.² (5) | `rides`, `ride_offers`, driver and vehicle tables, audit log | E: append-only corrections; no hard delete; erasure means pseudonymisation of fields outside the protected set (Q1) |
| P6 | Erasure requests: Art. 17(3)(b) exempts processing "for compliance with a legal obligation"; the rest is still erased | S1 Art. 17(1), 17(3)(b); S2 APL 35.² (5)–(6) | rider account, rider PII on rides | E: an erasure job that nulls or pseudonymises rider name/phone/email, push tokens and saved places, and keeps the VID set; L: the response letter cites 17(3)(b) |
| P7 | Rectification requests (Art. 16) collide with "nelabot" (do not correct) | S1 Art. 16; S2 APL 35.² (5) | ride, driver and vehicle records | E: corrections recorded as new rows referencing the original; Q2 |
| P8 | Data minimisation and storage limitation: only fields needed per purpose; keep for no longer than the purpose | S1 Art. 5(1)(c), (e); Art. 25 | all | E |
| P9 | Driver location collected **only while online**; no collection when not offering or performing work | S11 PWD Art. 7(1)(c), 7(2)–(3); S9 paras 63–64 (analogy); S18 | driver GPS | E. `observed`: server Lua drops a write unless the driver is in the online set (`services/api/src/features/drivers/location/redis-driver-location.store.ts:103`); app stops the location task on the offline effect and on sign-out (`apps/driver/src/features/availability/use-presence.tsx:154,311`) |
| P10 | Location frequency and precision proportionate to purpose | S9 para 64 ("adequate configuration of the frequency of access to, and of the level of detail of, location data") | driver GPS | E. `observed`: the cross-platform cadence is the client throttle `MIN_FIX_INTERVAL_MS = 4_000`, i.e. at most one fix per 4 s (`apps/driver/src/features/location/fix-throttle.ts:9`); separately, Android's OS request floor is `timeInterval: 4000` with `distanceInterval: 0`, so a parked driver still reports (`location-options.ts:19-20`). Both are ceilings on frequency, not the observed rate in the field. The DPIA must justify 4 s |
| P11 | A visible indicator while location is active | S10 ("clear dashboard icons … when location tracking is active"); S18 (Garante ordered a visible signal on the device) | driver app | E (Android's foreground-service notification likely satisfies it; confirm wording) |
| P12 | **DPIA before go-live**, with drivers' views sought | S1 Art. 35(1), (4); S6 items 7, 8, 9 + criterion 3; S11 PWD Art. 8(1)–(2) | GPS, dispatch, ADM | L |
| P13 | Records of processing (ROPA) | S1 Art. 30. The under-250-staff exemption in Art. 30(5) does not apply when processing "is not occasional" or is likely to pose a risk, and both hold here (interpretation) | all | L (DVI offers a register tool: https://www.dvi.gov.lv/lv/riks-datu-apstrades-registra-un-risku-analizei) |
| P14 | Art. 28 contracts with every processor; transfer mechanism for non-EEA ones | S1 Art. 28(3), 44–46; S12 (Uber: EUR 290m for US transfers without a tool); S20 (DPF valid, appeal pending) | see §5 processor list | L |
| P15 | Privacy notices: riders (Art. 13), drivers (Art. 13 + PWD Art. 9), passengers booked by third parties (Art. 14), phone callers (oral Art. 13) | S1 Arts. 12–14; S13 (retention periods must be concrete; name the non-EEA countries) | all | L (+E: in-app links in LV/RU/EN) |
| P16 | Driver access requests easy to find; output intelligible | S13 (form "located deep within the app and spread across various menus" was a breach) | driver data | E: a single "Download my data" entry in driver settings |
| P17 | Explain automated-decision logic on request: "the procedure and principles actually applied" | S1 Art. 15(1)(h), 22; S16; S15 | dispatch assignment, any auto-suspend | E. `observed`: `explainAssignment` in `packages/shared/src/dispatch-explanation.ts` already composes a per-assignment "why this driver" for both console and driver |
| P18 | **No solely automated suspension or deactivation**; a human decides; written reasons by the date it takes effect; review answered within **two weeks** | S11 PWD Art. 10(5), 11(1)–(2); S1 Art. 22; S14 (EUR 824.99m) | driver account status | E+L. Art. 11 does not apply to drivers who are P2B "business users" (PWD Art. 11(5), recital 49), Q9 |
| P19 | Security appropriate to risk: access control, encryption, logging, tested restore | S1 Art. 32(1)–(2), 32(4) (staff act only on instructions) | all, especially staff reads | E (detail in §3.1) |
| P20 | Breach: notify DVI within 72 h of awareness unless unlikely to result in risk; tell data subjects if high risk; keep an internal register of **all** breaches | S1 Art. 33(1), 33(5), 34; S8 DVI form | all | L (runbook + register) + E (alerting that makes "awareness" possible) |
| P21 | DPO decision documented; if appointed, notify DVI | S1 Art. 37(1)(b), 37(7); S19; S4 FPDAL 17 (any person meeting Art. 37(5), DVI list optional) | org | L (Q4) |
| P22 | Algorithmic transparency document for drivers: what is monitored, ADM decision categories, main parameters and their relative weight, grounds for suspension; on day one, before changes, and on request | S11 PWD Art. 9(1)–(3) | dispatch strategy, queue, offers | L (+E: parameters must match `dispatch-strategy` seam) |
| P23 | Human oversight review of ADM impact at least **every two years**; overseers can override | S11 PWD Art. 10(1)–(2) | dispatch | L + E (an override path exists: force-assign, `observed` `services/api/src/features/dispatch/force-assign.service.ts`) |
| P24 | Driver data portability, including ratings, free of charge, direct to a third party on request | S11 PWD Art. 9(6); S1 Art. 20 | driver ride history, any ratings | E |
| P25 | PWD Art. 7 bans: no emotional-state, private-conversation, or biometric 1:N identification processing | S11 PWD Art. 7(1)(a),(b),(f) | driver chat if added, any selfie check | E (constraint on future features) |
| P26 | Driver can see their last 3 months of rides in the app; carrier sees ≥5 years of its drivers' rides | S3 MK 541 p.7.4–7.5 | ride history | E |
| P27 | Rider sees driver name, register no., plate, tariffs, estimated fare, start/end times | S3 MK 541 p.8 | rider app, tracking page | E |
| P28 | Children: info-society consent age is 13 in Latvia | S4 FPDAL 33 | rider sign-up | L (Q10; rides are a contract, so consent may not be the basis) |
| P29 | Access requests: recipients disclosed for the **last two years** | S4 FPDAL 27(3) | DSAR output | E |
| P30 | Where an audit log is legally required, keep it **no longer than 1 year** unless law or the nature of processing says otherwise; no duty to keep logs just to answer a DSAR | S4 FPDAL 37(2), (4) | staff access logs | E (R8) |
| P31 | Public tracking link (`t/[token]`): unguessable token, dead after the ride, shows only what MK 541 p.8 requires the rider to see (driver name, plate) and the live position; no rider name or phone on the page; `noindex` | S1 Art. 5(1)(c), 25(2) ("not made accessible … to an indefinite number of natural persons"); S3 MK 541 p.8 | tracking page, SMS link | E |

### 3.1 Staff access and audit (question 5)

**Source says.** GDPR Art. 32(1)(b) requires ongoing confidentiality of processing systems and services. Art. 32(4) requires steps so that any person acting under the controller's authority "does not process them except on instructions". Art. 29 says the same. Art. 5(1)(f) requires integrity and confidentiality, and Art. 25(2) requires that by default data is not made accessible "to an indefinite number of natural persons". FPDAL 37 defines audit records as logs of access, entry, modification, deletion and transfer, and caps mandated audit logs at one year by default.

**Interpretation (what a regulator is likely to expect, not quoted).**
- Role-scoped reads. `observed`: roles are `rider | driver | dispatcher | admin` (`packages/shared/src/enums.ts:1`), and admin routes are `@Roles('admin')` (`packages/shared/src/schemas/admin-drivers.ts:13`). Dispatcher views should show only active and recent rides, not a rider-history search.
- A **read** audit for staff lookups of a person, recording actor, subject, time and reason. `observed`: `dispatch_audit_log` records assignments, not reads. The pickup-PIN read is already logged with the actor (`services/api/src/features/rides/lifecycle/pickup-pin-read.service.ts:39`), which is the pattern to extend.
- Named accounts with no shared dispatcher login, MFA on the admin and dispatch web app, and offboarding that revokes access the same day.
- A confidentiality undertaking signed by Dina and anyone else with console access (Art. 32(4)).
- Free-text fields (the dispatcher booking `note` lands in `dispatch_audit_log.payload`, `observed` `services/api/src/features/dispatch/bookings/bookings.service.ts:83-85`) are a minimisation risk: staff will type health or addresses there. Use a length cap and a UI hint at least.

---

## 4. Retention proposals with provenance (questions 2 and 3)

Provenance key: **statute** = a figure printed in the law (article cited) · **regulator** = a period a regulator or EDPB text states · **code** = `observed` behaviour at `658d052` · **expected/assumption** = this document's proposal with no source behind the number.

| R | Category | Proposal | Provenance |
|---|---|---|---|
| R1 | Ride, offer and refusal records; driver and vehicle per ride (the VID set plus refusals) | Keep **at least 5 years**; do not delete or correct. **No end date is set by the statute**, so the deletion date is a lawyer question (Q3) | **statute**: APL 35.² (5)–(6) "vismaz piecus gadus"; MK 541 p.7.5 |
| R2 | Rider identity fields on ride rows (name, phone, email, saved places) | On account erasure: pseudonymise (replace with a random id) and keep the VID set. Without an erasure request: keep while the account is active. **No period after inactivity** is proposed until Q1 is answered | Mechanism: **statute** (Art. 17(3)(b) covers only what APL protects). Period: **expected/assumption** |
| R3 | Driver's live position | Latest point only, overwritten each fix, removed on going offline; never persisted to Postgres | **code**: `GEOADD`/`ZREM` in `redis-driver-location.store.ts:77-91,103-105`. **Unverified:** prod Redis runs `redis:7-alpine` with no config override (`observed` `compose.prod.yml:27-29`), and Redis's built-in default may write RDB snapshots to disk. Check `CONFIG GET save` on the box; if on, either disable it or count snapshots in the DPIA |
| R4 | In-ride raw trace (if or when persisted for fare or disputes) | Keep raw points until the fare is final and the complaint window closes, then reduce to km, duration and pickup/drop-off. **No number is proposed**; it depends on the complaint window (Q5) | Principle: **regulator** (EDPB 01/2020 para 113: raw data "only as long as they are required to elaborate the aggregated data"; applied by analogy, para 33). Number: **expected/assumption** |
| R5 | Pickup and drop-off addresses on a ride | Same as R1 if Q1 says they are "informācija par … pakalpojumiem"; otherwise coarsen (e.g. to the zone) after the R4 window | **statute** (conditional) / **expected/assumption** |
| R6 | Invoices, payouts, commission postings (attaisnojuma dokumenti) | **≥5 years**, and longer while needed for transaction traceability; ledgers/registers **10 years** if the `ledger` tables count as grāmatvedības reģistri (accountant question, Q7) | **statute**: Grāmatvedības likums Art. 28(2), (5) |
| R7 | Stripe payment objects | Per Stripe's own retention as controller for its part; Sakta keeps ids and amounts under R6 | vendor (S22) |
| R8 | Staff read-audit log, security logs | **Up to 1 year** | **statute** default ceiling for mandated audit logs: FPDAL 37(2). Whether our log is "mandated" is interpretation |
| R9 | OTP codes | 5 minutes, then void | **code**: `OTP_TTL_SECONDS = 300` (`services/api/src/features/auth/otp.policy.ts:6`); whether the stored row is purged after expiry was not checked |
| R10 | Tracking-link token (`t/[token]`) | Dead when the ride ends plus a short grace; page shows nothing after | **expected/assumption** |
| R11 | Push tokens | Delete on sign-out and on a provider "not registered" error | **expected/assumption** |
| R12 | Driver onboarding documents (licence scans, ID) | While the contract runs; after that, register no. and identity stay under R1. Scans: **no period** proposed (Q3) | **statute** for the register fields (APL 35.² (5) "autovadītājiem"); scans **expected/assumption** |
| R13 | Encrypted R2 backups | Rolling window; an erased rider re-appears only if a backup is restored, so re-apply erasures after any restore. **Window length not proposed** | **expected/assumption**; P3 constrains key handling |
| R14 | Evidence held for GDPR-infringement claims | Note: FPDAL 26(2) gives data subjects **5 years** from the infringement (or from its end, if continuing) to sue. That is a limitation period, not a duty to retain | **statute** (FPDAL 26(2)); its use as a retention reason is interpretation |

**What no source gave:** a regulator-accepted retention period for ride-hailing GPS traces, for driver location history, or for rider accounts after inactivity. The AP's 2024 Uber decision (S13) requires a stated period or criterion for each category. It does not say what the period should be.

**Location-data specifics (question 3).**
- **Shift-only tracking:** P9 above. It is already enforced at both ends (code).
- **DPIA:** mandatory. Source says: S6 mandatory case 9 ("Datu subjekta atrašanās vietas datu izmantošana, kopā ar vismaz vienu no Kritērijiem"). Criterion 3 (systematic monitoring) and criterion 5 (scale: "datu apstrādes darbības ilgums vai pastāvīgums") are both met. Case 8 ("Plaša mēroga datu subjektu izsekošana, tostarp … loģistikas uzņēmumi") and case 7 ("Darbinieku novērošana") may also apply, depending on whether drivers are "darbinieki". The exemption list (S7) excludes any processing with "sistemātisku uzraudzību", so it does not help. DVI publishes Word templates for the DPIA and for the necessity check on the S6 landing page.
- **Transfers outside the EU:** see §5. The precedent is S12: Uber stored drivers' location data in the US with no transfer tool after dropping SCCs in August 2021, and was fined EUR 290m (under objection). Since late 2023 Uber relies on the DPF (S12). DPF validity was upheld by the General Court on 3.9.2025, but an appeal (C-703/25 P) is pending (S20). Treat DPF as valid today with a fallback (SCCs) written into each US vendor contract (interpretation).

---

## 5. Documents Atis and the lawyer must produce (question 4)

| D | Document | Why (source) | Owner |
|---|---|---|---|
| D1 | **DPIA** covering driver GPS, dispatch and queue logic, the public tracking link, phone bookings, and staff access; drivers' views recorded | S6 cases 7–9; S1 Art. 35; S11 PWD Art. 8 | Linards drafts the technical part, the lawyer signs off |
| D2 | **ROPA** (Art. 30(1) controller record) | S1 Art. 30 | Atis + Linards |
| D3 | **Rider privacy notice** (LV/RU/EN): controller identity, purposes and bases per §2, recipients **naming VID and the carrier**, non-EEA countries by name, retention **per category** (from §4), rights including Art. 17(3)(b) limits, DVI complaint route | S1 Art. 13; S13 | lawyer |
| D4 | **Driver privacy notice + algorithmic transparency statement**: what GPS collects and when, dispatch parameters and their relative weight, suspension grounds, human-review route (two-week answer) | S1 Arts. 13, 15(1)(h), 22; S11 PWD Arts. 9, 11 | lawyer + Linards (parameters) |
| D5 | **Phone-booking oral notice script** for Dina, plus the Art. 14 notice in the tracking or confirmation SMS for passengers booked by others | S1 Arts. 13, 14 | Atis + Dina |
| D6 | **Art. 28 DPAs** with each processor (list below) and a **transfer assessment** for each non-EEA one | S1 Arts. 28, 44–46; S12 | lawyer |
| D7 | **Carrier agreement** defining the platform–carrier data relationship (independent controllers, joint controllers, or processor), since carriers see ≥5 years of their drivers' rides | S3 MK 541 p.7.5; S1 Arts. 26, 28 | lawyer (Q8) |
| D8 | **Retention schedule** (from §4, once Q1–Q7 are answered), including the erasure procedure and the restore-then-re-erase rule | S1 Art. 5(1)(e); S13 | Linards + lawyer |
| D9 | **Breach response runbook + breach register**, with the DVI form link and the 72-hour clock | S1 Arts. 33–34; S8 | Linards |
| D10 | **DPO decision memo** (appoint or not, with reasoning); if appointed, the DVI notification | S1 Art. 37; S19; S8 | lawyer (Q4) |
| D11 | **Legitimate-interest assessments** for any 6(1)(f) use: driver location for disputes and safety, tracking link, any future rating | S17; S1 Art. 6(1)(f) | lawyer |
| D12 | **Staff confidentiality undertaking + access policy** (Dina, any admin) | S1 Arts. 29, 32(4) | Atis |
| D13 | **VID key-escrow procedure** for encrypted backups | S3 MK 541 p.10 | Linards |
| D14 | **ATD registration filing** with the storage location, plus a change-control step | S3 MK 541 p.2.1, 6 | Atis |

**Likely processors and recipients** (`observed` in code unless marked):

| Vendor | Role | Location | Basis for transfer | Evidence |
|---|---|---|---|---|
| Hetzner (DB, API host) | processor | Falkenstein (DE) or Helsinki (FI), EU | none needed | `docs/runbooks/hetzner-deploy.md:70` ("Location Falkenstein or Helsinki"); which one was chosen is the P1 filing |
| Cloudflare R2 (`sakta-backups`, WEUR location hint) | processor (encrypted backups) | US company; WEUR is a location hint, not a jurisdiction lock (interpretation) | DPF or SCCs; verify | project memory; runbook |
| Stripe (SPEL, Ireland), **not live at pilot** | processor **and** joint controller for parts of EEA processing | EEA entity; group transfers to US | Stripe DPA | S22; the runbook says leave `STRIPE_SECRET_KEY` empty for the cash-only pilot (`docs/runbooks/hetzner-deploy.md:246`) |
| SMS gateway: BulkGate (CZ) or BudgetSMS (NL) or Twilio (US); one is bound via `SMS_PROVIDER` | processor | EU for the first two; US for Twilio | Twilio needs DPF or SCCs | `services/api/src/features/auth/auth.module.ts:79` |
| Expo push service (650 Industries, US) → FCM (Google) / APNs (Apple) | processor (Expo says tokens are not stored, S22); Google and Apple are onward recipients | US | DPF per Expo's statement; verify on the DPF list | `PUSH_PROVIDER=expo` |
| Google Places (address autocomplete / geocoding) | processor or independent controller per Google Maps Platform terms (Q8) | US | DPF or SCCs | `services/api/src/features/geo/google-places.provider.ts` |
| OpenStreetMap tile servers (dispatch console and public tracking page load `tile.openstreetmap.org`) | recipient of viewer IP plus tile coordinates near the ride, under no contract | OSMF, location not verified | **open** (Q11) | `apps/dispatch/src/features/tracking/tracking-map.tsx:142` |
| OSRM | none: self-hosted on the compose network | — | — | `compose.prod.yml` |
| VID, ATD, the carrier | **recipients**, not processors | LV | 6(1)(c) | S2, S3 |

Not observed as live: Sentry (only a Jest transform pattern mentions it), Firebase SDK, Mapbox, any email service. Re-check before D6 is finalised. Verify each US vendor's DPF certification on the official list; this research did not.

---

## 6. Data subject rights for drivers (question 6)

**Source says.**
- PWD Arts. 7–11 apply to every "person performing platform work … irrespective of the nature of the contractual relationship" (Art. 2(1)(c)). The directive's personal-data rules on algorithmic management apply "including [to] those who do not have an employment contract" (Art. 1(2)).
- Health and safety (Art. 12) and information and consultation (Arts. 13–14) are for **platform workers** (employees) only (recital 54).
- Art. 11 (human review) does not apply to drivers who are P2B "business users" (Art. 11(5)); Regulation 2019/1150 then governs instead.
- Transposition deadline: **2 December 2026** (Art. 29(1)).
- Latvia: the "Digitālo darba platformu likums" draft went to public consultation 15–29 June 2026 (S21, secondary). The draft text was not read and its adoption status is unknown.

**Is Sakta a "digital labour platform"?** Art. 2(1)(a) requires all four conditions. The fourth is "the use of automated monitoring systems or automated decision-making systems". Interpretation: dispatch auto-offering and the geozone queue are ADM, and GPS presence is automated monitoring, so yes. The contracting chain is platform → carrier (pārvadātājs) → driver. Art. 2(1)(b) covers work performed "on the basis of a contractual relationship between the digital labour platform **or an intermediary**, and the individual", so drivers engaged through a carrier are still in scope (interpretation, Q9).

**Rights to build for (engineering):** P16 (easy access), P17 (logic explanation, already partly built), P18 (human decision on suspension, written reasons, two-week review), P22 (transparency document matching the real parameters), P24 (portability tool), P26 (3-month in-app history). From GDPR, Art. 21 objection applies to any 6(1)(f) processing.

---

## 7. Open questions for a lawyer

| Q | Question | Why it matters |
|---|---|---|
| Q1 | Which fields does APL 35.² (5) protect from deletion: only the MK 541 p.11 VID set, or also the rider's identity, phone and pickup/drop-off addresses on the ride? | Decides whether erasure can pseudonymise the rider (R2, R5, P6) |
| Q2 | How do we reconcile "nelabot" (do not correct, APL 35.² (5)) with GDPR Art. 16? Is an appended correction record acceptable to ATD and VID? | P7 |
| Q3 | APL 35.² (6) says "vismaz piecus gadus" with no maximum. When may protected records be deleted under Art. 5(1)(e)? Is there any ATD or VID guidance? | R1, R12 |
| Q4 | DPO: is GPS tracking of ~10 drivers in the pilot, growing, plus all riders' ride data, "large scale" regular and systematic monitoring under Art. 37(1)(b)? Document the reasoning either way | D10 |
| Q5 | What complaint or claim window applies to a fare dispute (consumer law, Civillikums, Komerclikums)? This research did not verify any civil limitation period | R4 |
| Q6 | Are Sakta rides "taksometrs" or "vieglais automobilis" under APL? If the latter, the e-invoice-by-email duty (35.² (1)(5)(c)) makes rider email a legal-obligation field | §2 email row |
| Q7 | Do the `ledger` tables count as grāmatvedības reģistri (10 years) or as attaisnojuma dokumenti (≥5 years)? | R6 |
| Q8 | Roles: carrier (controller, joint controller or recipient?), Stripe (split per its DPA), Google Places (processor or controller?) | D6, D7 |
| Q9 | PWD: are drivers working through a carrier "persons performing platform work"? Are they P2B "business users", which would disapply PWD Art. 11? What does the Latvian draft law add, and who supervises (DVI, VDI)? | P18, §6 |
| Q10 | Minimum rider age: is a ride booked by a 13–17-year-old a valid contract? Should the app require 18+? | P28 |
| Q11 | Loading OpenStreetMap tiles on the public tracking page discloses the viewer's IP and the ride area to a third party with no contract. Is that acceptable, or should tiles be self-hosted or proxied? | §5 |
| Q12 | MK 541 p.10 obliges handing VID decryption keys. How do we reconcile that with Art. 32 key management, and does it extend to backups? | P3, D13 |
| Q13 | Does EDPB 01/2020 carry weight with DVI for a professional taxi fleet, given para 33 excludes "commercial vehicles used for professional purposes"? Or should DVI's own employee-monitoring guidance be the reference instead? | §2, R4 |
| Q14 | Uber's EUR 10m and EUR 824.99m decisions are under appeal. If either is overturned, does that change anything in D3 or D4? Watch both outcomes | P15, P18 |
