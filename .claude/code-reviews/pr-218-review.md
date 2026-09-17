# PR #218 review — round 1

**PR**: [#218](https://github.com/linardsb/taxi/pull/218) · feat(driver): build route and corrected run sheet for #141's device day
**Head** `a71a6b1` · **Base** `main` @ `b690e91` · base live tip `b690e91` — **unmoved**, so the guarantees pass does not apply
**Locators**: every `docs/runbooks/driver-device-day.md:NNN` below points into that file's **231**-line
version at `a71a6b1` (`git show a71a6b1:docs/runbooks/driver-device-day.md`). It is **289** lines at
`bd5193a` and longer on `main` since; the locators are not re-swept.
**Round**: 1 (no prior report) — the fix-mechanism pass does not apply either
**State**: OPEN, ready for review, `mergeStateStatus: CLEAN` · all five checks pass
**Verdict**: **Request changes** — one High, five Mediums, three Lows. No Critical, no hard-rule
violation, and nothing wrong with the approach. F1 is a gap in the ticket's own deliverable; the rest
are one-line edits.

## Summary

The ticket does what it claims: it makes #141's device run performable without performing any part of
it, and it leaves #141 OPEN (`observed`). No `.ts`/`.tsx` under `src/` is touched, the gate is green
at `a71a6b1`, and every figure in the PR body reproduces.

Two themes in the findings.

**F1** is the gap that matters: this PR exists to make the device day performable, and §2's build block
will not run as written. `apps/driver/app.json` has no EAS project link, and the repo's own precedent —
`spikes/gps-harness/app.json:42-47`, the config behind the only APK this repo has ever built — commits
both `extra.eas.projectId` and `owner`. The plan read that file (`driver-device-day-prep.md:137-138`
cites it for exactly this) and the runbook then denies the link is needed.

**F2, F3 and F6** are all the same failure mode the ticket was opened to remove: a run-sheet signal
that cannot be read as written. F2's check can never fail; F3's can read a healthy stream as broken;
F6's threshold sits exactly on the boundary its own throttle produces. Each is a one-line fix.

Against that: the citation work here is unusually good. Between this pass and the `code-reviewer`
agent's, roughly thirty `file:line` claims were opened and checked against source, and all but two
(F7, F8) land exactly. That matters more than usual, because the defect this ticket exists to retire
*is* a run sheet that cites signals which do not exist.

**Corrected after posting**: that count covers the claims *this PR* makes, and this report's own
pointers were not held to the same standard — four of them missed, opened by PR #219's review (F4)
and fixed in place above: the `app.json` precedent range, F5's `eas.json` line, F5's env-template
premise, and the two `auth.*` events that sit in a different file from the `push` one printed beside
them.

## Findings

### F1 — High · `apps/driver/app.json` (no `extra.eas`) + `docs/runbooks/driver-device-day.md:46`, `:83-85`

**No EAS project is linked, and the runbook says one is not needed.**

The *What this day does NOT need* table at `:46` reads:

> `eas init` / an EAS project id (#14's A2) | Only needed for a push *token*. `register-push-token.ts:26-31`
> warns and no-ops without it, which is fine here.

`apps/driver/app.json` has no `extra` key and no `owner` (`observed`). But a project id is not only a
push concern — EAS attaches every build to a linked project, so §2's block, presented as three
copy-paste lines, stops on an interactive create-or-link prompt and then writes `extra.eas.projectId`
into a **tracked** file before uploading.

The evidence is inside the repo, not recall about `eas-cli`. `spikes/gps-harness/app.json:42-47` — the
config that produced PR #115's APK, the only one this repo has built — carries both:

```json
    "extra": { "eas": { "projectId": "62ad887e-…" } },
    "owner": "linards"
```

and its `eas.json` has no `env` block and no `pnpm` key. The plan cites that very file at
`driver-device-day-prep.md:137-138` — *"proves an Expo account exists under `owner: "linards"` and
shows where `extra.eas.projectId` lands"* — so the precedent was read and then not landed.

`expected`, flagged as such: I cannot run `eas-cli` without credentials, so the prompt's exact
behaviour is not observed. What is observed is the asymmetry — the working precedent commits both
keys, this config commits neither, and the runbook denies needing them.

**Fix (the choice is yours)**: either run `cd apps/driver && npx eas-cli init` before merge and commit
`extra.eas.projectId` + `owner: "linards"`, matching the precedent — then `:46` becomes "needed for a
push *token*; the project link is already committed" — or keep the link deferred to the day and open §2
with `npx eas-cli@latest init`, stating that it mutates `app.json` (which is the same decision as F5).

### F2 — Medium · `docs/runbooks/driver-device-day.md:174`

**Step 7's `driver.push.stub_sent` absence is unreachable on the setup `:46` prescribes.**

Step 7 reads, for 2 minutes after completion, "**no** `driver.presence.status_changed` with
`reason: 'dark'`, and **no** `driver.push.stub_sent`". The second event cannot appear whether or not
the fix landed:

1. No EAS project id (F1) → `registerPushToken` returns `'no_project'` → `drivers.push_token` stays null.
2. `findDueNudges` (`driver-presence.repository.ts:52-56`) selects that column, and `sendDueNudges`
   guards on it at `services/api/src/features/drivers/drivers.service.ts:353-360`:

   ```
   if (!row.pushToken) {
     logger.log({ event: 'driver.push.nudge_skipped', driverId, reason: 'no_token', at });
     continue;
   }
   ```

   The `continue` is before line 362's send — the only caller of `StubPushProvider.send`, which is the
   only writer of `driver.push.stub_sent` (`stub-push.provider.ts:25`).

This is the same defect shape §C2 was written to retire, one layer deeper: the old step was vacuous
because the *provider* delivers nothing; the new one is vacuous because the *token* is absent.

The plan's C2 chain (`.claude/plans/driver-device-day-prep.md:331-337`) is what missed it. Point 5
names "**one** reader that sends (`sendDueNudges`, `drivers.service.ts:338` …)" and stops at the
method signature; the guard is fifteen lines inside it. Every other link in that five-step chain
re-derives correctly (`:179`, `:319-330`, `driver-presence.repository.ts:33-43`, `:39` — all checked).

**Not High**: the `reason: 'dark'` half is a live discriminator and sits strictly upstream of the
nudge, so no regression produces a false ✅. The cost is that the sheet advertises two independent
absences as its pass condition and one is dead weight.

**Fix**: at `:174`, read the event the broken app actually produces — `no driver.push.nudge_skipped
with reason: 'no_token'` (equivalently, no member of the nudge family). It is observable with no push
credential at all, and it fires exactly when a nudge came due, which is the thing being denied. Mirror
it in `:46`'s row and in the plan's C2 signal box at `:322-326` so the claim is not re-inherited. The
same wrong event sits at `.claude/plans/driver-app-auth-online-location.md:828,830` — #14's file,
pre-existing, out of scope here but worth the grep when A2 is attempted.

**Constraint pass**: clean. The plan's eighteen `GOTCHA`s were read; none freezes step 7's wording or
the runbook's signal set. The nearest, `:738` ("the table's own footer line goes with the table"), is
about the *retired* sheet. This fix breaks no acceptance criterion.

**Scope of this pass, corrected after posting.** As first written this was the report's only
constraint pass — one finding of nine — and it read `GOTCHA` bullets alone. Both are too narrow:
`piv-review-pr` asks for a pass *per proposed fix*, and a plan constrains a fix through `DECIDED` and
`PATTERN` bullets as much as through `GOTCHA`s, none of which the skill's prescribed grep
(`do not modify|do not edit|read-only|no changes to|frozen`) matches. Re-run at this report's anchor
over all three bullet kinds — `observed`, `git show a71a6b1:.claude/plans/driver-device-day-prep.md |
grep -c '^- \*\*GOTCHA'` → **18**, same for `DECIDED` → **3** (`:497` repair-not-regenerate, `:555`
the committed `env` block, `:623` the app-wide cleartext boolean) and `PATTERN` → **9** — exactly one
finding is hit: **F5**, whose lead prescription was contra-plan against `:555`. F5 now carries that
pass in full. The other seven fixes touch nothing any of the twelve `DECIDED`/`PATTERN` bullets
decides.

### F3 — Medium · `docs/runbooks/driver-device-day.md:169`, `:172`

**Steps 2 and 5 never say which timestamp to read, and the two diverge in exactly the case that matters.**

Both steps time `driver.location.ping_accepted` — "every ~4 s", "at ~4 s intervals … with no gap > 8 s" —
and the log line carries two timestamps (`driver-location.service.ts:76-82`):

```
clientAt: ping.at,                     // the fix's own time
at: new Date(atMs).toISOString(),      // `:54` — const atMs = Date.now(); // SERVER clock
```

Fixes are queued durably (`fix-queue.ts:24`, whose docblock at `:36-41` documents replay explicitly)
and drained in batches by `uploader.ts:70`. So one socket blip during the unattended 90 s replays the
queue as a burst: the server `at`s bunch together after a visible hole while the `clientAt`s stay 4 s
apart throughout. An operator reading `at` marks ❌ on a healthy stream — and step 5 is one of the four
steps the verdict rule at `:201` makes binary.

#14's own sheet states the field for this reason
(`.claude/plans/driver-app-auth-online-location.md:828`): *"a burst of `ping_accepted` whose `clientAt`
values are ~4 s apart and span the outage"*. The new runbook dropped it.

**Fix**: one clause in steps 2 and 5 — read `clientAt`, not `at`; a reconnect replays the queue and
bunches the server timestamps.

### F4 — Medium · PR body, the Validation section

**The api figures are attributed to a command that does not produce them.**

The body prints `observed` — `pnpm turbo run typecheck lint test build --force`, at `a71a6b1`, exit 0,
and under it `@taxi/api Test Suites: 77 passed, 77 total` / `Tests: 733 passed, 733 total`.

Re-observed **at this tree** rather than inherited from `CLAUDE.md`'s #215 line —
`env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test` at `a71a6b1`, exit 0:

```
Test Suites: 2 skipped, 75 passed, 75 of 77 total
Tests:       39 skipped, 694 passed, 733 total
```

The implementation report's L3 row carries the prefix the body dropped
(`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=… pnpm turbo run …`). The digits in the body are real — I
reproduced all six packages exactly — but only with `REDIS_TEST_URL` set. The defect is the
attribution, which is the class `CLAUDE.md` names: numbers flow plan → report → PR body and are
inherited, not audited, and the PR body is the most-read surface and the only one not in the working
tree. It is also the exact figure `CLAUDE.md` records as having been got wrong three times.

**Fix**: print the command actually run, env prefix included.

### F5 — Medium · `apps/driver/eas.json:10` (the `env` block, `:9-11`) + `docs/runbooks/driver-device-day.md:69`

**A DHCP-assigned LAN address is committed, and editing that tracked file is the prescribed day-0 step.**

`"EXPO_PUBLIC_API_URL": "http://192.168.1.11:3001"` is this machine's current lease (`observed` — §0's
command prints `192.168.1.11` on `en1` right now, and `en0` answers nothing, exactly as `:65-67` says).
The **key** already has a home in the committed env template at `.env.example:53` — which is
**tracked**; the untracked file is `.env`, ignored at `.gitignore:14` — with a comment explaining the
same bundle-time inlining §0 re-explains. That line carries `http://localhost:3001`, not a LAN
address, so the template is precedent for the key and not a home for the value this finding objects
to. §0 then tells the operator to "**Edit it only if it moved**" — and
stops there, saying nothing about the edit's fate.

Both outcomes are bad in a small way. Commit it and a home LAN address is in git history and is the
default for every later build; leave it and the run carries a dirty working tree, in a checkout several
sessions share, that the next `piv-commit` can sweep into an unrelated PR. The precedent config
(`spikes/gps-harness/eas.json`) has no `env` block at all.

**Fix**: one sentence in §0 saying the edit stays **uncommitted**. That closes it, and it is the only
remedy the plan leaves open.

**Constraint pass** (run for this finding after round 1 was first posted — see the note under F2):
the committed `env` block is a **DECIDED** bullet, not an oversight —
`.claude/plans/driver-device-day-prep.md:555-565` at this report's anchor `a71a6b1` (`:566-…` at
`bd5193a`, `:573-586` on `main`), the bullet opening *"the value lives in the committed `env` block
and the operator edits it before each build"*. The alternative it weighs and **rejects by name** is
EAS environment variables: *"it adds a second place to look, an account-scoped step nobody can review
in a diff, and a way for the build to pick up a stale value invisibly."*

