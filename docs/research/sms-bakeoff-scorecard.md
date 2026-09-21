# SMS provider bake-off — scorecard (#137)

**Run date:** — · **Run by:** — · **Rates re-observed on:** — · **Twilio account tier:** trial / paid

Cells marked `observed` are **blank until the run**. A cell filled from a vendor's own page is
labelled `vendor docs` and is **not** evidence of delivery: #137 asks for handset results, "not
vendor claims", and blurring the two is the thing it forbids.

## Result

### Decisive rows — these settle the switch

| # | Criterion | Provenance | Twilio | BulkGate | BudgetSMS |
|---|---|---|---|---|---|
| 1 | Delivered to **LMT** (`n/3` rounds) | observed | | | |
| 2 | Delivered to **Tele2** (`n/3`) | observed | | | |
| 3 | Delivered to **Bite** (`n/3`) | observed | | | |
| 4 | Sender reads `SaktaCab` — LMT / Tele2 / Bite | observed | | | |
| 5 | LV diacritics intact (probe 2) | observed | | | |
| 6 | RU Cyrillic intact (probe 3, round 1) | observed | | | |
| 7 | 2-segment message arrives as **one** message | observed | | | |
| 8 | Failed send — the thrown `Error.message`, verbatim | observed | | | |

### Informational rows — context, never the deciding vote

| # | Criterion | Provenance | Twilio | BulkGate | BudgetSMS |
|---|---|---|---|---|---|
| 9 | Median time to inbox, OTP (±5 s — two clocks) | observed | | | |
| 10 | Median time to inbox, 2-segment probe | observed | | | |
| 11 | Segment count the API reported for row 7 | observed | | | |
| 12 | Rate per segment, re-observed today | observed | | | |
| 13 | Delivery receipts available | vendor docs | status callbacks | advanced API | `/pullDlr/` |
| 14 | EU processor | vendor docs | US by default | CZ | NL |
| 15 | Support in EU hours | vendor docs | | | |
| 16 | Credentials + body travel in the URL | code | no (POST form) | no (POST JSON) | **yes — GET only** |

**Row 11 settles an open `expected`.** The implementation counts BulkGate segments from `part_id`
entries matching `/_\d+$/`, because the vendor's documented example returns *three* ids for a
two-part message. Record the raw `part_id` array here, not only the count.

**Rows 1–3 are not a delivery rate.** Three observations catch a **broken** route, not a **flaky**
one — they cannot separate 99% from 90%. Write `3/3`; never write "100%".

**Row 9–10 precision.** Time-to-inbox is `sent at` (script stdout) → the handset's own SMS
timestamp. Both devices on network time, recorded to the second. **Differences under 5 s are clock
noise, not latency** — do not report a figure finer than that.

## Prerequisites

A day booked without all of these produces a partial scorecard.

- [ ] Three LV SIMs — **LMT**, **Tele2**, **Bite** — each in a phone whose SMS app shows per-message timestamps.
- [ ] **Accounts the production deploy is not using**, or a deploy bound to Twilio for the duration. Sharing them means a mid-run `low_credit` fails **real riders' OTPs**, and `auth.service.ts:194` releases the resend cooldown, so they retry straight into the same empty balance.
- [ ] Funded **BulkGate** account, application id + token minted. **No free dry-run exists** — the first proof these credentials work costs a segment.
- [ ] Funded **BudgetSMS** account — username, userid, handle. This one *does* have a free pre-flight: `/testsms/`.
- [ ] Twilio tier decided. On a trial, recipients must be console-verified and the sender is the trial number — see the Verdict rule.
- [ ] `BAKEOFF_LMT`, `BAKEOFF_TELE2`, `BAKEOFF_BITE` set to the three handsets in E.164.
- [ ] ~€2 credit per account (€4.33–€4.87 total, `derived` — see the plan's Level 4), so a retried round does not strand the run.

## Steps

Ordered so that a credential fault is found before it wastes a round. Fill the handset columns
within ~10 minutes of each round, while it is still obvious which message was which.

| # | Do | Signal appears in | Expect |
|---|---|---|---|
| 1 | `pnpm --filter @taxi/api sms:bakeoff` with no flags | stdout | The full matrix and its derived spend, **nothing sent**. This is what proves the dry-run default defaults |
| 2 | `--testsms` (BudgetSMS only) | stdout | `OK <id>` per handset, no credit deducted, no SMS |
| 3 | **One** BulkGate probe send to a single handset | stdout + that handset | `accepted` and a message arrives. BulkGate has no free dry-run, so this costs a segment and is the cheapest possible credential proof |
| 4 | Confirm Twilio tier; on a trial, verify the three numbers in the console | Twilio console | All three verified, or the run cannot reach them at all |
| 5 | **Round 1**, morning: `--confirm --round 1` | stdout + three handsets | Rows pasted into the table below; handset columns filled |
| 6 | **Round 2**, midday: `--confirm --round 2` | same | same |
| 7 | **Round 3**, evening: `--confirm --round 3` | same | same |
| 8 | One failure probe per provider — an invalid `to` | stdout | The thrown `Error.message` verbatim → row 8. **BudgetSMS documents no charge** on an `ERR` response (spec V2.7 §2: "no credit is deducted"), so `ERR 2010`/`2011` is free. BulkGate (400 `invalid_phone_number`) and Twilio (400 `21211`) reject at validation and are `expected` not to charge — **not sourced**, so budget for three segments rather than assuming zero |
| 9 | Re-open the three pricing pages | browser | Row 12, with today's date. §4.1's rates are `observed 2026-08-14` and #137 says they move |

**Probe order inside every round: OTP first.** If credit runs out mid-round, the criterion that
survives is the one on the login path — which is what #137 is protecting. The 2-segment probes are
the encoding test and can be re-run; a missing OTP result makes the whole round uninformative.

### Raw run log

Paste the script's rows here, unedited.

| round | provider | operator | template | sent at (UTC) | api result | api segments | received at | sender shown | body intact |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

## Verdict

**Switch to a candidate only if it matches Twilio on rows 1–7 and row 8 is legible.** Specifically:

- Any **0/3** on rows 1–3 disqualifies that provider outright.
- **Sender stripped** on any operator (row 4) disqualifies. An OTP from an unknown number is a trust
  cost and a support cost, not a cosmetic one.
- **Mangled text** (rows 5–6) disqualifies. Transliteration was ruled out in §4.2 and is not a remedy.
- A **split** 2-segment message (row 7) does not disqualify on its own — record it and decide.
- **Price (row 12) is the tiebreaker, never the criterion** (§4.1). It breaks a tie between
  qualifying candidates; it never promotes a failing one.

**On a trial Twilio account, the verdict has exactly two legal forms.** A trial cannot use an
alphanumeric sender and cannot reach unverified riders, so "keep Twilio" is not a validated outcome:

1. **"Switch to X"** — X qualified on rows 1–7. Twilio's unscorable sender cell does not block this:
   the question was whether the *candidate* preserves `SaktaCab`, and the candidate's own cells
   answered it.
2. **"No candidate qualified; Twilio must still be re-validated on a paid account before pilot."**

**This scorecard does not close #137 by itself.** #137 closes when the grid is filled and either the
switch has shipped or the reason not to is recorded here.
