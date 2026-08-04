# Spike #3 — RIX + autoosta arrivals data

**Verdict: usable feeds exist → #25 is viable with automated polling ingestors.** RIX gets live actual arrival times via a third-party API within budget; autoosta is scheduled-times-only (no real-time source exists anywhere), so that half of the radar re-scopes to "scheduled arrival ± buffer". Issue [#3](https://github.com/linardsb/taxi/issues/3), gates #25.

## Per-source verdicts

**RIX airport**
- **Official API: none.** No public flight-data API or open-data set; data.gov.lv has nothing for RIX. (Note `rix.lv` is an unrelated logistics firm — the airport is riga-airport.com.)
- **Scraping riga-airport.com: mapped but blocked.** The board is fed by Drupal AJAX endpoints (`/en/api/flight/list?_wrapper_format=drupal_ajax` etc.) that do include actual arrival times — but as HTML embedded in JSON, and the site sits behind a Cloudflare managed challenge (403 on plain requests). Desperation option only.
- **[AeroDataBox](https://aerodatabox.com/pricing/): recommended.** FIDS endpoint for `RIX`/`EVRA` with arrivals-only queries and scheduled/estimated/actual times. Marketplace plans: free 600 units/mo (enough to validate data quality), Pro ~$5.35/mo (~poll every 15 min), Ultra ~$30/mo (~every 90 s). Commercial use allowed on paid plans; API-key auth; no caching prohibition found (read full ToS before committing).
- **[Flightradar24 official API](https://fr24api.flightradar24.com/subscriptions-and-credits): fallback.** Explorer $9/mo, 30k credits, commercial flag set — but no arrivals-board endpoint (compose from flight-summary filtered on RIX) and stricter redistribution terms.
- **Rejected:** FlightAware AeroAPI (commercial tier has a $100/mo minimum — the whole platform budget; the free tier is non-commercial), aviationstack ($49.99/mo for less), Aviation Edge ($299/mo), OpenSky (arrivals endpoint is a next-day batch).

**Autoosta (Rīgas starptautiskā autoosta)**
- **[ATD GTFS](https://data.gov.lv/dati/eng/dataset/atd-gtfs): recommended, and the only legal source.** Autotransporta direkcija publishes the national intercity bus timetable as GTFS, **CC0 license, daily updates, no auth** (`gtfs-latvia-lv.zip`, ~30 MB). Verified by download: `stops.txt` contains "Rīgas SAO" (stop_id 11382) and `stop_times.txt` gives every trip's scheduled arrival there. **No GTFS-RT** — scheduled times only; no public delay/actual-time feed for intercity buses exists.
- **autoosta.lv: nothing to consume.** The timetable page is a gateway of ticket-partner logos; real-time arrivals exist only on the physical hall tablo / paid phone line.
- **1188.lv: ToS-banned.** Terms explicitly prohibit automated downloading and database reproduction — do not scrape.

## Recommendation & cost

- RIX ingestor: **AeroDataBox**, start on the free tier to validate RIX actual-time fidelity, then Pro (~€5/mo) — Ultra (~€28/mo) only if 15-min polling proves too coarse. Well inside the <€100/mo guardrail.
- Autoosta ingestor: **ATD GTFS daily refresh**, filter `stop_times` on stop 11382 — free.
- Both plug into the `DemandSignalProvider` seam; the manual dispatcher-alert fallback from the decision rule is not needed.

## What it means for #25

Viable — build automated polling ingestors. Re-scope the autoosta signal to **scheduled arrival ± buffer** (no live delay data exists), which is fine for demand-wave purposes: Dina's anketa point (S8-5) was about knowing when buses come in, and the schedule provides that. RIX signals can use estimated/actual times for real precision.
