# Ride-hailing platform law in Latvia: ATD registration and VID reporting

Researched 2026-10-04 from primary sources only (likumi.lv, vid.gov.lv). atd.lv could not be reached on 2026-10-04: two WebFetch attempts returned ECONNREFUSED, several curl attempts timed out, and two Wayback Machine lookups returned HTTP 429. Nothing in this document is sourced from atd.lv. This is a reading of the texts, not legal advice. Each row separates **what the text says** from **interpretation**.

## Blocker answer first

**Yes, a registered business entity (*komersants*) is needed before the pilot can run, and two separate gates apply.**

- **Gate 1 is closed today** unless an IK already exists. The repo records "No SIA yet" (`CLAUDE.md`) and no other registered entity.
- **Gate 2's status is unknown.** It depends on whether the pilot drivers already work under a licensed carrier (Q9).

1. **The platform itself must be a *komersants*.** The law does not say "SIA". It says *komersants* registered in an EU member state:
   - Autopārvadājumu likums 1. panta 32.² punkts: „tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējs — komersants, kas atbilstoši ar pārvadātāju noslēgtam līgumam tiešsaistes režīmā organizē autopārvadājumus un sniedz saistītus pakalpojumus”
   - 35.² panta (1) daļas 1. punkts: „ir reģistrēts kādā Eiropas Savienības dalībvalstī atbilstoši komersanta reģistrācijas valsts normatīvo aktu prasībām”
   - Komerclikums 1. panta (1) daļa: „Komersants ir komercreģistrā ierakstīta fiziskā persona (individuālais komersants) vai komercsabiedrība (personālsabiedrība un kapitālsabiedrība).”
   - *Interpretation:* on the text alone, an individuālais komersants (IK) qualifies as well as an SIA. Whether an IK is a sensible vehicle given liability, the €2 800 fee and joint liability under 40. panta (14) daļa is a question for the lawyer.
   - Registration costs €2 800 plus €1 223,09 a year (see R13). Both figures are *observed* in MK 848 pielikums, points 33–34, consolidated version from 08.11.2024.
2. **Every driver must drive for a licensed *pārvadātājs*.** The carrier must hold an ATD vieglais-auto licence and a licence card for each vehicle. The licence is issued only to a carrier „kurš reģistrēts komercreģistrā” (35. panta (5.¹) daļa). Each driver needs 3 years' category B experience and an entry in the ATD taxi driver register (35. panta (8) daļa). Under 35.² panta (4) daļa the platform is *forbidden* to register or offer a carrier, driver or vehicle that fails these conditions. The fine is 70–280 naudas soda vienības (57.¹ pants).
   - *Interpretation:* sole-trader drivers would each need their own komercreģistrs entry (IK or company), their own licence and licence cards, or would have to drive under someone else's licensed company. The pilot plan has to say which pilot drivers already hold this status.

Both gates sit outside the code. A Q4 2026 pilot needs both: an entity that is registered and also ATD-registered as a platform, and licensed pilot carriers.

## Sources

Superscripts were flattened by text extraction ("35. 2", "(5 1 )"); they are rendered here as 35.², 5.¹. likumi.lv disclaimer, quoted once: „Sistematizēti tiesību akti ir informatīvi. Pretrunu gadījumā vadās pēc oficiālās publikācijas.”

| # | Act | URL | Consolidated version read | Status as of 2026-10-04 |
|---|---|---|---|---|
| S1 | **MK noteikumi Nr. 541**, „Noteikumi par tīmekļvietņu vai mobilo lietotņu pakalpojuma sniedzējiem pasažieru komercpārvadājumos ar taksometru un vieglo automobili”. Adopted in Rīgā 19.11.2019. (prot. Nr. 54 37. §), published LV 235, 21.11.2019. (OP 2019/235.27), in force 22.11.2019. Issued under Autopārvadājumu likuma 35.² panta septītā daļa. | https://likumi.lv/ta/id/310793 | 30.06.2021.– (the current version). Earlier versions: 22.11.2019.–20.05.2021. (pamata), 21.05.2021.–29.06.2021. | Spēkā esošs. The only amendment is MK 18.05.2021. noteikumi Nr. 313 (rewrote p. 11, amended p. 12 and p. 24). Point 9 (monthly reporting) lapsed 30.06.2021. No newer version or future version is listed. |
| S2 | **Autopārvadājumu likums**: 1. pants (definitions), 29. pants, 35. pants, **35.² pants**, 37. pants, 40. pants, 57. and 57.¹ pants | https://likumi.lv/ta/id/36720-autoparvadajumu-likums | 01.01.2025.–31.12.2026. (current) | Spēkā esošs. A future version from **01.01.2027.** exists. I compared the cited articles across the two versions after normalising whitespace. 35.², 35., 37., 40., 57.¹ and 1. pants are identical, apart from the spacing of quotation marks in 35.². The 2027 change is that 29. panta (5) daļas 1. punkts lapses (pre-2009 cars with engines up to 2000 cm³). |
| S3 | **VID: EDS API „Pasažieru komercpārvadājumu reģistrācija” JSON (swagger) apraksts, `taxi/carriage_v3`** | https://www.vid.gov.lv/lv/media/1253/download (file `taxi_carriage_v3.pdf`, 6 pp.); listed at https://www.vid.gov.lv/lv/eds-elektronisko-dokumentu-formatu-apraksti | Listing: valid from 01.07.2021, published 29.06.2021, "Atjaunināts: 06.02.2026." | This is the current published spec. Its page footers read `taxi/carriage_v2`, and its `host` reads `edstest.vid.gov.lv`. |
| S4 | VID: the same spec, `taxi/carriage_v1` (earlier version) | https://www.vid.gov.lv/lv/media/1115/download | — | Superseded. Cited only because its `host` reads `eds.vid.gov.lv` and it states the go-live date. |
| S5 | VID: „EDS API servisa apraksts” | https://www.vid.gov.lv/lv/eds-api-servisa-apraksts | Guide attachments "Atjaunināts: 05.02.2026." and 02.03.2026. | Current |
| S6 | VID guide: „Pasažieru komercpārvadājumu pakalpojumu sniedzēju API klientu reģistrēšana Elektroniskās deklarēšanas sistēmā” | https://www.vid.gov.lv/lv/media/1287/download?attachment | Atjaunināts 05.02.2026. | Current |
| S7 | VID guide: „Elektroniskās deklarēšanas sistēmas pārskata par taksometru datu saņemšanu tiešsaistē lietošana no 01.07.2021” | https://www.vid.gov.lv/lv/media/1288/download?attachment | Atjaunināts 05.02.2026. | Current |
| S8 | **MK noteikumi Nr. 389** (27.08.2019.), „Noteikumi par pasažieru komercpārvadājumiem ar vieglo automobili” | https://likumi.lv/ta/id/309032 | 02.03.2023.– | Spēkā esošs |
| S9 | **MK noteikumi Nr. 405** (27.08.2019.), „Noteikumi par pasažieru komercpārvadājumiem ar taksometru”. Read for p. 69.7 only. | https://likumi.lv/ta/id/309083 | 01.03.2023.– | Spēkā esošs |
| S10 | **MK noteikumi Nr. 848** (18.12.2018.), „Valsts sabiedrības ar ierobežotu atbildību "Autotransporta direkcija" maksas pakalpojumu cenrādis” | https://likumi.lv/ta/id/303983 | 08.11.2024.– | Spēkā esošs |
| S11 | Komerclikums, 1. pants | https://likumi.lv/ta/id/5490-komerclikums | 01.01.2026.– | Spēkā esošs |
| S12 | MK noteikumi Nr. 149 (06.03.2018.), „Vadītāju reģistrācijas noteikumi pasažieru komercpārvadājumiem ar taksometru un vieglo automobili” | https://likumi.lv/ta/id/297821 | 03.03.2023.– | Spēkā esošs. Only the status was checked; the content was not read. |
| — | ATD page „Tīmekļvietņu vai mobilo lietotņu pakalpojuma sniedzēja reģistrācija” and the ATD news item „Precizēts, kāda informācija par pasažieru komercpārvadājumiem būs jāiesniedz VID” | atd.lv | **Not retrieved** (connection refused) | — |

