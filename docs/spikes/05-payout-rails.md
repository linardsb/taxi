# Spike #5 — driver payout rails: Stripe Connect vs SEPA batch

**Verdict: SEPA batch (pain.001) for the pilot; build the Stripe Connect slice in test mode in parallel and switch to Connect when in-app card payments go live post-SIA.** Issue [#5](https://github.com/linardsb/taxi/issues/5), gates #12.

## Evidence

**Stripe Connect.** Latvia is supported for Express and Custom connected accounts ([docs](https://docs.stripe.com/connect/accounts)); individual (natural-person) accounts are EU-standard, though the LV-specific KYC column couldn't be verified — confirm in test mode (5-min check). Payouts to LV banks: first ~7 calendar days, then 3 business days; Instant Payouts listed for LV at 1% ([payouts](https://docs.stripe.com/payouts), [instant](https://docs.stripe.com/payouts/instant-payouts)). Cost: €2/active account/mo + 0.25% + €0.10 per payout ([LV pricing](https://stripe.com/en-lv/connect/pricing)) — ~€12–13/mo for 5 weekly-paid drivers, well inside budget. The blocker: **real money requires a live activated platform account**, which effectively needs a legal entity — and the repo rule keeps Stripe in test mode until the SIA exists. Test mode does cover the entire Connect loop (Express onboarding, simulated KYC, test payouts, webhooks) ([testing](https://docs.stripe.com/connect/testing)), so #12's Stripe implementation can be fully built and integration-tested pre-SIA.

**SEPA batch.** Swedbank LV imports pain.001 in the business internet bank and explicitly serves sole proprietors (pašnodarbinātais): €5/mo (€0 first year), €0.36 per European payment ([import](https://www.swedbank.lv/business/d2d/payments/import), [pricelist](https://www.swedbank.lv/business/pricelist)). **Only pain.001.001.09 accepted from 2026-11-22 — generate .09 from day one.** Paysera is the fallback: accepts pain.001.001.03, free SEPA transfers, has an API ([format](https://developers.paysera.com/en/file-formats/xml)). Revolut Business is out — sole traders can't open it. Manual effort per run once a generator module exists: ~5–10 min (export XML from ledger → upload → Smart-ID approval); the human approval step is unavoidable.

**Unresolved input:** Atis's legal/tax status (PRD open question). Either rail requires drivers to be payable natural persons; paying an unregistered individual is a platform-side tax problem no rail solves. Pre-SIA the platform side needs Linards registered as pašnodarbinātais to open the Swedbank business account.

## Recommendation

1. **Pilot (pre-SIA):** pašnodarbinātais registration → Swedbank business account → weekly pain.001.001.09 batch generated from the ledger, manual upload + approval. Paysera as backup rail.
2. **Post-SIA:** keep SEPA batch live while activating Stripe; cut over to Connect payouts when in-app card payments launch (money then already sits in Stripe).
3. **Now, for #12:** implement the Connect flow in test mode only.

## What it means for #12 (seam design)

The `PayoutProvider` seam stays provider-agnostic and must abstract over:
- **Destination**: opaque `payoutDestinationRef` + provider tag (Stripe account id vs raw IBAN + legal name we hold).
- **Readiness**: `getPayoutReadiness(driver)` — Stripe has async KYC states; the bank rail is just "IBAN valid".
- **Execution model**: per-payout API call with webhook confirmation vs **batch file + human approval** — the seam needs batch assembly, an "exported/awaiting-approval" state, and manual reconciliation, not just `sendPayout()`.
- **Confirmation**: `payout.paid`/`payout.failed` webhooks vs bank-statement (camt.053) matching — every payout carries a platform-generated EndToEndId, amounts in integer cents EUR.
- **Fees/timing metadata** exposed per rail so driver-facing UI never hardcodes them.
