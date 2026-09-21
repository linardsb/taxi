# Implementation Report — Shorter tracking links + trimmed LV/RU SMS templates, 1 segment (#136)

**Plan**: `.claude/plans/short-tracking-links-sms-136.md`
**Branch**: `feature/short-tracking-links-sms-136` (worktree `/Users/Berzins/taxi-worktrees/wt-136`, off `origin/main` at `246ae4b`)
**Status**: **PARTIAL** — Phases 1–5 complete and the gate green; **AC #0** (Phase 0's linkification
spike) is now met on substitute oracles rather than a handset, and it confirmed what shipped — see D1.
**Level 4 steps 1–2** were not run: D8, still Linards' and not more code.

## Summary

Both linked rider SMS now render **one billed segment in LV, RU and EN at the maximum of every bound**.
Four changes together: a 10-character host ceiling refused at production boot, a 12-byte (16-char) tracking
token, the polite framing and the `https://` scheme dropped, and `?lang=` replaced by a one-character path
segment served by two Next.js rewrites. `@taxi/shared` gains the first two things in the tree that can
count a billed segment and build a tracking link — `smsSegments()` and `trackingLink()` — which is what
lets the API's minted link and the dispatch app's routing be pinned to each other in one test.

## Tasks completed

| Task | File | |
|---|---|---|
| GSM-7/UCS-2 billed-segment counter | `packages/shared/src/sms-segments.ts` | CREATE |
| its unit tests | `packages/shared/tests/sms-segments.test.ts` | CREATE |
| link builder, language paths, the four budget constants | `packages/shared/src/tracking-link.ts` | CREATE |
| link shape / scheme / path tests | `packages/shared/tests/tracking-link.test.ts` | CREATE |
| **the AC #1 budget proof** | `packages/shared/tests/sms-budget.test.ts` | CREATE |
| `trackingTokenSchema` 22 → 16, doc comment | `packages/shared/src/schemas/tracking.ts` | UPDATE |
| six catalog values + the LV header's wrong 160 | `packages/shared/src/i18n/{lv,ru,en}.ts` | UPDATE |
| `formatMessage` expected string; 16-char fixture + a 22-char rejection case | `packages/shared/tests/{i18n,tracking}.test.ts` | UPDATE |
| two new barrel exports | `packages/shared/src/index.ts` | UPDATE |
| `randomBytes(16)` → `randomBytes(12)` | `…/notifications/tracking/tracking.service.ts` | UPDATE |
| `trackingLink` removed, `smsDriverName()` added | `…/notifications/sms-templates.ts` | UPDATE |
| its spec (the file's header had claimed one existed) | `…/notifications/sms-templates.spec.ts` | CREATE |
| `sendSms` + the multi-segment warn; ETA clamp; name bound | `…/notifications/ride-notifications.service.ts` | UPDATE |
| `?lang=` / token / clamp / warn cases | `…/notifications/ride-notifications.service.spec.ts` | UPDATE |
| host-budget boot gate + field doc | `…/common/config/env.schema.ts` | UPDATE |
| gate cases + `prod()` fixture host | `…/common/config/env.schema.spec.ts` | UPDATE |
| remaining 22-char sites | `notifications.policy.ts`, `tracking.service.spec.ts`, `tracking.integration.spec.ts` | UPDATE |
| two rewrites | `apps/dispatch/next.config.ts` | UPDATE |
| **the api↔dispatch round trip** | `apps/dispatch/src/app/t/tracking-rewrites.test.ts` | CREATE |
| 22-char token fixtures | `apps/dispatch/src/features/tracking/tracking-{live,page,data-route}.test.*` | UPDATE |
| §4.2–4.3, with the `?lang=ru` omission named | `docs/research/hosting-sms-cost-research.md` | UPDATE |
| env row, dotenv template, boot-gate failure table, §2.2 | `docs/runbooks/hetzner-deploy.md` | UPDATE |

`scripts/mint-tracked-ride.ts` was read: it prints `${token.length} chars` but asserts no length, so it
needed no change.

## Tests added

| Package | File | Cases |
|---|---|---|
| shared | `sms-segments.test.ts` | 6 |
| shared | `tracking-link.test.ts` | 6 |
| shared | `sms-budget.test.ts` | 7 (6 table rows + the zero-spare RU edge) |
| shared | `tracking.test.ts` | +1 (22-char token now rejected) |
| api | `sms-templates.spec.ts` | 6 |
| api | `ride-notifications.service.spec.ts` | +4 (ETA clamp · name bound · warn fires and still sends · warn silent on a budgeted body) |
| api | `env.schema.spec.ts` | +3 (8-char host accepted · 11-char refused with the message · trailing slash not counted) |
| dispatch | `tracking-rewrites.test.ts` | 4 |
| | **total** | **+37** |

`derived` from per-file `it(` counts against `origin/main` (shared +20, api +13, dispatch +4).

## Validation results

**The gate — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck
lint test build --force`, `dist` and `.next` cleared first: `observed` GREEN at `5e515a1`, exit 0,
22 successful / 22 total, 0 cached, 1m31.041s.**

**RE-ANCHORED after PR #245's review round 1.** This table first recorded a run at the pre-review head and
went stale the moment that round's fixes added tests — the exact failure mode CLAUDE.md warns about, with
this file as one of the four surfaces a figure gets copied to. Every row below is from the single run
named above, not carried over.

| Suite | Result | |
|---|---|---|
| `@taxi/api` | `Test Suites: 81 passed, 81 total` · `Tests: 786 passed, 786 total` | `observed`, in the gate |
| `@taxi/shared` | 27 files, 255 passed | `observed` |
| `@taxi/dispatch` | 29 files, 268 passed | `observed` |
| `@taxi/driver` | 44 suites, 250 passed | `observed` |
| `@taxi/rider` | 30 suites, 145 passed | `observed` |
| `@taxi/db` | 3 files, 17 passed | `observed` |

**Nothing is skipped in this run, and that is a change in METHOD, not in the suite.** `REDIS_TEST_URL` is
set here to match `REDIS_PORT=6381`, as CLAUDE.md directs and as CI does, so the documented Redis-gated
set runs instead of reporting as 39 skipped across 4 files (2 of which hold nothing else and so showed as
skipped suites). The earlier figures on this PR — `2 skipped, 79 passed, 79 of 81` and `39 skipped, 746
passed, 785 total` — were a run WITHOUT it, and reconcile exactly: 746 + 39 = 785, and 785 + 1 for the
case round 1 added at `ride-notifications.service.spec.ts` = 786.

**`tracking.integration.spec.ts` is not in the gated set either way** — plain `describe`, no
`REDIS_TEST_URL` guard — so the `{16}` token-shape assertion executed against real Postgres. Re-run alone
to be sure: `Test Suites: 1 passed · Tests: 13 passed` (`observed`).

**The AC #1 test was proved to bite, both halves** (`observed`):

1. Restoring `Sekojiet līdzi: ` to LV `driver_assigned` → **1 failure**, and it is the **length**
   assertion that fires first: `expected … to have a length of 69 but got 85`. Only the LV row reddens.
2. `TRACKING_LINK_HOST_MAX_CHARS` 10 → 11 → **all 8 assertions fail, every one on length**: LV 69→70,
   RU 70→71, EN 68→69, the three `booking_confirmed_phone` rows 59/55/50 → 60/56/51, the zero-spare
   RU case, and the over-ceiling negative round 1 added (71→72). No segment assertion fires at all,
   because `toHaveLength` throws first in every case — and that is the point.
   **At host 11, 5 of the 6 bodies still bill one segment** (`observed`, re-run through `dist`: only RU
   `driver_assigned` at 71 tips to 2), so a segment-only test would have caught one row out of six and
   let the budget be widened on the other five. Both reverted; suite green after.

   **Was 7 before PR #245's review round 1**, which added the file's only negative (F9). Both halves were
   re-run at `5e515a1` rather than carried over: half 1 is still exactly **1 failure** at `length of 69
   but got 85`, and half 2 is now **8**.

## Level 4 — manual validation

**Step 3 (the rewrite serves the page) — PERFORMED**, by `curl` against `next dev -p 3099` rather than a
browser (`observed`, token `YrnNuRP4yjcmESjc`):

| Probe | Result |
|---|---|
| `GET /r/<token>` | `http=200`, `redirect_url=[]`, `url_effective` still `/r/<token>` — a **rewrite, not a redirect** |
| its rendered copy | `<title>Ваша поездка</title>`, `<main lang="ru">` — `searchParams` survives the rewrite |
| `GET /e/<token>` | English (`Your ride`) |
| `GET /t/<token>` | Latvian (`Jūsu brauciens`) — the real route, no rewrite |
| `GET /t/<token>/data` | **502**, not 404 — the island's absolute poll path resolves and reaches the API proxy (the API was not running, which is what 502 means here) |
| `GET /r/<token>/data` | 404 — confirms why `tracking-map.tsx:99` must keep the absolute `/t/` path, as it does |

`<html lang="lv">` with `<main lang="ru">` is pre-existing and deliberate (`layout.tsx:17` says so);
identical on `?lang=ru` at `origin/main`, so the rewrite changed nothing there.

**Steps 1–2 (boot the API, mint a ride, read the logged body) — NOT RUN** (see D8). The substitute, which
covers what a `src`-importing test cannot — a body rendered through the built `dist` with a freshly minted
token at the real `sakta.lv` and the issue's own worst-case name *Aleksandrs* (`observed`):

| Body | Chars | Segments |
|---|---|---|
| `Водитель Aleksandrs, LV-1234, ~7 мин sakta.lv/r/Z_sec-IHbwoeTCDm` | 64 | **1** |
| `Šoferis Aleksandrs, LV-1234, ~7 min sakta.lv/t/Z_sec-IHbwoeTCDm` | 63 | **1** |
| `Ваше такси забронировано. sakta.lv/r/Z_sec-IHbwoeTCDm` | 53 | **1** |
| `Jūsu taksometrs ir rezervēts. sakta.lv/t/Z_sec-IHbwoeTCDm` | 57 | **1** |

Each matches the budget arithmetic at a real 8-character host: RU 19+10+7+1+8+3+16 = 64, LV
18+10+7+1+8+3+16 = 63, RU `_phone` 26+27 = 53, LV `_phone` 30+27 = 57.

**AC #2's premise re-verified this session** (`observed` 2026-09-21): `gh run list --workflow=deploy.yml`
returns empty (the workflow exists, so the query is not vacuous) and `gh issue view 13` is `OPEN`. No
22-char link has ever been deployed, so the hard cut is safe.

## Deviations from the plan

**D1 — Phase 0 ran late and on substitutes for a handset; AC #0 is met and the fallback is not taken.**
The plan put the spike before any code, and there it did not run: it needs a verified handset and a person
looking at it, so everything downstream was built on the primary branch (scheme dropped) under **stated
assumption A2**. The spike has since run, `observed` 2026-09-21, against two substitutes — **Google
Messages** on an Android 16 emulator (each of LV, RU and EN injected with `adb emu sms send`, then tapped:
all three produced `ActivityTaskManager: START … VIEW dat=https://sakta.lv/…` into Chrome) and
**`NSDataDetector`** on macOS 15.7.3 Foundation, the class iOS's link detection is built on (exactly one
link match in each of the six shipped bodies). The scheme-less link linkifies; the branch already taken is
the one the evidence dictates; no shipped line changed. What the substitutes do **not** close is leg (b),
glyph fidelity end-to-end (the emulator console builds its own PDU), and leg (c), a vendor's own
`num_segments` (this tree has no funded SMS account). The plan's AMENDMENTS carries the full result, the
`logcat` lines and the limits.

