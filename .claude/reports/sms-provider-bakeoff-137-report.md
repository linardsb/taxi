# Implementation Report — SMS provider bake-off, the instrument (#137)

**Plan**: `.claude/plans/sms-provider-bakeoff-137.md`
**Branch**: `feature/sms-provider-bakeoff-137` (worktree `/Users/Berzins/taxi-worktrees/wt-137`, cut from `origin/main` at `1c98ac8`)
**Status**: COMPLETE — for the instrument. **#137 stays OPEN**: AC #6 (handset results) and AC #7 (the switch, or the recorded reason) are not discharged and cannot be on this machine.

## Summary

Built the two candidate `SmsProvider` implementations (`BulkGateSmsProvider`, `BudgetSmsProvider`), an
`SMS_PROVIDER` selector with two all-or-none credential groups behind it, a manual send instrument
(`sms:bakeoff`, dry-run by default), and the empty scorecard the run fills. Nothing is switched: the
bake-off's verdict needs three LV SIMs and two funded vendor accounts, neither of which exists here.

## Tasks completed

| Plan task | File | |
|---|---|---|
| BulkGate credential group | `services/api/src/common/config/sms-env.schema.ts` | CREATE (see D1) |
| BudgetSMS credential group | same | CREATE |
| `SMS_PROVIDER` selector enum | same | CREATE |
| The two superRefines | same (`checkSmsCredentialGroups`) | CREATE |
| — the fields spread back in, the check called above the production gate | `services/api/src/common/config/env.schema.ts` | UPDATE |
| BulkGate provider | `services/api/src/features/auth/sms/bulkgate-sms.provider.ts` | CREATE (149 lines) |
| BulkGate spec | `…/bulkgate-sms.provider.spec.ts` | CREATE |
| BudgetSMS provider | `…/sms/budgetsms.provider.ts` | CREATE (112 lines) |
| BudgetSMS spec | `…/budgetsms.provider.spec.ts` | CREATE |
| Factory selection | `services/api/src/features/auth/auth.module.ts` | UPDATE |
| Factory spec | `services/api/src/features/auth/auth.module.spec.ts` | UPDATE |
| Env template | `.env.example` | UPDATE |
| The instrument | `services/api/scripts/sms-bakeoff.ts` | CREATE |
| `sms:bakeoff` script entry | `services/api/package.json` | UPDATE |
| Scorecard + run sheet | `docs/research/sms-bakeoff-scorecard.md` | CREATE |
| §4.4 pointer | `docs/research/hosting-sms-cost-research.md` | UPDATE (+2 lines) |

`notifications.module.ts` deliberately untouched — it imports auth's factory and inherits the selector branch.

## Tests added

| File | Cases | Result |
|---|---|---|
| `bulkgate-sms.provider.spec.ts` | 3 expected · 3 edge · 2 failure | 8 passed |
| `budgetsms.provider.spec.ts` | 3 expected · 2 edge · 2 failure | 7 passed |
| `auth.module.spec.ts` | +3 (2 expected, 1 edge); the production-refusal case gains an explicit `'auto'` assertion | 7 passed (4 original untouched) |
| `env.schema.spec.ts` | +7 (`it(` blocks 22 → 29) | 38 passed |

**The six pins were probed, not asserted** — each fix was reverted, the suite run, and the fix restored
(`observed`, this session; the tree was diffed against a backup afterwards and is byte-identical):

| Pin | Reverted to | Result |
|---|---|---|
| BulkGate leak | throw `await res.text()` | 2 failed / 6 passed ✅ |
| BulkGate encoding | hardcode `unicode: true` | 1 failed ✅ (`detects the encoding rather than hardcoding it`) |
| BulkGate segments | `part_id.length` | 1 failed ✅ |
| BudgetSMS `ERR`-on-200 | branch on `res.ok` | 2 failed / 5 passed ✅ |
| BudgetSMS leak | interpolate the raw response text | 2 failed ✅ |
| BudgetSMS `+` strip | pass `phoneE164` through | 1 failed ✅ |

## Validation results

**The gate, `observed` on the final tree** (`COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`, from a cleared `apps/dispatch/.next`):

```
Tasks: 22 successful, 22 total      Time: 1m18.843s
@taxi/api:test  Test Suites: 2 skipped, 77 passed, 77 of 79 total
@taxi/api:test  Tests:       39 skipped, 719 passed, 758 total
```

**The baseline, `observed` — not inherited.** `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test`
in a detached worktree at this branch's base `1c98ac8`, run alone:
`Test Suites: 2 skipped, 75 passed, 75 of 77 total`, `Tests: 39 skipped, 694 passed, 733 total`
(41.261 s). So the delta is **+25 tests and +2 suites**, which exactly accounts for 8 (bulkgate) +
7 (budgetsms) + 3 (auth.module) + 7 (env.schema) = 25 in 2 new suites, and therefore no other suite
moved. The 39 skipped are the documented Redis-gated set, unchanged at both ends.

