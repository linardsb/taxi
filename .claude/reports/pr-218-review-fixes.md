# PR #218 review fixes — round 1

**Review**: `.claude/code-reviews/pr-218-review.md` (round 1 — Request changes: one High, five
Mediums, three Lows)
**PR**: [#218](https://github.com/linardsb/taxi/pull/218) · branch `feature/driver-device-day-prep`,
**OPEN** at the time of fixing (`observed` — `gh pr list --head feature/driver-device-day-prep`)
**Fixed in**: the commit this report ships in (head-independent on purpose — a sha written here is
wrong the moment the commit carrying it is made) · base `main` @ `b690e91`, unmoved

## Triage

All nine fixed. Nothing deferred that belongs to this PR; two items outside it are logged below.

| # | Sev | Call | Why |
|---|---|---|---|
| F1 | High | **Fix now** — doc half only | The `eas-cli init` run itself needs Linards's Expo credentials and cannot be done by an agent. The runbook is corrected so §2 runs as written; whether the project link is *committed* before the day is Linards's call (see **Owed to a human**). |
| F2 | Medium | **Fix now** | Step 7's second absence was unreachable — the exact defect shape this ticket exists to retire. |
| F3 | Medium | **Fix now** | A healthy stream could read as ❌ on a binary step. |
| F4 | Medium | **Fix now** | PR body figure attribution. |
| F5 | Medium | **Fix now** — fallback, not the prescribed fix | The reviewer's `eas env:create` is the alternative the plan already weighed and rejected with reasons (`driver-device-day-prep.md:566-577`); the gap was the missing instruction, not the decision. |
| F6 | Medium | **Fix now** | Threshold sat exactly on the boundary its own throttle produces. |
| F7–F9 | Low | **Fix now** | One-line citation and locale corrections. |

## What was fixed

### F1 — High · no EAS project link, and the runbook denied needing one

**Wrong**: the *What this day does NOT need* table denied `eas init`, and §2's build block was three
copy-paste lines. `apps/driver/app.json` carries no `extra` and no `owner`, and EAS attaches every
build to a linked project — so the `build` line stops on an interactive create-or-link prompt.

**Fixed**: `docs/runbooks/driver-device-day.md` §2 now runs `npx eas-cli@latest init` before the
build and states that it **writes `extra.eas.projectId` into a tracked file**, with the in-repo
precedent (`spikes/gps-harness/app.json:42-47`, which commits both that key and `owner: "linards"`)
and the instruction to commit both keys or `git checkout` the file afterwards. The *does NOT need*
row is narrowed from "`eas init` / an EAS project id" to "an EAS project id **for a push token**".

Kept `expected`, not upgraded to `observed`: the prompt's exact behaviour is inferred from the
asymmetry with the precedent, not seen. The reviewer labelled it the same way. **The stated reason
was wrong and is corrected in round 2** — this said `eas-cli` cannot run here without Expo
credentials; L6's verification ran it, and a signed-in session exists. The label survives its own
justification: what is unexercised is the interactive branch, not the CLI.

**The fix's own new failure mode** (the mechanism pass): `init` dirties a **tracked** file in a
checkout several sessions share — F5's hazard, re-introduced by F1's fix. Addressed in the same
paragraph ("commit those two keys or `git checkout apps/driver/app.json`"). Second-order: once
`extra.eas.projectId` exists, `registerPushToken` stops returning `'no_project'` and returns
`'unavailable'` instead (`register-push-token.ts:43-53`, the `getExpoPushTokenAsync` throw with no
FCM credentials). The F2 note covers **both** paths explicitly, so step 7's absence holds whether or
not `init` has run.

### F2 — Medium · step 7 watched an event that cannot appear

**Wrong**: step 7 read "**no** `driver.push.stub_sent`". With no push token that event is
unreachable — `sendDueNudges` `continue`s at `drivers.service.ts:353-360`, **before** the
`this.push.send` at `:362` that is the only caller of `StubPushProvider.send`.

**Fixed**: step 7 now reads **no `driver.push.nudge_*`** line at all — `nudge_skipped`, `nudge_sent`
or `nudge_failed`. That is the superset of the nudge path's outputs: a due nudge prints exactly one
of them, so the absence stays a live discriminator today (the `no_token` skip) **and** after the
push prerequisites are ever met. Mirrored in the *does NOT need* row, in a new note under the steps
table explaining the chain, and in the plan's C2 signal box (`driver-device-day-prep.md:327-333`)
plus C2's point 5, which named `sendDueNudges` by signature and stopped fifteen lines short of the
guard.

Chosen over the reviewer's narrower `reason: 'no_token'` wording, which goes stale the moment F1's
`init` plus FCM credentials produce a token.

### F3 — Medium · which timestamp to read

**Wrong**: steps 2 and 5 timed `driver.location.ping_accepted` without naming a field, and the line
carries two (`driver-location.service.ts:76-82`). One socket blip inside the unattended 90 s replays
the durable queue as a burst: the server `at`s bunch after a hole, the `clientAt`s stay ~4 s apart.

**Fixed**: both steps say to time it by `clientAt`; a new note gives the mechanism and cites #14's
sheet, which states the field for the same reason (`driver-app-auth-online-location.md:828`).
Mirrored in the plan's C1 signal box (`:290-294`).

### F4 — Medium · PR body figure attribution

**Wrong**: the body printed `pnpm turbo run typecheck lint test build --force` as the command behind
`@taxi/api 733 passed / 77 suites`. Without `REDIS_TEST_URL` that run is 39 tests and 2 suites
short.

**Fixed**: the Validation section now prints the command actually run, env prefix included, and the
figures are re-observed at the fix commit rather than carried over. See **Validation** below.

### F5 — Medium · the committed LAN address

**Wrong**: §0 told the operator to edit `apps/driver/eas.json` and said nothing about the edit's
fate — a dirty tracked file in a checkout several sessions share.

**Fixed**: §0 gains *That edit stays uncommitted* — `git checkout apps/driver/eas.json` once the
build is queued, so the next `piv-commit` cannot sweep a home LAN address into an unrelated PR.

**Not fixed the way the review prescribed, deliberately.** The reviewer's `eas env:create` is the
alternative the plan explicitly weighed and rejected (`driver-device-day-prep.md:566-577`: one place
to look, reviewable in a diff, no invisible stale value) — and dropping the `env` block before that
EAS-side variable exists yields a dead APK, since `apiUrl()` throws in a non-`__DEV__` build
(`apps/driver/src/config.ts:16-18`). The runbook now names the alternative and points at the
decision instead of silently contradicting it; the plan's DECIDED bullet records the completed
day-0 instruction.

### F6 — Medium · "no gap > 8 s" sat on its own boundary

**Wrong**: `selectFixes` measures from the last **kept** fix and drops anything under 4000 ms
(`fix-throttle.ts:64-79`), and `timeInterval: 4000` is an Android *floor* (`location-options.ts:19`)
— so one dropped delivery puts the wire gap at ~8 s against a threshold of exactly 8 s, with a
binary verdict behind it.

**Fixed**: step 5 reads **no `clientAt` gap > 12 s**, and the note shows the arithmetic and its
provenance: `derived` — 3 × `MIN_FIX_INTERVAL_MS` (4 s), tolerating one dropped OS delivery —
explicitly **not** a measurement, since Android delivery jitter cannot be measured without the
phone. The note also restates what the step is about (the stream must not stop), so one gap just
over 12 s is a re-read rather than a ❌. Mirrored in the plan's C1 box.

### F7 — Low · one pointer covering two facts

`distanceInterval: 0` was cited to `fix-throttle.ts:9` (which is `MIN_FIX_INTERVAL_MS = 4_000`).
Now cited separately: the throttle to `fix-throttle.ts:9`, `distanceInterval` to
`location-options.ts:20`.

### F8 — Low · citation stopped two lines short

`stub-sms.provider.ts:28-33` → `:28-37`, with `body` at `:35` named.

### F9 — Low · Latvian-only signals

Steps 1 and 4 give the EN renderings in the same cell (`Online` / `Live` /
`You are on a ride right now.`) and say the app follows the **device** locale
(`deviceLanguage()`, `expo-localization`) — so a test phone set to English is not a mystery.

## The retired-claim sweep (checkable, not a feeling)

Two claims were retired by **subject**, not just by digit. Every `grep -n` below was run against the
fixed tree, over the runbook, the plan, the implementation report, the two sibling artifacts this PR
touches, root `CLAUDE.md`, **and the PR body** (fetched to the scratchpad — no working-tree grep
reaches it).

Counts below are `observed` **after** the last edit, not carried from the sweep that found the
copies — the first draft of this table quoted the pre-edit numbers and was wrong in four of five
rows.

| Retired subject | Command | Hits after the fix |
|---|---|---|
| step 7's `stub_sent` | `grep -rn "stub_sent" docs/runbooks/driver-device-day.md .claude/plans/driver-device-day-prep.md .claude/reports/driver-device-day-prep-report.md .claude/plans/driver-toggle-off-mid-ride-held.md .claude/reports/driver-toggle-off-mid-ride-held-report.md CLAUDE.md` | **12**, none stale: **4** are `auth.otp/sms.stub_sent`, a different event (runbook `:192`, `:194`; plan `:381`, `:834`); **1** is the plan's CONTEXT REFERENCE to the provider (`:158`); **7** are the corrections themselves, naming what was retired (runbook `:198`, `:226`, `:235`; plan `:329`, `:330`, `:352`, `:1388`) |
| the 8 s threshold | `grep -n "gap > 8\|hole > 8\|> 8 s" docs/runbooks/driver-device-day.md .claude/plans/driver-device-day-prep.md` | runbook **0**; plan **2**, both inside corrections — the struck-through C1 box (`:291`) and the AMENDMENTS entry (`:1394`) |
| `eas init` as "not needed" | `grep -n "eas init" docs/runbooks/driver-device-day.md .claude/plans/driver-device-day-prep.md .claude/reports/driver-device-day-prep-report.md` | runbook **0**; plan **5** — `:321` still true in its own context (making step 7's push *real* does need A2 and A1), `:695`/`:1086`/`:1378` are the corrections, `:1365` names #14's file; report **1**, the unrelated `npx eas` package flag |
| the LAN address | `grep -n "192\.168" docs/runbooks/driver-device-day.md .claude/plans/driver-device-day-prep.md CLAUDE.md` | runbook **1** (§0's `observed` interface line); plan **6** (the `eas.json` spec, the DECIDED bullet ×2, the cleartext reasoning, NOTES ×2); `CLAUDE.md` **0**. All correct — the committed value is the plan's live decision, not a retired claim |
| PR body | `grep -n "stub_sent\|8 s\|eas init\|projectId\|192\.168\|clientAt" <body fetched to the scratchpad>` | **2**, both on `eas init`: the saving claim (edited — see F1) and the `npx eas` package flag (unrelated, left). Zero hits on the other five patterns |

Every `file:line` citation added or changed is asserted by the script in the **appendix** below —
**30 assertions, all PASS, exit 0** (`observed`). It is inline rather than committed as a repo file
so the next reviewer can re-run it without taking a one-off script into the tree.

**Run against the unfixed code**, which is what separates it from decoration: the two retired-claim
assertions both **fail** on `git show HEAD:docs/runbooks/driver-device-day.md` (1 hit each for
`gap > 8 s` and step 7's `stub_sent`) and pass on the fixed tree (0 each) — `observed`.

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run
typecheck lint test build --force`, run on the fixed tree, **exit 0**:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m24.717s
```

Per package, all `observed` in that run — **every count identical to the PR body's**, which is the
expected result for a diff that touches no test and no compiled source:

| Package | Tests | Suites / files |
|---|---|---|
| `@taxi/api` | 733 passed | 77 passed |
| `@taxi/driver` | 218 passed | 41 passed |
| `@taxi/rider` | 140 passed | 29 passed |
| `@taxi/shared` | 231 passed | 24 passed |
| `@taxi/dispatch` | 224 passed | 27 passed |
| `@taxi/db` | 17 passed | 3 passed |

**Four runs, all exit 0 and all `22 successful, 22 total`** — the wall-clock is the only figure that
moves between them (`1m25.48s`, `1m28.397s`, `1m24.187s`, `1m24.717s`). The first piped through
`tail -60` and lost five packages' counts, which is why there is a second; the third and fourth
followed the two fix commits so that the gate ran on exactly what was committed. The table above is
the **fourth** run's, at `b2421ad`.

That is one commit behind this paragraph, and deliberately so: the only difference is this file,
which no turbo task reads (`.claude/**` is not in any package's build, lint, typecheck or test
input). Re-running the gate to cover an edit to the gate's own report is the regress this section
exists to avoid — the ordering rule is *edit → commit → push → re-derive*, and the thing that must
be re-derived at the true final head is the PR body's numstat table, which is.

No size figure is restated here on purpose. The PR body's numstat table is the one place it lives,
and a report that quotes it is stale the moment the commit carrying the report moves it — so the
body's table is re-derived **after** this commit is pushed, not before (memory
`taxi-report-restating-pr-body-figures`).

Findings-level evidence, `observed` on the fixed tree:

| Check | Command | Result |
|---|---|---|
| Every added/changed citation resolves | `bash` the script in the appendix below | **30 assertions, 30 PASS**, exit 0 |
| That script is not decoration | the same two retired-claim assertions against `git show HEAD:docs/runbooks/driver-device-day.md` | **both fail on the unfixed tree** — 1 hit each for `gap > 8 s` and step 7's `stub_sent`; 0 each after |
| Step tables still parse | pipe count per row, runbook `:190-199` and `:43-47` | 6 and 3 pipes on every row |

## Owed to a human

Neither is a defect in this PR; both are decisions or credentials an agent cannot supply.

- **Run `eas-cli init` and commit the link, or leave it to the day.** The runbook now works either
  way. Committing `extra.eas.projectId` + `owner: "linards"` before merge matches the precedent and
  removes an interactive prompt from the day; leaving it means one extra command and a file to
  `git checkout` afterwards. Linards's call — it needs Expo credentials.
- **`.claude/plans/driver-app-auth-online-location.md:828,830` carries the same dead
  `driver.push.stub_sent` signal**, and `:828` also carries the same `no hole > 8 s` threshold. #14's
  file, pre-existing, out of this ticket's scope — the reviewer scoped it out too. Worth the grep
  when A2 is attempted. Not opened as an issue: it is inside #14's own plan, which #14 will re-read.

## Files changed by these fixes

| File | What |
|---|---|
| `docs/runbooks/driver-device-day.md` | F1 (§2 + the *does NOT need* row), F2 (step 7 + a new note), F3 (steps 2 and 5 + a new note), F5 (§0), F6 (step 5 + the note), F7, F8, F9 |
| `.claude/plans/driver-device-day-prep.md` | F1 (three sites + the A1/A2-saving scope), F2 (C2's signal box and point 5), F3/F6 (C1's signal box), F5 (the DECIDED bullet), plus an AMENDMENTS entry |
| PR #218 body | F4 (the validation command), F1 (the `eas init` saving sentence), and the size table re-derived at the fix commit |

No `.ts`/`.tsx` under `src/` is touched by these fixes either — the diff stays documentation.

## Appendix — the citation verifier

Run from anywhere in the checkout. Exit 0 means every `file:line` this PR's prose points at still
resolves to the line it claims.

```bash
#!/bin/bash
# Every file:line citation added or changed by the PR #218 review fixes.
# Each assertion pins the anchor the runbook/plan sentence rests on.
cd "$(git rev-parse --show-toplevel)" || exit 1
fail=0
chk() { # chk <label> <file> <line-range> <regex>
  local label=$1 file=$2 range=$3 re=$4
  if sed -n "${range}p" "$file" 2>/dev/null | grep -qE "$re"; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s  (%s:%s !~ %s)\n' "$label" "$file" "$range" "$re"; fail=1
  fi
}
nchk() { # nchk <label> <file> <regex-that-must-NOT-match>
  if grep -qE "$2" "$1"; then printf 'FAIL  %s  (%s matched %s)\n' "$3" "$1" "$2"; fail=1
  else printf 'PASS  %s\n' "$3"; fi
}

# F1
chk 'F1 precedent projectId'      spikes/gps-harness/app.json 42,47 '"projectId"'
chk 'F1 precedent owner'          spikes/gps-harness/app.json 42,47 '"owner": "linards"'
nchk apps/driver/app.json '"extra"|"owner"' 'F1 driver app.json has neither key'

# F5
chk 'F5 eas.json env block'       apps/driver/eas.json 9,11 'EXPO_PUBLIC_API_URL'
chk 'F5 config.ts throws'         apps/driver/src/config.ts 16,18 'throw new Error'
chk 'F5 plan DECIDED bullet'      .claude/plans/driver-device-day-prep.md 566,577 'DECIDED — the value lives in the committed'

# F8
chk 'F8 stub-sms send range'      services/api/src/features/auth/sms/stub-sms.provider.ts 28,37 'auth.sms.stub_sent'
chk 'F8 stub-sms body line'       services/api/src/features/auth/sms/stub-sms.provider.ts 35,35 '^ +body,$'

# F3
chk 'F3 ping_accepted both stamps' services/api/src/features/drivers/location/driver-location.service.ts 76,82 'clientAt: ping.at'
chk 'F3 server clock at :54'       services/api/src/features/drivers/location/driver-location.service.ts 54,54 'SERVER clock'
chk 'F3 uploader drain'            apps/driver/src/features/location/uploader.ts 70,70 'private async drain'
chk 'F3 #14 sheet states clientAt' .claude/plans/driver-app-auth-online-location.md 828,828 'clientAt'

# F6 / F7
chk 'F6 throttle keeps from last kept' apps/driver/src/features/location/fix-throttle.ts 64,79 'last = raw.timestamp'
chk 'F7 MIN_FIX_INTERVAL_MS at :9'     apps/driver/src/features/location/fix-throttle.ts 9,9 'MIN_FIX_INTERVAL_MS = 4_000'
chk 'F6 timeInterval floor at :19'     apps/driver/src/features/location/location-options.ts 19,19 'timeInterval: 4000'
chk 'F7 distanceInterval at :20'       apps/driver/src/features/location/location-options.ts 20,20 'distanceInterval: 0'

# F2
chk 'F2 no_project at :26-31'   apps/driver/src/features/push/register-push-token.ts 26,31 "return 'no_project'"
chk 'F2 unavailable at :43-53'  apps/driver/src/features/push/register-push-token.ts 43,53 "return 'unavailable'"
chk 'F2 findDueNudges pushToken' services/api/src/features/drivers/presence/driver-presence.repository.ts 52,56 'pushToken: drivers.pushToken'
chk 'F2 no_token guard :353-360' services/api/src/features/drivers/drivers.service.ts 353,360 "reason: 'no_token'"
chk 'F2 push.send at :362'       services/api/src/features/drivers/drivers.service.ts 362,362 'this.push.send'
chk 'F2 stub_sent at :25'        services/api/src/features/push/stub-push.provider.ts 25,25 'driver.push.stub_sent'

# F9
chk 'F9 lv status_online'   packages/shared/src/i18n/lv.ts 263,263 'Tiešsaistē'
chk 'F9 lv pill_live'       packages/shared/src/i18n/lv.ts 270,270 'Tiešraide'
chk 'F9 lv driver_on_ride'  packages/shared/src/i18n/lv.ts 235,235 'Jūs pašlaik izpildāt braucienu'
chk 'F9 en status_online'   packages/shared/src/i18n/en.ts 222,222 "'Online'"
chk 'F9 en pill_live'       packages/shared/src/i18n/en.ts 227,227 "'Live'"
chk 'F9 en driver_on_ride'  packages/shared/src/i18n/en.ts 194,194 'You are on a ride right now'

# retired-claim sweep: the old wordings must be gone from the two files this PR owns
nchk docs/runbooks/driver-device-day.md 'gap > 8 s'                     'F6 no "gap > 8 s" left in the runbook'
nchk docs/runbooks/driver-device-day.md 'no\*\* `driver.push.stub_sent`' 'F2 step 7 no longer watches stub_sent'

echo "---"
[ $fail -eq 0 ] && echo "ALL CITATIONS RESOLVE" || echo "SOME CITATIONS FAILED"
exit $fail
```