**Terminology.** The term "platformas pakalpojuma sniedzējs" does not appear in any of these acts. The legal term is ***tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējs***, which MK 541 shortens to „pakalpojuma sniedzējs”. Searches limited to the four allowed domains found no act that uses the "platform" wording.

**Scope note.** The law has two regimes: *pasažieru komercpārvadājumi ar taksometru*, with a meter, municipal licence and taxi plates, and *pasažieru komercpārvadājumi ar vieglo automobili*, booked online only and paid cashless only, with an ATD licence. Sakta Cab's app-only model maps to the vieglais-auto regime. Taxi-regime rules are noted only where they touch the platform.

## Requirements table

Abbreviations: **APL** = Autopārvadājumu likums (S2); **541** = MK 541 (S1); **389** = MK 389 (S8).

### Reporting to VID

| ID | Requirement: what the text says | Quote ref | Fields | Trigger / timing | Transport | Retention | Applies from |
|---|---|---|---|---|---|---|---|
| **R1** | The platform gives VID information on trips in Latvia that were offered, refused by the carrier and provided, plus drivers and vehicles. | APL 35.² (6): „Tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējs sniedz Valsts ieņēmumu dienestam informāciju par Latvijas teritorijā tīmekļvietnē vai mobilajā lietotnē piedāvātajiem, pārvadātāja atteiktajiem un sniegtajiem pasažieru komercpārvadājumiem, autovadītājiem un autotransporta līdzekļiem.” | The law names categories, not fields. MK 541 sets the scope (35.² (7) 4)). | Not set in the law | Not set in the law | See R4 | 01.09.2019. (pārejas noteikumi 39. p.) |
| **R2** | **Push each completed trip to VID** „nekavējoties pēc komercpārvadājuma beigām”. | 541 p. 11 (MK 313 redakcijā): „Pakalpojuma sniedzējs nekavējoties pēc komercpārvadājuma beigām nosūta Valsts ieņēmumu dienestam šādu informāciju: 11.1. pārvadātāja reģistrācijas numurs komercreģistrā; 11.2. autovadītāja personas kods vai Valsts ieņēmumu dienesta piešķirts nodokļu maksātāja reģistrācijas kods, ja autovadītājam nav Pilsonības un migrācijas lietu pārvaldes piešķirtā personas koda; 11.3. autotransporta līdzekļa valsts reģistrācijas numurs; 11.4. pārvadājuma pakalpojuma sākuma datums un laiks; 11.5. pārvadājuma pakalpojuma beigu datums un laiks; 11.6. nobraukto kilometru skaits; 11.7. braukšanas maksa; 11.8. pakalpojuma sniedzēja aprēķinātā atlīdzība (komisija); 11.9. norēķinu veids.” | 9 fields: carrier reg. no.; driver personas kods (or VID taxpayer code); plate; start date-time; end date-time; km; fare; platform commission; payment type | Trigger: end of trip. Timing: "nekavējoties" (immediately). **No numeric deadline found.** | Per p. 12, in VID's published structure and format (R3) | See R4 | **01.07.2021.** (541 p. 23) |
| **R3** | The format is the one VID publishes. VID's published format is the EDS API JSON service. | 541 p. 12: „Pakalpojuma sniedzējs šo noteikumu 11. punktā minēto informāciju nosūta Valsts ieņēmumu dienestam atbilstoši Valsts ieņēmumu dienesta tīmekļvietnē publicētajai datu struktūrai un formātam.” S3: „Izmantojot EDS API taksometru servisu, ar 2021. gada 1. jūliju taksometru nozares komersantiem un tīmekļvietnes vai mobilās lietotnes pakalpojumu sniedzējiem jāiesniedz informācija tiešsaistē VID par sniegtajiem pasažieru komercpārvadājumiem gan ar taksometru, gan ar vieglo automobili.” | See "VID technical specification" below | Per trip (one POST per carriage) | **REST API, JSON (also XML accepted), HTTPS, OAuth 2.0 client-credentials.** Not an EDS file upload. | — | 01.07.2021 (S3 listing "Spēkā no") |
| **R4** | **Retention: at least 5 years, stored in the EU or NATO.** | APL 35.² (6), second sentence: „Šo informāciju tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējs apstrādā un glabā Eiropas Savienības dalībvalstī vai Ziemeļatlantijas līguma organizācijas (NATO) dalībvalstī vismaz piecus gadus.” | Everything in R1: offered, refused and provided trips, drivers, vehicles | — | Data location: EU or NATO member state | **≥ 5 years** (*observed*, APL 35.² (6)). **No start point is stated** (trip date? end of year?). Not found. | 01.09.2019. |
| **R5** | **Ban on deleting or altering** records of accepted, refused and provided trips, drivers and vehicles. Also a ban on unjustifiably denying access to the service. | APL 35.² (5): „Tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējam aizliegts nepamatoti liegt piekļuvi pasažieru komercpārvadājumu pakalpojumam, kā arī dzēst vai labot informāciju par Latvijas teritorijā tīmekļvietnē vai mobilajā lietotnē pieņemtajiem, atteiktajiem un sniegtajiem pasažieru komercpārvadājumu pakalpojumiem, autovadītājiem un autotransporta līdzekļiem.” | Accepted (*pieņemtajiem*), refused and provided trips; drivers; vehicles | Continuous | — | Not stated here. R4 gives ≥ 5 years. | 01.09.2019. |
| **R6** | **VID access on request within 10 working days**, including handing over keys if the data is encrypted. | 541 p. 10: „Pakalpojuma sniedzējs pēc Valsts ieņēmumu dienesta pieprasījuma 10 darbdienu laikā nodrošina nodokļu administrācijas pilnvarotajiem pārstāvjiem piekļuvi elektroniskā veidā apstrādātajai vai glabātajai informācijai par pārvadātājiem sniegtajiem tīmekļvietnes vai mobilās lietotnes pakalpojumiem Latvijā un šo pārvadātāju sniegtajiem pārvadājuma pakalpojumiem Latvijas teritorijā, kā arī iespēju nodokļu administrācijai kontroles pasākumu veikšanai nolasīt no attiecīgā datu nesēja nepieciešamos datus par minētajiem pakalpojumiem. Ja dati ir aizsargāti, izmantojot paroles, šifrēšanu, kriptēšanu vai citus loģiskās aizsardzības līdzekļus, pakalpojuma sniedzējs elektroniskā veidā iesniedz nodokļu administrācijai informāciju, kas nepieciešama piekļuvei un datu izmantošanai (piemēram, šifrēšanas atslēgu).” | Services provided to carriers, and the carriers' trips | On VID request: **10 working days** (*observed*, 541 p. 10) | Electronic access plus readable data; keys handed over electronically | — | 22.11.2019. |
| R7 | *(Historic)* Monthly reporting to VID | 541 p. 9: „(Zaudējis spēku ar 30.06.2021.; sk. 22. punktu)” | — | Monthly, 01.01.2020–30.06.2021 | — | — | **Lapsed.** Replaced by R2. |