(A first attempt at that baseline reported `8 failed` — it was run in the background while this
branch's suites ran in the foreground, which is the shared-`taxi_api_test` collision CLAUDE.md
documents. The re-run above was the only thing running. The failures never moved the total: 686
passed + 8 failed = 694.)

The gate was run four times — three during implementation, then once more via `record-gate.sh
--clean` on the code tree this ticket's commit ships — with identical test counts across all four.
No sha is named here on purpose: a sha in a file the commit itself contains is stale the moment it
is committed, and the correction re-stales it (#212). The PR body names the pushed head, where it
can be true.

Lint: 0 errors, 12 warnings, all pre-existing `no-unsafe-argument` on integration specs. `max-lines`
clean — the largest touched shipped file is `env.schema.ts` at 351 (was 395; see D1), then
`sms-env.schema.ts` at 264 and `bulkgate-sms.provider.ts` at 149.

**Level 4, the four steps performable here** (`observed`, this session):

1. `pnpm --filter @taxi/api sms:bakeoff` → usage naming all three `BAKEOFF_*`, `Exit status 1`. ✅
2. Dry run with syntactically valid dummy credentials → the full 9-row matrix, encodings `GSM-7` /
   `UCS-2` / `UCS-2`, per-provider spend, `DRY RUN — nothing was sent`. Nothing left the machine. ✅
   `--testsms` prints BudgetSMS only and names both skips by reason; `--round 2` correctly drops the
   RU probe. ✅
3. Boot refusal unchanged — via `auth.module.spec.ts`, including the new explicit `'auto'` assertion. ✅
4. `SMS_PROVIDER=bulkgate` with an empty group → `SMS_PROVIDER=bulkgate needs
   BULKGATE_APPLICATION_ID, BULKGATE_APPLICATION_TOKEN, BULKGATE_SENDER_ID_VALUE.`, exit 1. ✅

**The rows table carries the vendors' own numbers**, `observed` via a scratchpad harness (deleted;
never in the repo) that reproduces the script's `captureProviderLogs` and drives both real providers
through it with an injected `fetch`:

```
bulkgate:  apiResult="ok tmpABC"    apiSegments="2"  partId=["tmpABC_1","tmpABC_2","tmpABC"]
budgetsms: apiResult="ok 9998887"   apiSegments="2"  partId=undefined
```

`apiSegments` is BulkGate's `part_id`-derived count and BudgetSMS's `OK`-line parts token, not the
script's estimate; the provider log lines still print (the capture tees, it does not swallow).

**Scorecard fidelity**: `diff` against Appendix A is **empty** — see D4.

**Spend arithmetic, re-derived rather than inherited.** 3 operators × (OTP 1 seg × 3 rounds + LV
`driver_assigned` 2 seg × 3 rounds + RU 2 seg × 1 round) = 3 × (3 + 6 + 2) = **33 segments per
provider**. BulkGate 33 × €0.0311 = €1.03; BudgetSMS 33 × €0.045 = €1.49; Twilio 33 × $0.0715 =
$2.36 → €1.82 at EUR/USD 1.3, €2.36 at 1.0. **Total €4.33–€4.87**, `derived` under exactly those
conditions and §4.1's `observed 2026-08-14` rates, which #137 says to re-observe at bake-off time.
The script's dry run cross-checks the per-round half of this: round 1 printed 15 segments per
provider (5 × 3 operators), and 15 + 9 + 9 = 33. The failure probe is an allowance **on top**, not
in the total: €0.15 worst case (€0.0311 + €0.045 + $0.0715 at FX 1.0), because only BudgetSMS
documents an `ERR` as free.

**UX states**: none declared. The plan has no UX section — this ticket ships no user-facing surface,
only a backend seam, a config selector and an operator script. The script's own output states are
all exercised above (usage / dry run / `--testsms` / schema refusal); its send path cannot be
exercised without funded accounts and is the bake-off itself.

## Deviations from the plan

**D1 — `env.schema.ts` split into `sms-env.schema.ts`. Not in the plan; forced by the 500-line cap.**
The plan's four env tasks took the file from 395 to **553** lines, and `max-lines` is an eslint
*error*, so the gate could not go green as written. The split is line-budget only, the same kind
`format-message.ts` records in `@taxi/shared`: the three groups' fields, the table naming them, and
the all-or-none check moved; the fields are spread back into `envSchema` at exactly the position they
occupied, so the composed schema and every message it can emit are unchanged. Placement of the check
stays in `env.schema.ts` — above `if (env.NODE_ENV !== 'production') return;` — because that is the
property the caller owns. `TWILIO_*` moved too, as part of the same concern; `env.schema.spec.ts`
imports only `envSchema` and needed no change for it. **Plan file lists gain**:
`sms-env.schema.ts` (new).

**D2 — send order is provider → probe → operator, not the plan's illustrative row order.** The
example table in the script task shows `LMT/otp`, `LMT/driver_assigned`, `Tele2/otp` — provider →
operator → template. The plan's own rule, stated twice (NOTES "Order of the run", Appendix A "Probe
order inside every round: OTP first"), contradicts it: under the illustrated order a mid-round credit
exhaustion loses Tele2's and Bite's OTP, which is the criterion #137 is protecting. Took the rule.
**The column shape is unchanged**, which is what the run sheet actually cites.