**The branch not taken, kept because it is what a negative result would have cost.** One line: restore the
scheme in `trackingLinkHost`/`trackingLink`, drop the two `driver_assigned` rows from
`sms-budget.test.ts`'s `EXPECTED_LENGTH`, and amend AC #1.
`booking_confirmed_phone` stays 1 segment in all three languages with the scheme (`observed` through the
built `dist` at the real 8-char host: LV 57+8 = 65, RU 53+8 = 61, EN 48+8 = 56, all ≤ 70), so the saving
does not vanish — it drops to **129 segments/mo, worst case**. The arithmetic, since none of it was shown
before (PR #245 F10):

- **As shipped, 258/mo.** Two linked templates × 1 segment saved each × **129 phone rides/mo**. The 129 is
  `derived` in research §4.3 as 30% of 430 rides/mo, and **§4.3 labels that 30% share as having no
  evidence** — it is a "tracked, no target" metric. The 430 is itself the PRD's month-3 success condition,
  i.e. the busiest month the pilot aims at, not its average. Every figure in this bullet inherits both.
- **With the scheme restored, 129/mo.** `booking_confirmed_phone` keeps its saving on all 129 rides;
  `driver_assigned` loses its own, because it goes back over 70 (`observed`, same host: LV 75 / 2 seg,
  RU 76 / 2 seg). So 129 × 1 + 129 × 0 = 129.
- **Why worst case and not the only case.** EN `driver_assigned` renders 74 characters *with* the scheme
  and stays **1 segment** — GSM-7 has 160 septets, not 70 — so every EN phone ride keeps its second
  saving too. 129 assumes no EN riders; the ceiling is 258 and the true figure sits between, on a
  language mix nothing here predicts.
- **It equals the ride count by construction**, not by transcription: one segment saved per ride on one
  surviving template.

**What is still owed to a real handset**: legs (b) and (c) — a carrier's UCS-2 round trip, and a
vendor's `num_segments` as an independent check on `smsSegments()`. Neither blocks this PR, and both are
cheaper to take on #137's bake-off day, which needs a funded account and three LV SIMs regardless.

**D2 — `trackingLinkHost()` is a new exported function the plan did not specify.** The plan had the boot
gate re-implement the scheme/slash stripping with its own `.replace` pair. Two regexes that must agree is
a way to be off by one and refuse a domain that actually fits, so the gate now calls the link builder's
own function. Added public API surface in `@taxi/shared`, one line.

**D3 — the `prod()` fixture host changed in `env.schema.spec.ts`.** `https://track.example.com` is a
17-character host and now refuses to boot, so **every production env case in that file** runs under
`https://sakta.lv` instead. Benign, but it is a fixture-wide change, not a local one.

**D4 — `sms-segments.test.ts` ships 6 cases, the TESTING STRATEGY said 7.** The plan's `'€' alone → 2
septets` is not assertable through a function that returns segments, so it became the sharper boundary
**pair** — 158 ASCII + `€` = 1 segment, 159 + `€` = 2 — which fails if `€` ever costs one septet. Same
property, one case.

**D5 — the plan's dist grep recipe returns 0, and does not mean what it looks like.**
`grep -c "smsSegments\|trackingLink" packages/shared/dist/index.d.ts` → **0**, because `index.d.ts` is an
`export *` barrel and carries only module names. Substituted a stronger check: `node -e` against
`./packages/shared/dist` resolving `smsSegments`, `trackingLink`, all four constants and
`TRACKING_PATH_BY_LANGUAGE` at runtime (`observed`, all present).

**D6 — Level 5's grep is NOT empty, and reporting it as empty would be false.** The pattern
(`22\b` ∧ token|base64url|char) is broad. Every hit outside `.claude/` was read: `22/80/443` firewall
ports and `22:21` timestamps in the runbooks, `CX22` in the traceability map, `2022–2026` in the
architecture doc, `at 22 chars the OTP is 1 segment` in `bulkgate-sms.provider.ts` (that is
`sms.otp_code`'s own length, unchanged by this ticket, still correct), and the four **deliberately
historical** statements — the research doc's pre-#136 baseline rows and the cut-over rejection test with
its doc comments. Nothing live and wrong survives; the AC is met in substance, not by an empty grep.

**D7 — the research doc keeps the old figures in past tense rather than overwriting them.** The plan asked
for the `?lang=ru` omission to be *named*, which requires the numbers it corrects to stay visible. §4.3
now opens with a CORRECTION block and the old table is labelled "as proposed, pre-#136".

**D8 — Level 4 steps 1–2 were not run.** They need the API booted against compose, `mint-tracked-ride.ts`
driving a phone-channel Russian ride to `accepted`, and the stub provider's logged body. What they add
over `ride-notifications.service.spec.ts` — which already runs the real service through the real
`formatMessage` and the real `trackingLink` at the real env value — is the repository-row wiring. The
dist-rendered table above covers the measurement half. Recorded as not-run rather than implied.

**D9 — one extra runbook edit beyond the plan's two.** The plan named the env row and the boot-gate table.
The dotenv template also had `CORS_ORIGINS=https://dispatch.example.lv` beside the new
`PUBLIC_TRACKING_BASE_URL`, and those are **the same origin by definition** (§2.2, `env.schema.ts:306`) —
a reader copying it would point SMS links at a domain the dispatch app is not served from. Both are now
`https://sakta.lv`, and §2.2 states the consequence #13 has to act on: **the 10-character gate constrains
the dispatch app's own domain**, not a separate tracking host.

**Declared UX states, ticked.** This ticket has no new surface and adds no state to one. The dispatch
tracking page's loading / empty / error / offline states are untouched — the rewrite reaches
`/t/[token]` at the same entry point `?lang=ru` did, verified above at runtime. The in-page language
switcher deliberately keeps emitting `?lang=` (`page.tsx:167`): the budget is on the SMS, not on a link
tapped inside a page the rider already has open. No new user-facing string; the six changed catalog values
are edits to existing keys in all three languages.

## Issues encountered

- **`next dev` rewrites `apps/dispatch/AGENTS.md` on every run**, dirtying the tree with an unrelated
  change (the file's own new text says so). Reverted — it does not trace to this ticket — but any session
  that runs the dispatch dev server will see it again.
- **jest's `expect` takes no label argument**, unlike vitest's. The bound assertion in
  `sms-templates.spec.ts` was rewritten to filter for offenders and assert an empty array, so a failure
  still names *which* input blew the bound.
- **`eslint .` in `packages/shared` reports 78 errors from `dist/`**; the package's own `lint` script
  scopes to `{src,tests}` and is green. Use `pnpm --filter @taxi/shared lint`, not a bare `eslint .`.
- **No new migration** — 0 files under `db/migrations/` in the diff; the tip stays
  `0010_smooth_white_queen.sql` (`observed`). No DB skew for concurrent sessions.