**Gaps between the reporting rows.** The text facts are certain; each reading is interpretation.

- **G1: offered and refused trips.**
  - *Text:* APL 35.² (6) covers offered, refused and provided trips. MK 541 p. 11 pushes data only „pēc komercpārvadājuma beigām” (after a completed trip). The VID API has a single `/api/taxi/carriage` resource and no field for refusals.
  - *Interpretation:* offered and refused trips are probably not pushed. They must be kept for ≥ 5 years (R4), must not be deleted (R5), and must be producible on request within 10 working days (R6). Lawyer question Q3.
- **G2: commission and payment type.**
  - *Text:* 541 p. 11.8 and p. 11.9 mandate commission and payment type. In the S3 swagger, `required` lists only `CarriersTaxpayerCode, DriversPersonCode, NumberPlate, StartDateTime, EndDateTime, Distance, ServiceFee`. `Commission` and `PaymentType` are optional in the schema.
  - *Interpretation:* send them anyway, because the regulation requires them.

### Platform registration and conduct

| ID | Requirement: what the text says | Quote ref | Fields / content | Trigger / timing | Retention | Applies from |
|---|---|---|---|---|---|---|
| **R8** | **ATD registration is a precondition** for offering the service and for carriers or drivers using it. An unregistered app gets blocked. | APL 35.² (1): „Tīmekļvietnes vai mobilās lietotnes pakalpojumus Latvijas Republikā var sniegt un pārvadātājs un autovadītājs šos pakalpojumus var izmantot, ja tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējs ir reģistrēts Autotransporta direkcijas uzturētajā Autopārvadātāju informatīvajā datu bāzē.” 35.² (3): „Tīmekļvietnes vai mobilās lietotnes darbību bloķē, ja tīmekļvietnes vai mobilās lietotnes pakalpojumi tiek piedāvāti bez reģistrācijas.” | — | Before the first ride | — | 01.09.2019. |
| **R9** | Registration conditions: (1) registered in an EU member state; (2) tax debts not above the publication threshold; (3) all PTAC undertakings and decisions met; (4) data handled per 35.² (6), i.e. R1 and R4; (5) app functionality per A1–A3. | APL 35.² (1) 1)–5) (full text under "Registration prerequisites") | — | Checked by ATD in the registers of UR, PTAC and VID (541 p. 3) | — | 01.09.2019. |
| **R10** | **Application contents.** These must include **where trip, driver and vehicle data will be processed and stored**, plus a description of the functionality. | 541 p. 2.1: „iesniegumu. Tajā norāda pakalpojuma sniedzēja nosaukumu, juridisko adresi, reģistrācijas numuru, elektroniskā pasta adresi, tīmekļvietnes adresi vai mobilās lietotnes nosaukumu, kā arī vietu, kur tiks apstrādāti un glabāti dati par Latvijas teritorijā pakalpojuma sniedzēja tīmekļvietnē vai mobilajā lietotnē piedāvātajiem, pārvadātāja atteiktajiem un veiktajiem pasažieru komercpārvadājumiem, autovadītājiem un autotransporta līdzekļiem;” p. 2.4: „šo noteikumu III nodaļā minētās tīmekļvietnes vai mobilās lietotnes funkcionalitātes un norādāmās informācijas aprakstu.” p. 2.2: a document proving representation rights, if the provider is not the app owner. p. 2.3: a foreign registration certificate copy, if registered elsewhere in the EU. | Name, legal address, registration number, e-mail, URL or app name, data-storage location, functionality description | Application to ATD. **ATD decision deadline: not found** in 541. | — | 22.11.2019. |
| R11 | Notify ATD of changes to the p. 2.1 data within **5 working days**. | 541 p. 6: „Ja ir izmaiņas šo noteikumu 2.1. apakšpunktā minētajā informācijā, pakalpojuma sniedzējs piecu darbdienu laikā iesniedz attiecīgu iesniegumu Autotransporta direkcijā. […]” | p. 2.1 fields | 5 working days from the change (*observed*, 541 p. 6) | — | 22.11.2019. |
| **R12** | **Onboarding gate.** Do not register or offer a non-compliant carrier, driver or vehicle. Fine: 70–280 naudas soda vienības. | APL 35.² (4): „Tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējam aizliegts tīmekļvietnē vai mobilajā lietotnē reģistrēt un piedāvāt pārvadātāju, autovadītāju un autotransporta līdzekli, kas neatbilst šā likuma 35. panta pirmās, piektās un astotās daļas prasībām.” APL 57.¹: „Par prasībām neatbilstoša pārvadātāja, autovadītāja vai autotransporta līdzekļa piedāvāšanu tīmekļvietnē vai mobilajā lietotnē piemēro naudas sodu tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējam no septiņdesmit līdz divsimt astoņdesmit naudas soda vienībām.” | Carrier licence (35 (1)/(5)), licence card per vehicle, driver in the taxi driver register (35 (8)) | At onboarding, and continuously while offering | — | 35.² (4): 01.09.2019.; 57.¹ current wording (27.03.2024. likuma redakcijā) from 24.04.2024. The **euro value of a naudas soda vienība was not retrieved.** |
| **R13** | **ATD fees** | MK 848 pielikums p. 33: „Tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzēja (kas veic pasažieru komercpārvadājumus ar taksometru un vieglo automobili) reģistrācija Autopārvadātāju informatīvajā datubāzē 1 gab. 2800,00 0,00 2800,00”; p. 34: „Autopārvadātāju informatīvajā datubāzē reģistrētā tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzēja darbības uzraudzība 1 gab./gadā 1223,09 0,00 1223,09”; p. 4.¹: the supervision fee is paid for each next year, by the anniversary of registration. | €2 800,00 one-off; **€1 223,09 per year**; PVN 0 | Registration; yearly by the anniversary | — | MK 848 version 08.11.2024. (*observed*) |
| R14 | ATD supervision: yearly checks or checks on request; may run test rides; non-compliance leads to a written demand and then annulment. | 541 p. 13: „Autotransporta direkcija reizi gadā vai pēc […] pieprasījuma pārbauda pakalpojuma sniedzēja un tā tīmekļvietnes vai mobilās lietotnes atbilstību […]”; p. 14: „[…] tostarp veikt uzraudzības braucienus […]”; p. 16.2: annulment if the demand is not met. APL 35.² (2) also annuls „ja […] pakalpojuma sniedzējs nepamatoti liedz piekļuvi […]”. | — | Yearly | — | 22.11.2019. |
| R15 | **Joint liability** of platform and carrier for providing the service. | APL 40. (14): „Tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējs un pārvadātājs, kas sniedz pasažieru komercpārvadājumu pakalpojumu, izmantojot tīmekļvietni vai mobilo lietotni, ir solidāri atbildīgi par pasažieru komercpārvadājumu pakalpojuma nodrošināšanu.” | — | — | — | 01.09.2019. |
| R16 | Accessibility. On request from a person with reduced mobility, the carrier or platform provides a suitable vehicle and a driver able to serve them. | APL 40. (9): „[…] pārvadātājs vai tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējs pēc minētās personas pieprasījuma nodrošina autotransporta līdzekli, kas piemērots personu ar kustību traucējumiem pārvadāšanai, un autovadītāju, kurš var sniegt pakalpojumu šādām personām.” | — | Per request | — | 01.09.2019. |