**D3 — `features/auth/index.ts` not touched; the script deep-imports the two providers.** The plan's
file list did not settle this. Exporting the concrete classes from the slice's public API would let
any *module* construct a provider and skip the production boot-refusal — the exact guarantee
`notifications.module.ts:14-18` protects by importing the factory instead. `mint-tracked-ride.ts`
already deep-imports `otp.policy`, `caching-maps.provider`, `dispatch.policy` and
`notifications.policy`, so a script reaching past `index.ts` is the established shape. Stated in the
script's import comment.

**D4 — the scorecard diff is empty, not "differs only in the run-date header line".** The scorecard
task's VALIDATE expected one differing line. Appendix A already ships `**Run date:** —` placeholders
and no run has happened, so filling a date would be a figure under a heading no run produced — the
defect CLAUDE.md names. Copied byte-identical; the run fills the header.

**D5 — `isGsm7` is exported from `bulkgate-sms.provider.ts` and imported by the script.** The plan
said "exported only if its spec needs it"; the spec does not, but the script's `encoding` column and
segment estimator must answer the same question BulkGate's `unicode` flag answers. The first draft
duplicated the GSM 03.38 table into the script; that was removed in favour of the import, because two
tables that have to agree are one table that will not. Still module-local to the slice — nothing went
into `@taxi/shared`, and the seam is unchanged.

**D6 — `SMS_HTTP_TIMEOUT_MS = 10_000` is now declared in three provider files.** The plan said to
reuse the constant "and its comment's reasoning"; extracting it to a shared `sms.policy.ts` would
have meant editing `twilio-sms.provider.ts`, which the plan's Out of Scope explicitly forbids
("Not changing: … `TwilioSmsProvider`"). Left as three literals that must agree, per the template
instruction. Worth one line in a follow-up if `TwilioSmsProvider` is ever in scope again.

**D8 — the script reads each send's result off the provider's log line, and BulkGate logs `partId`.**
The plan's script spec has `sendOne` record "either the success or the thrown `Error.message`", with
an `api segments` column. A first pass filled that column from the script's own estimator, which
would have made the column a duplicate of the dry run's guess — and left scorecard **row 11**
("Segment count the API reported… Record the raw `part_id` array") unfillable, the one row the plan
designated to settle BulkGate's `expected` counting rule. The seam is `Promise<void>` and stays that
way (Q1), so the vendor's count and message id reach the caller only through the log — captured
in-process, the `mint-tracked-ride.ts` shape. Two consequences: `api result` on success is now
`ok <vendor id>`, matching the plan's own illustrative row; and `BulkGateSmsProvider`'s success log
gains `partId` alongside `segments`, which the plan's log spec did not name. Opaque vendor ids —
no phone, no body. A `~`-prefixed segment value marks the fallback where no log line was captured.

**D7 — one spec case beyond the plan's list.** `budgetsms.provider.spec.ts` gains an *(edge)* case
pinning the `baseUrl` override, so `--testsms` reaching `/testsms/` with the same request-building
code is asserted rather than assumed.

## Issues encountered

- **No new migrations.** `ls db/migrations/*.sql | tail -1` → `0010_smooth_white_queen.sql`,
  untouched. Nothing in this ticket touches the schema.
- **Worktree setup cost three steps the plan does not mention**: a fresh worktree has no
  `node_modules` (`pnpm install`), no `packages/shared/dist` and no `db/dist` (both `build`), and no
  root env file. Without the last two, `@taxi/api typecheck` fails with 12 phantom
  `Cannot find module '@taxi/db'` errors that read as code errors.
- **`SMS_GROUPS` as the plan printed it does not typecheck.** `Object.entries` over two parallel
  `as const` records widens the key to `string` (so `PREFIX[kind]` fails) and makes `keys` a union of
  three readonly tuples (so `keys.filter` is not callable). Rewritten as one `Record<SmsProviderKind,
  { prefix, keys: readonly SmsCredentialKey[] }>`. Behaviour identical, and the order property the
  `env.schema.spec.ts:216` regex depends on is preserved — it depends on key order *within* a group's
  array, which is untouched.
- **The script parses env after argv, not before**, reversing the plan's numbered steps 1 and 2.
  Nothing dotenv-loads for a plain script, so the plan's order makes a bare invocation throw a
  `ZodError` about `DATABASE_URL` instead of the usage message Level 4 step 1 asserts.
- Concurrent sessions: 20 `claude` processes and 27 worktrees at start, so this ran in its own
  worktree throughout. `ps aux | grep '[j]est'` was checked clear before each suite run — the
  `taxi_api_test` database is a hardcoded name and `globalSetup` drops it.

## What this loop does NOT discharge

- **AC #6** — `observed` delivery on LMT / Tele2 / Bite. No LV SIMs, no funded accounts.
- **AC #7** — the switch, or the recorded reason not to. Conditional on AC #6.

**The PR must not close #137.** Write "Part of #137" and check `closingIssuesReferences` on the open PR.
