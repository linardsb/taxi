# VID EDS "Taksometri" API: integration facts for the seam

**Provenance.** A research-agent pass on 2026-10-04 produced this. The agent read VID PDFs as pdftotext extracts:

| Ref | Document | Notes |
|---|---|---|
| S3 | `taxi/carriage_v3` (vid.gov.lv/lv/media/1253) | 6 pages; listing says "Atjaunināts 06.02.2026" |
| S4 | `taxi/carriage_v1` (media/1115) | — |
| S5 | the "EDS API servisa apraksts" page | — |
| S6 | the onboarding guide (media/1287) | — |
| S7 | media/1288 | — |

vid.gov.lv timed out on later fetches. The developer guide (media/1285, updated 02.03.2026) was **not** retrieved, so retry it first. None of this has been re-verified by hand. Companion docs: `vid-platform-reporting.md` (the legal duty) and `append-only-enforcement-options.md`.

## Facts

### Auth (S3 pp. 1–4; S5)

- `POST /api/taxi/auth` takes `client_id` + `client_secret`. Only these two are required; `grant_type` is described as the constant `client_credentials`.
- The call returns `access_token`, `token_type` ("bearer") and `expires_in` (int32 seconds). `DELETE /api/taxi/auth` revokes the token. Data calls send `Authorization: Bearer {token}`.
- S5: "Darbības šajā API sadaļā tiek veiktas nodokļu maksātāja vārdā."

### Getting credentials (S6)

- They are created inside a taxpayer's EDS account by a person with "lietotāju tiesību pārvaldnieka privilēģija". That person grants "Tiesības veikt API servisa 'Taksometri' konfigurāciju" and creates a unique client identifier "katram autotransporta līdzekļa vadītajam".
- `client_id`s are for "uzņēmuma darbiniekiem". The system generates them. One secret may be shared across clients, and it cannot be viewed again after creation.
- **So a registered taxpayer and an authorised EDS person are both prerequisites.** That ties this to the company decision in the PRD.
- S5 separately lists a "Taksometru API" key scope, valid for at most 90 days. Whether it applies to `/api/taxi/auth` is unclear.

### Endpoint (S3 p. 3)

- The only data call is `POST /api/taxi/carriage`. It accepts JSON, XML or form data.
- Responses:
  - 201: "Apstiprinājuma statusa kods" (string body)
  - 409: "Ieraksts ar identiskiem datiem jau izveidots."
  - 400: invalid data
  - 401, 403
  - 429: "Pārsniegts izsaukumu skaita ierobežojums."
- No 5xx, no `Retry-After` and no error-body schema are documented.

### `Carriage` fields (S3 pp. 4–6)

| Field | Required | Type and limits |
|---|---|---|
| `CarriersTaxpayerCode` | yes | string, exactly 11 characters |
| `DriversPersonCode` | yes | string, 11–12 characters |
| `NumberPlate` | yes | string, 2–12 characters |
| `StartDateTime`, `EndDateTime` | yes | string, e.g. `2000-01-31T00:00:00`, no zone, no timezone rule |
| `Distance` (km) | yes | double, 0–1e9 |
| `ServiceFee` (fare) | yes | double, 0–1e9, currency/precision unstated |
| `Commission` | no, but **mandatory under MK 541 p. 11.8** | double |
| `PaymentType` | no, but **mandatory under MK 541 p. 11.9** | enum of 11 values, includes `mobileApplication`, `providersWebsite` |
| `SerialNumber`, `GrandTotal` | no | taxi meter only |

Changes from v1 to v3:
- `DriversPersonCode` length went from 8–25 to 11–12.
- `SerialNumber` length went from 0–20 to 3–13.
- The numeric bounds are new.
- The `host` went from `eds.vid.gov.lv` to `edstest.vid.gov.lv`, although the v3 page footers still say v2.

### Behaviour

- **Idempotency.** The body carries no client-supplied identifier, so the 409 must be keyed on content ("identiskiem datiem"). Which fields count is unstated.
- **No correction or annul call.** `POST /carriage` is the only data verb. The only way to see what VID holds is the EDS report "Pārskats par taksometru datu saņemšanu tiešsaistē" (PDF or XML, S7).
- **No endpoint for offered or refused trips.** APL 35.² (6) still requires keeping them for at least 5 years.
- **Who submits.** For the app regime it is the platform (MK 541 p. 11: "Pakalpojuma sniedzējs nekavējoties pēc komercpārvadājuma beigām nosūta…"). S6's per-driver `client_id` model fits a taxi company. How a platform should hold credentials is **unresolved**.
- **Carrier validation.** APL 35.² (4) only states the result required: no carrier, driver or vehicle that falls short of 35. (1), (5), (8). No register lookup is named. VID's published validation checks string length only.

## Implications for a `VidReportingProvider` seam and outbox

- **Freeze an immutable, VID-shaped snapshot when the trip ends.**
  - Money is held in integer cents.
  - Commission is already resolved at that point.
  - The payment type is mapped from `ride.paymentMethod`.
  - Distance precision is fixed once.
  - Timestamps are converted with an explicit Europe/Riga zone (an assumption until VID confirms).
- **Store the serialized body in the outbox row, unique on `rideId`.** Retries must resend it byte for byte, because a lost-response retry only gets a 409 if the payload is identical. Rebuilding the body from a ride that has changed since would create a second VID record, and that record cannot be withdrawn.
- **Convert cents to euros only inside the adapter.**
- **Seam types.**
  - Input: `{ rideId, credentialRef, carriage }`. `credentialRef` leaves room for per-carrier or per-driver `client_id`s.
  - Output: `delivered(receipt) | duplicate | rejected(status, body) | retryable(reason) | blocked(config)`.
- **Handling by response:**

| Response | Handling |
|---|---|
| 201 | Delivered; store the receipt |
| 409 | Delivered; flag it if it happens on the first attempt |
| 400 | Dead-letter and alert; never change the payload and resend |
| 401 | Refresh the token once, then retry |
| 403 | Pause the whole queue and alert |
| 429 | Exponential backoff with jitter |
| Timeout, network error, 5xx | Retry with backoff |

- **Token.** Cache it until `expires_in` minus a margin.
- **Outages.** MK 405 p. 69.7.2 (store-and-forward for taxi meters) is the model.
- **Before enqueueing**, check field lengths. A carrier code that is not 11 characters (for example a non-LV carrier) cannot be submitted.

## Unknowns

1. The timezone of the timestamps, and whether seconds matter.
2. Precision and rounding for `Distance` and `ServiceFee`.
3. Which fields the 409 compares.
4. How to correct a wrong record (VID has no route for it).
5. Whether one platform-level `client_id` is allowed, and under whose taxpayer account. Also whether the 90-day key applies.
6. Rate-limit figures, the error-body format, and how to get test-environment access. These are probably in media/1285.
7. The production host (probably `eds.vid.gov.lv`). The authoritative `swagger.json` needs an EDS login.
8. Whether the 2026 requirement for a secure eID on EDS login affects the authorised person. Only the news title was seen.