### Access control and audit (R17)

- *Text:* the access-related obligations found are:
  - VID access within 10 working days, with keys handed over (R6).
  - Drivers can read their last 3 months of trips (A6).
  - Carriers can access ≥ 5 years of their drivers' accepted, refused and provided trips (A7).
  - Drivers must be able to show the trip record to inspectors (APL 40. (10)).
- **No audit-log requirement and no access-control standard for platform data were found** in APL, 541 or the VID spec.
- *Interpretation:* the deletion ban (R5) effectively demands append-only trip, driver and vehicle records with corrections stored as new entries. Neither text prescribes this.

## VID technical specification (S3, `taxi/carriage_v3`)

What the document says, verbatim where quoted.

- **Transport.** REST over HTTPS. The service is the EDS API "Taksometri" ("Taksometru API").
  - S5 says: „Serviss ir pieejams izmantojot HTTPS/SSL. EDS API sistēmas lietotāju autentifikācijai un autorizācijai izmanto shēmu, kas atbilst OAuth 2.0 protokola “Client Credentials Grant” scenārijam. Darbības šajā API sadaļā tiek veiktas nodokļu maksātāja vārdā.”
- **Endpoints.**
  - `POST /api/taxi/auth` takes `grant_type` (the constant `"client_credentials"`), `client_id` and `client_secret`. It returns `access_token`, `token_type` ("bearer") and `expires_in` (int32, seconds).
  - `DELETE /api/taxi/auth` revokes the token and returns 204.
  - `POST /api/taxi/carriage` sends the body `Carriage`. Responses:
    - 201 „Apstiprinājuma statusa kods.”
    - **409 „Ieraksts ar identiskiem datiem jau izveidots.”**
    - 400, 401, 403
    - **429 „Pārsniegts izsaukumu skaita ierobežojums.”** The rate-limit value is not stated.
  - Auth header: `Authorization: Bearer {token}`.
  - Content types: consumes JSON, XML or form data; produces JSON or XML.