So the EAS-side project variable —
`npx eas-cli env:create --environment preview --name EXPO_PUBLIC_API_URL --value http://<ip>:3001`,
dropping the `env` block — is **contra-plan**, and is recorded here as the rejected alternative
rather than prescribed. Per `piv-review-pr`, a fix that breaks the PR's own decisions belongs in an
issue against the decision, not in an inline recommendation. A local shell variable is not an option
either: the build runs in EAS's cloud and is not given the invoking shell's environment.

### F6 — Medium · `docs/runbooks/driver-device-day.md:172`

**Step 5's "no gap > 8 s" sits exactly on the boundary the app's own throttle produces.**

`selectFixes` measures `delta` from the last **kept** fix — `last = raw.timestamp` is assigned only on
a keep (`apps/driver/src/features/location/fix-throttle.ts:64-79`) — and drops anything with
`delta < MIN_FIX_INTERVAL_MS` (4000). `locationTaskOptions` sets `timeInterval: 4000` as an Android
*floor* (`location-options.ts:19`). So an OS delivery arriving even slightly under 4000 ms after the
last kept one is dropped, and the wire gap becomes the sum of two intervals: **one dropped delivery
puts the gap at ~8 s against a threshold of exactly 8 s**, with no stated tolerance and a binary
verdict rule.

