# Card-only payments and the phone-booking pay path

**Provenance.** This note was written for `plan-architecture` on 2026-10-04, from a research-agent pass. Part A comes from reading the code on `main` at `658d052` (`observed`). Part B is external: lines marked "verified" were read by the agent on the source page, and the rest are the agent's report. The agent could not load the Autopārvadājumu likums 35.² text, so that wording was re-checked against raw likumi.lv HTML in `vid-platform-reporting.md` (Verification pass section).

**Decision context:**
- Linards chose card-only on 2026-10-04 (see the architecture doc, "Payments: card-only").
- Phone riders pay through an SMS payment link (decided in the compliance PRD, `docs/epics/sakta-cab-compliance.prd.md`).

## Part A — card payment in the code today

**Summary: card payment is designed but not reachable end to end.**

- **One charge after the ride, no hold.** The charge happens off-session at `POST /rides/:id/settle`, after `completed` (`settlement.controller.ts:52-53`, `settlement.service.ts:84-100`, `stripe-payments.provider.ts:165-180`). The code never uses manual capture (`:132`). A failed card surfaces after the ride as a 402, so the driver carries that risk.
- **3DS is treated as a decline.** `requires_action` counts as declined (`:145`), and no webhooks exist (`payments/index.ts:35`).
- **The split is fixed when the driver accepts.** `resolveCommissionPct` runs at offer build (`dispatch/offer-builder.ts:56`). Settlement reads the stored split (`settlement.service.ts:199-225`).
- **The ledger treats the platform as the merchant.** It writes six double-entry lines per ride. For a card ride the platform collects the fare and owes the driver the net (`ledger/settlement-entries.ts:77-148`, `:142-147`).
- **No Stripe Connect.** There is no `transfer_data`, `application_fee`, `on_behalf_of` or `SetupIntent` anywhere.
- **No carrier anywhere in the money path.** Ledger owners are platform, driver and rider (`db/src/schema/enums.ts:57`). There is no invoice code; the receipt work (#15) never landed (`earnings.controller.ts:10`).
- **No card can actually be charged:**
  - `users.payment_instrument_ref` is never written (`db/src/schema/users.ts:30`); saving a card is #17, still open.
  - Production binds `CardPaymentsDisabledProvider` (`payments.module.ts:51-52`).
  - The seam has only `charge()` (`packages/shared/src/seams/payments-provider.ts:94-96`).
- **Cash is the main path today:**
  - `BOOKABLE_PAYMENT_METHODS` is `['cash', 'card']` (`packages/shared/src/enums.ts:31`).
  - Settlement skips the payment provider for cash (`settlement.service.ts:289`).
  - Phone orders default to cash (`phone-orders/booking-draft.ts:87-89`).
- **Spike #5 (closed)** chose a SEPA batch for the pilot and Stripe Connect after the SIA exists (`docs/spikes/05-payout-rails.md:3,13-17`). Its Connect figures are inherited and were not re-checked.

## Part B — external facts

| Topic | Fact | Source |
|---|---|---|
| Hold and capture | Checkout Sessions accept `payment_intent_data[capture_method]=manual` (verified). A one-off Session per ride fits better than a reusable Payment Link. | docs.stripe.com/payments/place-a-hold-on-a-payment-method |
| Hold length | Online cards: 7 days when the customer is present. Merchant-initiated: Visa about 4 d 18 h, other brands 7 days. | same |
| Capture less | `amount_to_capture` captures part of the hold and releases the rest. One capture per payment. | same |
| Raise the hold | Incremental authorisation exists online in the EU, but only on IC+ pricing. Fares are fixed when the driver accepts, so a hold for the quote should cover nearly every ride. | docs.stripe.com/payments/incremental-authorization |
| 3DS / SCA | Checkout handles it while the rider is paying. Charging later off-session needs `setup_future_usage=off_session`, and exemptions "aren't guaranteed". | docs.stripe.com/strong-customer-authentication |
| Connect in Latvia | Standard, Express and Custom accounts, individual and company. How an IK maps onto these is unconfirmed. | Stripe Connect docs |
| Destination charges | Stripe names ride-sharing as the fit. The platform pays Stripe fees, refunds and disputes even with `on_behalf_of` (verified). | docs.stripe.com/connect/destination-charges |
| Merchant of record | With `on_behalf_of`, the carrier is the "settlement merchant" (its descriptor, its country's fees). Without it, "the platform is the business of record" (verified). The carrier needs the card-payments capability. This is Stripe's term, not a VAT ruling. | same |
| Invoice in the carrier's name | Stripe Invoicing with `on_behalf_of` or `issuer` shows the carrier's name and tax ID. Plain Checkout receipts show the platform. | docs.stripe.com/invoicing/connect; docs.stripe.com/payments/checkout/receipts |
| Invoice content (LV) | Grāmatvedības likums 11. (5): document name, date, number, issuer name and registration code, other party, description, amount. 11. (7) 2): no signature needed for a private person. | likumi.lv/ta/id/324249 |
| VAT invoices | PVN likums 125.: full invoice details. 126.: simplified invoice under €150; under €30 a receipt without buyer details. Standard rate 21%; 12% applies only to "regular" passenger transport, so 21% for these rides is an inference. Registration threshold €50 000. | likumi.lv/ta/id/253451 |
| E-invoice mandate | Structured e-invoices are business-to-business only, from 1.1.2028. Passengers are outside it. | — |
| Cash register | MK 96 p. 3 covers cash and card payments. No exemption for online card payments was found in p. 82 or 84. | likumi.lv/ta/id/265487 |

## Options for the architecture

| Id | Option | For | Against |
|---|---|---|---|
| P1 | Destination charge with `on_behalf_of` the carrier: hold the quoted fare at booking (Checkout in the app; the same Session sent by SMS for a phone order), capture at settle with `amount_to_capture` plus a 15% `application_fee_amount`, and issue a Stripe invoice in the carrier's name | Matches "the carrier provides the transport"; automatic payouts, so the SEPA batch retires | Every carrier passes Stripe KYC before its first ride; the platform still absorbs disputes; needs a carrier entity, webhooks, and authorise, capture and cancel in the seam |
| P2 | Platform as merchant (separate charges and transfers) | Closest to today's ledger; carriers need no Stripe account | The platform appears to sell the ride: conflicts with an invoice in the carrier's name and may make the platform the VAT-liable seller |
| P3 | P1's money flow, but the platform generates the invoice itself (PVN 125/126, carrier's name, possibly self-billing) from the per-ride data MK 541 already requires | Full control of content and LV/RU/EN wording | The platform owns invoice numbering and its compliance |

## Questions for a lawyer or accountant

- Does `on_behalf_of` make the carrier the seller for VAT? Does the 15% commission carry 21% VAT, invoiced to the carrier?
- May the platform issue invoices in the carrier's name (self-billing)? Who numbers them?
- Is 21% the right VAT rate for app-booked passenger-car rides?
- Do VAT-unregistered IK and individual carriers need different invoice details?
- Does MK 96 (cash register) apply to rides paid online by card? A VID document reportedly says a bank statement suffices; the agent could not read it.
- Contractually, who bears disputes and failed captures: the platform or the carrier?