- **Host.** The v3 document says `"host": "edstest.vid.gov.lv"`. The v1 document (S4) says `"host": "eds.vid.gov.lv"`. *Interpretation:* v3 shows the test host and the production host is probably `eds.vid.gov.lv`. Neither document says so in words; confirm with VID.
- **Spec version.** The file and listing are named `taxi/carriage_v3`, but every page footer reads `taxi/carriage_v2`. The text says „Šis apraksts līdz tā turpmākām izmaiņām ir spēkā EDS versijai 20.3 un jaunākai.” The authoritative `swagger.json` is in EDS: „Servisu saskarne API” >> „Atvērt servisu saskarni” (not retrieved; it needs an EDS login).

**`Carriage` fields**, with the matching MK 541 p. 11 point:

| JSON field | Required in schema | Type / limits | Description (verbatim) | MK 541 p. 11 |
|---|---|---|---|---|
| `CarriersTaxpayerCode` | yes | string, exactly 11 characters | „Pārvadātāja reģistrācijas numurs komercreģistrā.” | 11.1 |
| `DriversPersonCode` | yes | string, 11–12 characters | „Autovadītāja personas kods vai Valsts ieņēmumu dienesta piešķirts nodokļu maksātāja reģistrācijas kods, ja autovadītājam nav Pilsonības un migrācijas lietu pārvaldes piešķirtā personas koda.” | 11.2 |
| `NumberPlate` | yes | string, 2–12 characters | „Autotransporta līdzekļa valsts reģistrācijas numurs.” | 11.3 |
| `StartDateTime` | yes | string, example `2000-01-31T00:00:00` (no zone offset in the example) | „Pārvadājumu pakalpojuma sākuma datums un laiks.” | 11.4 |
| `EndDateTime` | yes | string, same format | „Pārvadājumu pakalpojuma beigu datums un laiks.” | 11.5 |
| `Distance` | yes | number (double), 0–1e9 | „Nobraukto kilometru skaits.” | 11.6 |
| `ServiceFee` | yes | number (double), 0–1e9 | „Braukšanas maksa.” | 11.7 |
| `Commission` | **no** | number (double), 0–1e9 | „Pakalpojuma sniedzēja aprēķinātā atlīdzība (komisija).” | 11.8 (mandatory in MK) |
| `PaymentType` | **no** | enum: `cash, cashless, paymentCard, smartCard, providersWebsite, mobileApplication, giftCard, cheque, voucher, eService, other` | „Norēķinu veids.” | 11.9 (mandatory in MK) |
| `SerialNumber` | no | string, 3–13 characters | „Taksometra skaitītāja šasijas numurs.” | Taxi meter only (MK 405 p. 69.7.1.4) |
| `GrandTotal` | no | number (double) | „Absolūtais summatora (Grand Total) stāvoklis konkrētajā brīdī.” | Taxi meter only (MK 405 p. 69.7.1.10) |

**Implementation notes for this repo (interpretation):**

- `ServiceFee` and `Commission` are doubles in euros, while the repo rule is integer cents. Convert at the VID adapter boundary only (cents / 100) and never store the double.
- `StartDateTime` and `EndDateTime` carry no zone in the example, and the spec does not say whether they are local Rīga time or UTC. Lawyer/VID question Q6.
- The 409 "identical record" response makes retries safe for byte-identical payloads. Whether a *corrected* resend is allowed is not stated, and R5 bans altering data.

**EDS onboarding (S6).**

- A person with the EDS „lietotāju tiesību pārvaldnieka privilēģija” for the taxpayer grants „Tiesības veikt API servisa “Taksometri” konfigurāciju”. They then use „Izveidot jaunu API klienta identifikatoru” to register a password and „katram autotransporta līdzekļa vadītajam izveido unikālu klienta identifikatoru”.
- „Viena uzņēmuma ietvaros parole (client_secret) var būt katram EDS API klientam sava vai visiem viena.”
- „Parole (client_secret) pēc API klienta identifikatora izveidošanas pabeigšanas vairs nebūs aplūkojama.”
- *Interpretation:* the platform needs its own EDS access as a taxpayer, which again requires the entity. The guide is written around a client_id *per driver*, and it does not say whether a platform may use one client_id for all its drivers. This is question Q5.
- The S5 page lists **Taksometru API** as one tiesību apgabals for EDS API keys and certificates, and gives them a maximum validity of 90 days („API atslēgai izvēlas derīguma termiņu. Maksimālais 90 dienas”). S6 describes the client_id/secret mechanism and states no expiry. **It is not established whether `/api/taxi/auth` needs only the S6 client_id/secret, or also a Taksometru-scope key that must be rotated at least every 90 days.** See Q5.
- **Self-check:** EDS has a report „Pārskats par taksometru datu saņemšanu tiešsaistē”, exportable as PDF or XML, listing the data VID received for each trip (S7). Use it to reconcile submissions.

**Taximeter online-data rule (MK 405 p. 69.7), for context only.**

- The meter must send 10 fields per trip „tiešsaistes režīmā”, including the meter serial and Grand Total (69.7.1).
- It must buffer in non-volatile memory „par laika periodu, kurā ārēju tehnisku iemeslu dēļ nav iespējams tiešsaistes režīmā nodrošināt informācijas nosūtīšanu” (69.7.2).
- It blocks the next ride if the data has not been requested (69.6).
- These are **taximeter** obligations of the taxi carrier. MK 541 contains no equivalent offline-buffer rule for platforms (not found). If Sakta Cab ever dispatches licensed taxis, a ride could be reported both by the meter (MK 405) and by the platform (MK 541). See Q7.

## Registration prerequisites

**Platform: text of APL 35.² (1).**