Stated as threshold tightness derived from the throttle arithmetic, **not** as a predicted failure —
real Android delivery jitter has not been measured here, and cannot be without the phone.

**Fix**: either widen with the arithmetic shown ("no gap > 12 s — `derived`: 3 × the 4 s throttle,
tolerating one dropped OS delivery"), or restate the signal as what #141 is actually about — the
stream must not *stop*: "pings still arriving at t+90 s, with no sustained silence".

### F7 — Low · `docs/runbooks/driver-device-day.md:186-187`

`distanceInterval: 0` is cited to `fix-throttle.ts:9`. Line 9 of that file is
`MIN_FIX_INTERVAL_MS = 4_000` — correct for the other half of the sentence. `distanceInterval: 0` is at
`apps/driver/src/features/location/location-options.ts:20`. Both facts are true; one pointer covers
both, and a reader chasing the second finds nothing.

### F8 — Low · `docs/runbooks/driver-device-day.md:170`

Step 3 cites `stub-sms.provider.ts:28-33` for "logs the SMS **body in full** … and the tracking link is
in it". The range covers the signature, the comment and the `event:` key; `body` is logged at **line
35**, two lines past it. The claim is true (`:35`), the pointer stops short. Fix: `:28-37`.

### F9 — Low · `docs/runbooks/driver-device-day.md:168`, `:171`

Steps 1 and 4 give their phone-side signals only in Latvian — «Tiešsaistē», «Tiešraide», «Jūs pašlaik
izpildāt braucienu.» All three exist and are correct (`packages/shared/src/i18n/lv.ts:263`, `:270`,
`:235`), but the driver app follows the **device** locale, so a test phone set to English renders
`'Online'` / `'You are on a ride right now.'` (`en.ts:222`, `:194`) and the stated signal never appears.
Fix: one line in §Setup setting the phone to Latvian, or the EN strings in parentheses.

## Validation

| What | Command | Result |
|---|---|---|
| Full gate | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` at `a71a6b1` | ✅ exit 0 · **22 successful, 22 total**, 0 cached, **1m30.122s** |
| CI | `gh pr checks 218` | ✅ `check` · `audit-diff` · `codeql` · `CodeQL` · `ready` — all pass |
| Base drift | `git rev-parse origin/main` after `git fetch --prune` | `b690e91` — equal to `baseRefOid`, no drift |
| F4's premise | `env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test` at `a71a6b1` | exit 0 · **39 skipped, 694 passed, 733 total**; 2 skipped suites, 75 of 77 |

Per-package counts, all `observed` in that gate run and all matching the PR body exactly:

| Package | Observed | PR body |
|---|---|---|
| `@taxi/api` | 733 passed / 77 suites | 733 / 77 ✅ |
| `@taxi/driver` | 218 passed / 41 suites | 218 / 41 ✅ |
| `@taxi/rider` | 140 passed / 29 suites | 140 / 29 ✅ |
| `@taxi/shared` | 231 passed / 24 files | 231 / 24 ✅ |
| `@taxi/dispatch` | 224 passed / 27 files | 224 / 27 ✅ |
| `@taxi/db` | 17 passed / 3 files | 17 / 3 ✅ |

Size table re-derived from `git diff --numstat origin/main..HEAD` at `a71a6b1`:
`1349 + 231 + 198 + (1+23+6=30) + (9+17+3=29) + 49 + 1 = 1887`, and `git diff --shortstat` gives
`12 files changed, 1887 insertions(+), 34 deletions(-)`. ✅ Both reproduce.

## Claims checked and confirmed

Nothing below is a finding. These are the load-bearing claims re-derived rather than inherited.

- **The icon repair is exactly what the body says.** The base blob holds the 17 literal ASCII
  characters `\x89PNG\r\n\x1a\n` where the signature belongs; the head blob holds the 8 real bytes; the
  remaining **683 bytes are byte-identical** (`diff` over both tails, no output). `700 − 17 + 8 = 691`,
  matching `git cat-file -s` on both sides. A header repair, not a new asset.
- **The Android permission set is complete**, which is what makes step 5 meaningful at all: `app.json`
  already declares `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`,
  `RECEIVE_BOOT_COMPLETED`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, and `expo-location` sets
  `isAndroidBackgroundLocationEnabled` and `isAndroidForegroundServiceEnabled`. The task is registered
  at module scope (`location-task.ts:125`) with `_layout.tsx:3` importing it first. The #115
  startup-crash shape (memory `taxi-gps-spike-kit`) does not apply.
- **The `preview` profile really does build a release variant**, which the report's L4.8 reasoning
  depends on. `expo-dev-client` in `dependencies` with no `developmentClient` key does not pull the
  launcher in: `expo-dev-launcher/android/build.gradle:108-138` gates it behind a debug-only helper.
  `expo-build-properties` writes `android:usesCleartextTraffic` onto `mainApplication`
  (`expo-build-properties/src/android.ts:253`), i.e. into the `main` manifest as claimed.
- **`ping_accepted` really does print** — the claim every step's primary signal rests on.
  `driver-location.service.ts:76` is `logger.debug`, `main.ts:7` is `NestFactory.create(AppModule)` with
  no options, `setLogLevels`/`logLevels` appear nowhere in `services/api/src`, and Nest 11's
  `DEFAULT_LOG_LEVELS` (`@nestjs/common/services/console-logger.service.js:12-19`) is
  `['log','error','warn','debug','verbose','fatal']`.
- **Every log-event string exists verbatim**: `driver.location.ping_accepted` (`:77`),
  `driver.presence.status_changed` (`drivers.service.ts:222`, `:303`), `driver.push.stub_sent`
  (`push/stub-push.provider.ts:25`), and — in a **different** file — `auth.otp.stub_sent`
  (`auth/sms/stub-sms.provider.ts:20`) and `auth.sms.stub_sent` (same file, `:33`). The two line
  numbers coincide with lines that exist in `stub-push.provider.ts` as well, so a bare `:20`/`:33`
  here would resolve against the wrong file without looking wrong.
- **`board-state.ts:127` is exact**, and the freshness claim holds: the only non-test reference to
  `lastSeenAt` anywhere in `apps/dispatch` outside the tracking page's own unrelated local state is
  that write. The board renders position and no freshness. This correction is the sheet's best call —
  it prevents a real false ❌.
- **The presence constants are exact**: `driver-location.policy.ts:15` `= 60`, `:30`
  `PRESENCE_DARK_AFTER_SECONDS = DRIVER_LOCATION_TTL_SECONDS`, `:36` `= 15_000`, `:42` `= 30`. The
  90-second watch does clear the window `findNearby` uses — `driver-location.service.ts:106` filters on
  `Date.now() - DRIVER_LOCATION_TTL_SECONDS * 1000`.
- **Step 7's 2-minute derivation survives** on its stated condition. In the broken app the stream stops
  at step 4, so ≥90 s of step 5 elapse before completion and the dark condition is true at C;
  `≤15 + 30 + ≤15 = 60 s` follows, and 2 minutes is margin. The condition is stated, not assumed away.
- **`provision:dispatcher`'s four claims are all true** — phone first / name second
  (`scripts/provision-dispatcher.ts:27`), no `--` separator (`:18`), throws by name without a database
  URL (`:38-42`), and it is the sole dispatcher-creation path (`:5-11`).
- **Step 6's corroborating signal holds under scrutiny.** `tracking-map.tsx:334-335` renders the
  position's own recorded time (the adjacent `:227` is the unrelated connection-lost banner);
  `positionOf` carries no freshness filter by design (`driver-location.store.ts:72-82`), and
  `tracking.service.ts:121-134` populates `position` for exactly the statuses in play at step 5.
- **The steps match the shipped reducer.** `presence-state.ts:346-383` is the #141 branch — intent back
  to `online`, `banner: driver_on_ride`, no teardown effect — and `drivers.service.ts:442-452` logs
  `on_ride → online` on release, so step 7's "the stream survived the release" and step 8's "no banner,
  the hold was ride-scoped" are coherent with the code rather than aspirational.
- **Other citations, all exact**: `socket.ts:30` (`transports: ['websocket']`, no polling),
  `fix-throttle.ts:9`, `dispatch.sweeper.ts:112`, `dispatch.controller.ts:95`,
  `register-push-token.ts:26-31`, `.env.example:104` (`PUSH_PROVIDER=stub`), and `:36`/`:39`/`:47` (the
  three localhost defaults §3 depends on).
- **Cross-document pointers all resolve**: `driver-app-auth-online-location.md:812` and `:816`,
  `driver-offers-active-ride.md:506`, `ui-decisions.md:17`, `pr-163-review.md:183`,
  `earnings-card.tsx:17`, `04-gps-field-test.md` §Field protocol. `apps/driver` is a
  `pnpm-workspace.yaml` member (`apps/*`), so "do not copy the app outside the repo" is right.
- **§0's command works as documented**: it prints `192.168.1.11` via `en1`, and the common
  `getifaddr en0` recipe exits 1 with empty output — the silent-pass trap the runbook names.
- **The retired `4872` figure is retired by subject, not just digit.** All five surviving mentions
  (three in the plan, two in the report) exist only to say it does not reproduce. D2's arithmetic also
  reconciles: `4792 + 4192 + 232 = 9216 = 96²`.
- **Three bash blocks in the runbook, all `bash -n` clean** — L4.2's 3/3 reproduces.
- **The rebase claim reproduces.** #217 (`b690e91`) touched exactly one file,
  `docs/runbooks/hetzner-deploy.md`; `comm -12` against this PR's twelve is empty. No overlap, which is
  also why the guarantees pass is moot.
- **`eas.json`'s `"pnpm": "10.33.2"` matches the root `packageManager` pin** exactly. Whether `pnpm` is
  a documented profile key or silently ignored was **not** verified — `eas-cli` is not a repo
  dependency, so no local schema exists, and the precedent `eas.json` has no such key to compare with.
- **#141 is OPEN** and the reconciliation comment exists (`2026-09-17T13:09:28Z`).

Not verified, so it is not mistaken for checked: the EAS cloud build itself (correctly labelled
`expected`, never `observed`, throughout the PR), and the icon's rendered appearance — D2's CRC-backed
decode stands on its own and was not re-litigated.

## What is good

- **The consolidation is genuinely done**, not declared done. The held plan's §Level 4 table is gone,
  replaced by a pointer plus a dated AMENDMENTS entry that names what was retired and why the old
  footer was stale; #14's §C.14 repoints; the stale report gets a supersede note rather than a rewrite.
  Retiring a claim by its subject rather than its sentence is what `CLAUDE.md` asks for and rarely gets.
- **Both signal corrections are real defects found by reading code, not by reading the sheet.** «The pin
  keeps moving» was unreadable for a reason no amount of care with the *wording* would have surfaced —
  you have to open `board-state.ts` and notice nothing reads the field back. F2, F3 and F6 criticise how
  far that method was carried, not the method.
- **The three build blockers were each closed by running the builder's view of the tree, in both
  directions.** Rows 3 and 6 of the L4.7 table are the same command on the same tree with one
  difference. That is the shape of evidence this repo keeps asking for.
- **D1 and D2 are the report's best content.** D1 retracts an `observed` result of the plan's own making
  and explains why the original check was an identity function — twice, once for Hermes and once for the
  Metro cache. D2 declines to explain an 80-pixel delta instead of inventing a mechanism that reaches
  the number. Both are the behaviour #87 and #107 cost the project.
- **`git archive` of `write-tree` rather than `HEAD`** (D4) is the right call and is explained.
- **Step numbering held.** Reverting the renumber before validation, and folding the early-open
  instruction into step 3 instead, keeps every existing citation resolving.
- The step 2 hard gate and §4's transport-fault discriminator are the two controls that stop a device
  day producing a confident wrong answer. Both are well argued from the code (`transports: ['websocket']`,
  steps 1–3 all REST).
- No hard-rule violation anywhere in the diff: no money handling, no ride-status writes, no contract
  duplication, no seam bypass, `packages/shared` untouched, no `eslint-disable`, and the 500-line cap
  does not bind — it binds shipped source a package build compiles (`CLAUDE.md:60`), which markdown
  under `.claude/` is not, and `eas.json` is 17 lines regardless. #112's named exemptions are
  `.spec`/`.test` files, `test/`/`tests/` and `scripts/`; a PIV artifact is in none of them and needs
  none, so it is not the reason to cite here.

## Recommendation

**Request changes.** F1 is the one that should gate merge — not because the code is wrong, but because
the ticket's deliverable is "the day is performable" and §2's block does not run as written. F2, F3 and
F6 are each one line and are the ticket's own stated purpose applied to its own output. F4 and F5 are
one line each. F7–F9 are polish.

This is not a verdict on the approach. The gate is green at `a71a6b1`, no finding touches shipped
runtime source, and nothing changes what the ticket claims: the prep is done, #141 stays OPEN, and the
device run stays owed. Fix F1–F3 and this is an approve.

Next: `piv-fix-review-findings` on this report, then re-validate.