> „Autotransporta direkcija reģistrē tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzēju, ja tas atbilst šādām prasībām: 1) ir reģistrēts kādā Eiropas Savienības dalībvalstī atbilstoši komersanta reģistrācijas valsts normatīvo aktu prasībām; 2) tam nav nodokļu, nodevu un citu valsts noteikto obligāto maksājumu parādu, kuru kopsumma pārsniedz likumā "Par nodokļiem un nodevām" noteikto nodokļu (nodevu) parāda kopsummu, no kuras sākot nodokļu administrācija nodrošina publisku informācijas pieejamību; 3) tas ir izpildījis visas Patērētāju tiesību aizsardzības centram iesniegtās rakstveida apņemšanās par konstatēto pārkāpumu novēršanu un visus Patērētāju tiesību aizsardzības centra tam piemērotos lēmumus; 4) tas nodrošina informācijas apstrādi un glabāšanu atbilstoši šā panta sestajā daļā noteiktajai kārtībai; 5) tā izmantotā tīmekļvietne vai mobilā lietotne nodrošina: […]”

**Legal entity.**

- **A *komersants* is required. "SIA" specifically is not.**
  - *Text:* see the blocker section above for APL 1. p. 32.², APL 35.² (1) 1) and Komerclikums 1. (1).
  - MK 541 p. 4.2 also records the „reģistrācijas numurs komercreģistrā”.
  - *Interpretation:* IK or SIA both satisfy the text.
  - Platform licence: **not found.** The platform needs *registration* in the ATD database, not a *licence*.
- **Fees:** €2 800 to register and €1 223,09 a year for supervision (R13; *observed*, MK 848 version 08.11.2024).
- **Process:**
  1. Apply to ATD with the documents in R10.
  2. ATD checks the Uzņēmumu reģistrs, PTAC and VID (541 p. 3).
  3. ATD issues a written decision and records name, registration number, legal address, URL or app name and registration date in the Autopārvadātāju informatīvā datu bāze (541 p. 4).
  - ATD refuses registration if the app is already registered to or owned by another registered provider (541 p. 5).
  - **The ATD decision deadline was not found.** ATD's own procedure page was not retrieved.

**Carriers and drivers on the platform: the second gate.**

| Who | Requirement | Quote ref |
|---|---|---|
| Carrier (pārvadātājs) | ATD special permit (licence) for vieglais-auto rides, plus a licence card per vehicle | APL 35. (5): „Pasažieru komercpārvadājumus ar vieglo automobili drīkst veikt, ja pārvadātājs ir saņēmis Autotransporta direkcijas izsniegtu speciālo atļauju (licenci) pasažieru komercpārvadājumiem ar vieglo automobili un licences kartīti attiecībā uz katru autotransporta līdzekli.” |
| Carrier | Must be in the komercreģistrs and free of tax debt above the threshold | APL 35. (5.¹): „[…] izsniedz pārvadātājam, kurš reģistrēts komercreģistrā un kuram nav nodokļu parādu, […]” Definition APL 1. p. 28: „pārvadātājs — komersants, kooperatīvā sabiedrība vai zemnieku vai zvejnieku saimniecība, […]” |
| Carrier licence | Valid 4 years; ATD checks within 7 working days | APL 35. (5.²); 389 p. 3 |
| Licence card | €27,27 per card, unit „1 gab.” (*observed*, MK 848 p. 35). **The period the fee covers was not found.** APL 35. (5.⁵) 4) caps a card's term at „periodu, par kuru veikts maksājums par licences kartītes izsniegšanu”, so it may not be a one-off fee. ATD checks within 7 working days (389 p. 9). | MK 848 p. 35; APL 35. (5.⁵) |
| Carrier licence state fee | „valsts nodeva, kuras apmēru […] nosaka Ministru kabinets”. **Amount not retrieved.** | APL 35. (9) |
| Vehicle | Category M1, owned or held by the carrier, no VID usage ban, CO₂ limits per APL 29. (5). From 01.01.2027 the pre-2009 ≤2000 cm³ route (29. (5) 1)) lapses. | APL 29. (4), (5) |
| Driver | ≥ 3 years of category B experience and registration in ATD's taxometru vadītāju reģistrs. The application costs €55,95 (*observed*, MK 848 p. 1). | APL 35. (8); MK 149 (not read) |

## App functionality requirements

What the text requires of the app. Items marked **[vieglais]** apply to the app-only regime specifically.

| ID | Requirement | Quote ref |
|---|---|---|
| A1 | Show the offered service, tariffs, surcharges for extras, the carrier, driver and vehicle, and allow a request for a vehicle suitable for a person with reduced mobility | APL 35.² (1) 5) a): „informāciju par piedāvāto pasažieru komercpārvadājumu pakalpojumu, tarifiem, papildmaksu par papildu pakalpojumiem, pārvadātāju, autovadītāju un autotransporta līdzekli, kā arī iespēju pieprasīt autotransporta līdzekli, kas piemērots personai ar kustību traucējumiem,” |
| A2 | Request and confirm the ride online | APL 35.² (1) 5) b): „iespēju tiešsaistē pieprasīt un apstiprināt komercpārvadājumu pakalpojumu,” |
| A3 **[vieglais]** | **Calculate the fare, take cashless payment online, and e-mail an e-invoice at the end of the ride** | APL 35.² (1) 5) c): „pasažieru komercpārvadājumos ar vieglo automobili — iespēju aprēķināt braukšanas maksu un veikt samaksu tiešsaistē bezskaidras naudas norēķinus, kā arī brauciena beigās pasažierim uz tīmekļvietnē vai mobilajā lietotnē reģistrēto pasažiera elektroniskā pasta adresi nosūtīt elektroniski sagatavotu rēķinu un informāciju par saņemto komercpārvadājumu pakalpojumu.” |
| A4 **[vieglais]** | **The e-invoice is the proof of the contract** and must meet the accounting and tax rules for source documents | APL 37. (5): „Pasažieris komercpārvadājumu pakalpojumu ar vieglo automobili nolīgst tiešsaistē tīmekļvietnē vai mobilajā lietotnē. Pakalpojuma līguma izpildi apliecina brauciena beigās pasažierim uz tā tīmekļvietnē vai mobilajā lietotnē reģistrēto elektroniskā pasta adresi nosūtīts elektroniski sagatavots rēķins, kas atbilst grāmatvedības un nodokļu jomu reglamentējošu normatīvo aktu prasībām par attaisnojuma dokumentiem un satur informāciju par saņemto pakalpojumu un pakalpojuma sniedzēju.” |
| A5 | Carriers can register drivers and vehicles in the app | 541 p. 7.1: „iespēja pārvadātājam reģistrēt autovadītāju un autotransporta līdzekli tīmekļvietnē vai mobilajā lietotnē;” |
| A6 | The passenger chooses the payment method **before** requesting: online in the app, or cash or card after the ride by taximeter reading. Also: the driver states a refusal reason; the driver can read 3 months of trips; the carrier can access ≥ 5 years of trips. | 541 p. 7.2: „iespēja pasažierim pirms pakalpojuma pieprasījuma izvēlēties samaksas veidu par pārvadājuma pakalpojumu: 7.2.1. tiešsaistē pakalpojuma sniedzēja tīmekļvietnē vai mobilajā lietotnē; 7.2.2. skaidrā vai bezskaidrā naudā pēc brauciena, pamatojoties uz taksometra skaitītāja rādījumu;” p. 7.3: „iespēja autovadītājam norādīt pasažierim komercpārvadājuma pakalpojuma atteikuma iemeslu atbilstoši pakalpojuma lietošanas noteikumiem;” p. 7.4: „iespēja autovadītājam nolasīt tīmekļvietnē vai mobilajā lietotnē informāciju par visiem iepriekšējo triju mēnešu laikā veiktajiem komercpārvadājumu pakalpojumiem;” |
| A7 | Carrier access to all of its drivers' accepted, refused and provided trips for **at least 5 years** | 541 p. 7.5: „iespēja pārvadātājam piekļūt datiem par visiem pārvadātāja autovadītāju pieņemtajiem, atteiktajiem un veiktajiem pārvadājumiem par vismaz pēdējiem pieciem gadiem.” |
| A8 | **Information shown to the rider** (p. 8.1–8.11, listed below) | 541 p. 8 (quoted below) |
| A9 **[vieglais]** | The driver uses the app to calculate the fare. No rides while the app is offline. No cash. No street pickups outside the app. | APL 40. (13): „1) autovadītājs braukšanas maksas aprēķinam lieto tīmekļvietni vai mobilo lietotni, kuras programma nodrošina iespēju tiešsaistē pieprasīt, apstiprināt un atteikt pārvadājumu pakalpojumu, aprēķināt braukšanas maksu un veikt bezskaidras naudas norēķinus; 2) autovadītājam aizliegts veikt pasažieru komercpārvadājumus, ja tīmekļvietne vai mobilā lietotne nedarbojas tiešsaistes režīmā; 3) autovadītājam aizliegts maksu par pasažieru komercpārvadājumu pakalpojumu saņemt skaidrā naudā; 4) autovadītājam aizliegts uzņemt pasažieri, izmantojot citus komercpārvadājumu pakalpojuma pieprasījuma veidus.” Also 389 p. 19: „Autovadītājs akceptē vai atsaka pārvadājumu pakalpojumu, izmantojot tīmekļvietni vai mobilo lietotni.” |
| A10 | The driver must be able to show inspectors the trip record held in the app | APL 40. (10): „[…] nodrošināt iespēju nolasīt taksometra skaitītāja summāros rādītājus vai informāciju par tīmekļvietnē vai mobilajā lietotnē reģistrēto pārvadājumu pakalpojumu.” |
| A11 **[vieglais]** | Vehicle signage. Platform and carrier information goes on the outside of both front doors (not on the glass). Driver name, register number and carrier name go on the passenger-side dashboard, typed black on white, characters ≥ 3 mm. | APL 29. (8); 389 p. 15: „Informāciju par tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzēju un pārvadātāju izvieto ārpusē uz autotransporta līdzekļa abām priekšējām durvīm (neizmantojot durvju stikloto daļu).”; p. 16 |

**A8: MK 541 p. 8, verbatim.**

> „Pakalpojuma sniedzējs tīmekļvietnē vai mobilajā lietotnē norāda informāciju, kas nodrošina pakalpojuma saņēmējam iespēju iegūt informāciju par pārvadājuma pakalpojumu (piedāvājumu, pieprasījumu un apstiprināšanu), tostarp informāciju par: 8.1. iespēju izvēlēties samaksas veidu par pārvadājumu; 8.2. pārvadātāju (nosaukums un reģistrācijas numurs komercreģistrā) un autovadītāju, kas veic pārvadājuma pakalpojumu (vārds, uzvārds un reģistrācijas numurs taksometru vadītāju reģistrā); 8.3. autotransporta līdzekļa valsts reģistrācijas numuru; 8.4. tarifu nolīgšanai, tarifu vienam kilometram un tarifu vienai minūtei, papildu pakalpojumiem un to maksu saprotamā un labi redzamā veidā; 8.5. iespējamo kopējo braukšanas maksu par pārvadājuma pakalpojumu, ja pieprasījuma brīdī ir zināms maršruta sākums un galamērķis; 8.6. maršruta sākumu un galamērķi; 8.7. pasažieru un bagāžas pārvadāšanas kārtību; 8.8. piedāvāto autotransporta līdzekli, kas piemērots personām ar kustību traucējumiem; 8.9. pārvadājuma pakalpojuma uzsākšanas un pabeigšanas laiku; 8.10. pārvadājuma pakalpojuma maksājuma apstrādes veidu un apmaksas apstiprinājumu, beidzot pārvadājuma pakalpojuma sniegšanu; 8.11. kontaktinformāciju patērētāju sūdzību iesniegšanai un informāciju par patērētāju ārpustiesas strīdu risināšanu.”

**Interpretation:**

- Upfront pricing is an *estimate* („iespējamo kopējo braukšanas maksu”) shown when origin and destination are known. A fixed price is not required by the text.
- The tariff must be shown as three components: flagfall, per km and per minute.
- The rider must see the driver's taxi-register number and the carrier's company registration number.
- **There is a tension in the text.** For vieglais rides, APL 40. (13) 3) and 1. p. 26.² ban cash. MK 541 p. 7.2.2 requires offering cash or card after the ride „pamatojoties uz taksometra skaitītāja rādījumu”, which fits taxi rides only. *Interpretation:* p. 7.2.2 bites only when the platform also dispatches licensed taxis. For a vieglais-only platform, online cashless payment is the only lawful option. This is question Q2.
- **Cash register (kases aparāts) / čeks:**
  - In S1–S12 the only čeks obligation found is the taximeter receipt (APL 37. (3), 40. (11) 4)), which belongs to the taxi regime. For vieglais rides the proof of the contract is the e-invoice (A4).
  - The general cash-register regulation is MK 11.02.2014. noteikumi Nr. 96, „Nodokļu un citu maksājumu reģistrēšanas elektronisko ierīču un iekārtu lietošanas kārtība” (https://likumi.lv/ta/id/265487), version 01.04.2026.–31.12.2026. A future version from 01.01.2027 exists and was not read. Its p. 3 reads: „Lai nodrošinātu nodokļu un citu maksājumu reģistrāciju, par darījumiem saņemto samaksu skaidrā naudā, ar maksājumu kartēm vai citiem maksājuma apliecinājumiem (dāvanu kartes, čeki, taloni un tamlīdzīgi apliecinājumi par to, ka tiek veikts norēķins par darījumu) nodokļu maksātāji reģistrē, izmantojot nodokļu un citu maksājumu reģistrēšanas elektroniskās ierīces un iekārtas […]”.
  - Only the scope section and the exemption points (82.–85.) were scanned for keywords. No exemption naming vieglais-auto rides or online in-app card payment was found, and the regulation was not read in full.
  - *Interpretation:* if p. 3 does reach an in-app card payment, the duty falls on the seller, i.e. the **carrier** (pārvadātājs), not the platform. Whether it does is question Q12.

## Open questions for a lawyer

1. **Entity form.** Is an IK acceptable to ATD as a „tīmekļvietnes vai mobilās lietotnes pakalpojuma sniedzējs”, or does ATD practice expect a company? Given joint liability (APL 40. (14)) and the €2 800 + €1 223,09/yr fees, is an SIA advisable? How long does ATD take to decide? No deadline was found in MK 541, and ATD's page could not be retrieved.
2. **Cash and payment choice for vieglais.** For a vieglais-only platform, does MK 541 p. 7.2.2 (cash or card after the ride by taximeter) apply at all, given the cash ban in APL 40. (13) 3)?
3. **Offered and refused trips (gap G1).** APL 35.² (6) requires reporting of offered and refused trips, but the push in MK 541 p. 11 covers completed trips only. Is retention plus on-demand access (MK 541 p. 10) sufficient? What exactly counts as an "offered" trip: every dispatch offer to every driver, or one record per ride request?
4. **Deletion ban versus GDPR.** APL 35.² (5) forbids deleting or altering trip, driver and vehicle data, while GDPR Art. 16/17 give rights to rectification and erasure. Does 35.² (5) count as a legal-obligation exemption (GDPR Art. 17(3)(b)) for the ≥ 5 years? What happens after 5 years? How should a factually wrong record be corrected (appended correction or nothing)? Can a correction be resent to VID, given the API's 409 response on identical data?
5. **EDS client_id model.** Can a platform use one client_id for all drivers, or must it create one per driver (S6 is written per driver)? Which taxpayer's EDS account must the platform's submissions sit under: the platform's or each carrier's? S5 says actions are taken „nodokļu maksātāja vārdā”. Does `/api/taxi/auth` need only the client_id/secret, or also a Taksometru-scope API key, which would expire at least every 90 days?
6. **"Nekavējoties" and time zone.** Is there an accepted latency or retry window for the per-trip push (p. 11)? Should `StartDateTime`/`EndDateTime` be in Rīga local time or UTC? What is the production host, given that the v3 PDF shows `edstest.vid.gov.lv`?
7. **Double reporting.** If licensed taxis are ever dispatched through the app, do both the taximeter (MK 405 p. 69.7.1) and the platform (MK 541 p. 11) report the same ride?
8. **Retention start.** Does "vismaz piecus gadus" (APL 35.² (6)) run from the trip date or from the end of the year? Do the accounting-law retention rules for the e-invoice (APL 37. (5)) set a longer period?
9. **Pilot drivers.** For a Q4 2026 pilot, which pilot drivers already hold carrier status, an ATD vieglais licence, licence cards and a taxi-register entry? Can the platform's own company act as the carrier for some of them, and what licence, insurance and employment consequences follow?
10. **Missing figures.** The carrier licence valsts nodeva (APL 35. (9)) and the euro value of one naudas soda vienība (for 57.¹: 70–280 vienības) were not retrieved from primary sources.
11. **Future change.** Is any amendment to MK 541 or APL 35.² in draft (for example, transposing the EU platform work directive)? None appears on likumi.lv; drafts on the TAP portāls were outside the allowed sources.
12. **Cash register for in-app cashless payments.** Does MK 96 p. 3 („samaksu […] ar maksājumu kartēm […] reģistrē, izmantojot […] elektroniskās ierīces”) require the carrier to register an online card payment taken in the app, or does the e-invoice under APL 37. (5) satisfy the source-document requirement on its own? The licence-card fee period (€27,27, MK 848 p. 35) also needs confirming with ATD.

## Verification pass (2026-10-04)

`observed` — after the research run, the load-bearing quotes were re-read against the raw likumi.lv HTML (fetched with curl, not a summariser): Autopārvadājumu likums 35.² (1)–(7) and 40. (13) 1)–4), and MK 541 p. 2.1, 6, 7.1–7.5, 8, 10, 11.1–11.9, 12. All match the text quoted above. Not re-verified: the VID EDS spec details (`carriage_v3`, test host), the MK 848 fees, and the Komerclikums reading of *komersants*. Three duties surfaced by the re-read that the gap inventory must carry: p. 7.1 (carrier registers its own drivers and vehicles in the platform), p. 7.3 (driver gives the passenger a refusal reason), p. 8.2 (rider sees carrier name + commercial-register number and the driver's taxi-driver-register number).
