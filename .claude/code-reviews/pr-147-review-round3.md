# Code review — PR #147, round 3

**PR** https://github.com/linardsb/taxi/pull/147 · `feat(deploy): Hetzner environment — image, host stack, deploy, runbook (#13)`
**Head** `76361e0` · **Base** `main` @ `a6481aaadef63712264e569a8f237db416b9e6be` · reviewed 2026-09-03 in the `taxi-141` worktree at head
**Implementation report** `.claude/reports/deploy-hetzner-environment-report.md` — D1–D10 read as decisions, not findings; its "Review round 2 — fixes" section is what this round audits
**Prior rounds** round 1 at `dff4c4f` (1 high · 3 medium · 9 low), round 2 at `711d840` (1 high · 1 medium · 4 low) — both in `.claude/code-reviews/`, PR #148

## Summary

**Request changes.** Nothing in the deploy path is broken. Both round-2 blockers are fixed, and both fixes reproduce from a clean context against real docker and real shims rather than from a reading. N1's `</dev/null` pair is also the *complete* set: every executable line in the `ssh … 'bash -s'` heredoc was enumerated, and the only two that read the script's own stdin are `compose run` and `compose exec` — the `docker login --password-stdin` on `:103` takes the `echo` pipe as its stdin and does not eat the script, which was the one way this fix could have been half-done.

What is left is four claims that are wrong about what they describe, and their fixes are all prose:

- Two figures in the PR body were true at `711d840` and were relabelled "at HEAD" when HEAD moved (**P1, P2**) — the #87/#107 inheritance defect, and the second time in this PR: round 1's F1 was the same shape, and it hid a production boot that did not work.
- The comment behind `--wait-timeout 120` calls a failure deadline a legitimate startup, and asserts its precondition without the reason that makes it true (**P3**).
- `POSTGRES_PASSWORD`'s new "these characters break the URL" list is wrong about two of the five it names, silent about one that does break, and backwards about the one that fails without an error (**P4**) — `observed` against the parser in this tree, and now in two files.

Five lows, four of them one-liners. The base has not moved since round 1 (`baseRefOid` still `a6481aa`), so the guarantees pass is not triggered.

Counts: **0 critical · 0 high · 4 medium · 5 low**.

## Findings

### Medium

**P1 — the PR body's diff stat is `711d840`'s, labelled "at HEAD".** PR body, "What changed", first paragraph.

- The body says: "`git diff --stat origin/main..HEAD` at HEAD: **34 files, +1,494 / −90**".
- `observed` 2026-09-03 at `76361e0`: that exact command reports **34 files changed, 1568 insertions(+), 91 deletions(-)**, and `gh pr view 147 --json additions,deletions` agrees. The file counts do hold: `--diff-filter=A` → 11, `--diff-filter=M` → 23.
- `+1,494 / −90` is `git diff --stat a6481aa..711d840`, `observed` here. Round 2's numbers table re-derived it and it was true *then*; the round-2 fixes added +95 / −22 over 10 files and the sentence kept its label.
- Fix: the command named in the body is the right command — run it again and paste what it says now. The defect is not the transcription, it is that a figure was relabelled "at HEAD" when HEAD moved underneath it.

**P2 — "Two commits on `a6481aa`" — there are four, and the same body describes the other two.** PR body, "What changed", first paragraph.

- The body: "Two commits on `a6481aa`: `dff4c4f` (the feature…) and `711d840` (the round-1 review fixes…)". `git log --oneline a6481aa..HEAD` → **four**: `dff4c4f`, `711d840`, `6a6c27b` (round-2 fixes), `76361e0` (N4 in seven places).
- Its own line is warranted because the contradiction is *internal*: the "Review round 2 — fixes" section forty lines below is entirely about the two commits the top paragraph says are not there.
- Fix: four commits, one clause each.

**P3 — the `--wait-timeout 120` comment calls a failure deadline a legitimate startup, and asserts its precondition without the reason it holds.** `.github/workflows/deploy.yml:114-116`; propagated to `.claude/reports/deploy-hetzner-environment-report.md:100`.

> `# 120 s: the api healthcheck's worst legitimate case is start_period 20 s + 5 retries x 10 s interval = 70 s (compose.prod.yml), after db and redis report healthy.`

- The arithmetic is right and `120 > 70` is right. What the sentence gets wrong is **what 70 s is**. `start_period + retries × interval` is the point at which compose declares the container **unhealthy** — the failure ceiling. A container is marked healthy on its *first* successful probe, during `start_period` included. So 70 s is not a legitimate startup at all, and the practical consequence is the opposite of what the comment teaches: an api that genuinely needs 75 s is not rescued by a larger `--wait-timeout`, it is failed at 70 s by its own healthcheck (`compose.prod.yml:60-63`). The knob that would matter there is `start_period`/`retries`, not this flag.
- `--wait-timeout` is also **project-scoped**, not api-scoped (`docker compose up --help`: "Maximum duration in seconds to wait"). The clause "after db and redis report healthy" states the precondition and omits the reason it is true — which is the load-bearing half: the `$compose run --rm api …` on `:113` resolves the api service's `depends_on … condition: service_healthy` (`compose.prod.yml:44-48`) before `up` is ever reached, so db and redis are already healthy by then. Without that sentence the reader is left with a naive project sum over three healthchecks (`docker-compose.yml:12-20, 29-33`) and no way to tell whether 120 s covers it.
- Why Medium and not High: the shipped value is not at risk. `observed` 2026-09-03 — throwaway compose project, fresh `db-data` volume, `postgis/postgis:16-3.4-alpine` with the base file's healthcheck, `docker compose up -d --wait` → **healthy in 6 s** on this laptop with a warm image. A CX22's two shared vCPUs are slower, not an order of magnitude. The defect is the derivation, and it has already propagated to the report, where it is labelled `derived` — better provenance, same inverted semantics.
- The N5 observation cannot back this figure, and the report gives the command without drawing the conclusion: report `:108` and the PR body both run `up -d --wait --wait-timeout 45 api` — **`45`, and service-scoped to `api`**, against an already-running db. Sound evidence about the gates; silent about a project-wide 120.
- Fix, prose in both places: "120 s is a backstop, not the api's budget — the api healthcheck resolves itself at `start_period` 20 s + 5 × 10 s = 70 s, after which compose reports the container unhealthy and `up --wait` fails. Reasoning about the api alone is valid because the `run` above already waited on db's and redis's `service_healthy` conditions. If the api ever legitimately needs longer, raise `start_period`/`retries`, not this flag."

**P4 — `POSTGRES_PASSWORD`'s character list is wrong about two characters, misses one, and inverts the dangerous one.** `compose.prod.yml:38-41` and `docs/runbooks/hetzner-deploy.md:204`, both added in round 2 for N3.

> `An @, /, :, # or % in it breaks pg's URL parser`

- `DATABASE_URL` reaches `new Pool({ connectionString })` (`db/src/client.ts:9`) → `pg` 8 → `pg-connection-string` **2.14.0**, the copy in this tree. `observed` 2026-09-03, `parse('postgres://taxi:<pw>@db:5432/taxi')` for each character:

| password | result |
|---|---|
| `pa@ss` | **OK** — password `pa@ss`, host `db`, port 5432. Named as breaking; does not. |
| `pa:ss` | **OK** — password `pa:ss`. Named as breaking; does not. |
| `pa/ss` | throws `Invalid URL` ✔ |
| `pa#ss` | throws `Invalid URL` ✔ |
| `pa?ss` | throws `Invalid URL` — **not in the list** |
| `pa%41ss` | **no error, password silently becomes `paAss`** — a wrong password, not a parse failure |
| `pa%2Fss` | **no error, password silently becomes `pa/ss`** |
| `pa%ss` | OK — `%` not followed by two hex digits survives intact |

- So the enumeration produces two false alarms, misses `?`, and describes `%` as a parser break when it is the one character that fails **silently** — an authentication error at boot with nothing pointing at the password's shape. That is the case a reader most needs warned about, and it is the one the sentence mislabels.
- The prescription is unaffected and correct: `openssl rand -hex 16` is safe on every count. This is a claim defect, not an operational one — but it now exists in two files, which is the "flows plan → implementation → runbook, inherited not audited" pattern the root `CLAUDE.md` names.
- Fix, both places: "`/`, `#` or `?` fails the URL parse at boot. A `%` followed by two hex digits is silently **decoded away** — a wrong password and no error at all. `@` and `:` happen to survive; do not rely on it. Hex only." Grep the noun (`POSTGRES_PASSWORD`, `URL parser`) rather than the sentence, and check the PR body, which carries the N3 summary too.

### Low

**P5 — after `trap - EXIT`, a failed upload leaves nothing in the log to grep for.** `scripts/backup-db.sh:54-66`.

- N2's fix is right and its comment is honest about the trade. The consequence is a shade worse than the comment implies: the trap was the only thing that wrote a `backup FAILED` line past the check (`:51`'s is before the disarm), so from `:60` onward a failing `rclone copy` exits 1 silently as far as this script is concerned.
- `observed`, the shim run below with `rclone copy` made to fail. `711d840` log: `rclone: token expired` **and** `2026-09-03T… backup FAILED (exit 1): removed …/taxi-….dump`. Head log, in full: `rclone: token expired`. The dump survives — the point of the fix — but the log now carries no marker naming this script, no exit code and no dump path. The cron line (`:5`) appends to `/var/log/taxi/backup.log` and there is no alerting (runbook §9 records that). The only remaining signal is the *absence* of `:66`'s `backup ok …` line, which is not something anyone greps for.
- Fix, one line, keeps both properties — re-arm a log-only trap instead of clearing it:
  `trap 'st=$?; [ "$st" -ne 0 ] && echo "$(date -u +%FT%TZ) backup FAILED after dump (exit $st): $file KEPT" >&2' EXIT`

**P6 — the dumps land world-readable.** `scripts/backup-db.sh:25`, `docs/runbooks/hetzner-deploy.md:116-117`.

- `derived`: the runbook creates `/var/backups/taxi` with `sudo mkdir -p` and then `chown -R deploy:deploy` — ownership, never mode — so the directory is 0755. The script's own `mkdir -p "$LOCAL_DIR"` and its `> "$file"` both run under cron's default umask (022 on Debian/Ubuntu), leaving each `taxi-*.dump` at 0644. A full database dump — riders, drivers, phone numbers, the ledger — readable by any local account.
- Single-tenant pilot box, so the practical exposure is small today; it is the local sibling of round 1's F10 (#149, dumps unencrypted on R2) and costs one word.
- Fix: `umask 077` immediately above `mkdir -p "$LOCAL_DIR"` at `:25`. Covers the directory and every dump written after it.

**P7 — the sanity check runs `pg_restore` on the host, and on a Postgres major upgrade the still-armed trap deletes the fresh dump every night.** `scripts/backup-db.sh:42-53`; `docs/runbooks/hetzner-deploy.md:371`.

- The dump is produced *inside* the container (`:42-43`), the `--list` check is run by the **host's** `pg_restore` (`:50`), installed by `apt-get install -y … postgresql-client` at runbook `:371`. That silently couples the backup to the host client's major being ≥ the db image's. Today they match (Ubuntu 24.04 ships client 16, the image is `postgis/postgis:16-3.4-alpine`), so this is latent, not live.
- Failure scenario, `derived` from the script's own control flow: after a Postgres major upgrade, `pg_restore --list` from the older client fails on the archive header; `pipefail` makes the pipeline non-zero, the `if !` takes its branch, and `exit 1` fires at `:52` — **before** the `trap - EXIT` at `:60`. The trap deletes the dump that was just made. Every nightly run then produces nothing while logging a message about a missing `geozones` table, and §6.2's rehearsal instruction ("again after any Postgres major upgrade") is about the *restore*, so it does not point at the cause.
- Fix: run the check where the dump was made, matching `:42`'s style — `docker compose -f docker-compose.yml -f compose.prod.yml exec -T db pg_restore --list < "$file" | grep 'TABLE public geozones' >/dev/null` — after which `postgresql-client` can come out of runbook `:371`, its only stated purpose.

**P8 — §9 understates the risk N6 accepted: a classic PAT's `read:packages` is not "one repo's packages".** `docs/runbooks/hetzner-deploy.md:543`, and the same phrasing at `:137`.

- N6's decision (keep the login on the box so §5.2's rollback `pull` works) is recorded in three places, which is exactly right — the point of writing an accepted risk down is that the next reader can overrule it. But the record says "Read-only, **one repo's packages**". `GHCR_TOKEN` is a **classic** PAT (`deploy.yml:20-21`, runbook `:137`), and classic-PAT scopes are account-wide: `read:packages` reads every package the account can see, not this repo's. Whoever holds the deploy user's shell holds that.
- Identical in effect today — the account has one private package — and that is why this is Low rather than a re-opening of N6. The fix is to the *record*, so the acceptance is on the true premise.
- Fix: "Read-only, but account-wide — a classic PAT's `read:packages` covers every package the account can see, not just this repo's. One private package exists today." A repo-scoped fine-grained token, or `docker logout` plus a documented rollback login, are the two ways out if that reads worse once written down.
- Note: the `code-reviewer` agent raised the `docker logout` line independently, not knowing it had been decided. It is N6, accepted and recorded; not re-raised here.

**P9 — `API_DOMAIN` has two sources of truth and nothing compares them.** `.github/workflows/deploy.yml:141, 145-146` vs `compose.prod.yml:72`.

- The external health probe reads the repo variable `vars.API_DOMAIN`; Caddy reads the host env file through the compose overlay. Change one and not the other and the last gate in the workflow measures a different origin from the one just deployed: if the stale name still resolves and answers, the deploy goes green against the wrong host; if it does not, the deploy goes red while the stack is fine.
- Fix: read it back from the box in the "Pull, migrate, restart" step rather than duplicating it, or assert equality in the health step and fail on a mismatch instead of probing the stale name.

## What was verified, and how

`observed` 2026-09-03 in the `taxi-141` worktree at `76361e0`, docker 29.2.1 / compose 5.1.0, unless labelled otherwise.

| Round-2 finding | Fix in tree | Independently reproduced |
|---|---|---|
| **N1** (high) the deploy stops after the migration | `deploy.yml:113` and `:122` take `</dev/null`; a six-line comment names the mechanism | **Yes, real docker, no shims.** `printf '<cmd>\necho AFTER\n' \| bash -s`: `docker compose exec -T db true` → **no AFTER**, exit 0; with `</dev/null` → **AFTER**. `docker compose run --rm db true` → **no AFTER**, exit 0; with `</dev/null` → **AFTER**. |
| **N1, completeness** — are two redirects the whole set? | — | **Yes.** Every executable line in `:101-137` enumerated: `set`, `cd`, `echo\|docker login`, `export`, `compose=`, `pull`, `run`, `up -d`, `exec`, the env-file block (`grep`/`sed`/`tail`/`echo`, all file operands), `prune -af`, `ps`. Only `run` and `exec` consume the script. Controls in the same `bash -s` shape all print their marker: `compose ps`, `docker image prune -af`, `compose up -d --wait`, and — the one that could have broken the fix — `echo bogus \| docker login ghcr.io -u nobody --password-stdin` (`:103`), whose stdin is the `echo` pipe. Heredoc escaping checked too: every `$compose`, `$(…)` and backtick inside the body is escaped; the only unescaped expansions are the three intended (`$GHCR_TOKEN`, `$GHCR_USER`, `$TAG`). |
| **N2** (medium) the trap deletes a validated dump | `backup-db.sh:60` `trap - EXIT` after the geozones check | **Yes, under my own shims** (`docker`, `pg_restore` emitting a 300 002-line listing, `rclone`, `stat`), three cases × both versions: valid dump + upload OK → both exit 0, 1 local file; `pg_dump` fails → both exit 1, **0** files (F9 intact); `rclone copy` fails → `711d840` exit 1 with **0** files, head exit 1 with **1**. Premise checked separately: `:14` is `set -euo pipefail`, so `-e` is in force and clearing the trap does not swallow the failure — had it been `set -uo pipefail`, the disarm would have turned a failed upload into exit 0 and inverted N2 entirely. Cost of the fix: **P5**. |
| **N3** (low) unescaped password in `DATABASE_URL` | `compose.prod.yml:38-41`; runbook §3 row | present, and the prescription is right — the character list is **P4** |
| **N4** (low) the Stripe-conditioned safety claim | seven places | **Yes, and the subject grep is clean.** `grep -rn 'money moves'` and `'no Stripe key\|without a Stripe key\|card rides are refused'` across the tree: no surviving copy. The other `ALLOW_STUB_MAPS_PROVIDER` hits (`mvp-traceability.md`, `services/api/CLAUDE.md`, `stub-maps.provider.ts`, `geo/index.ts`, the two specs) never carried it; the PR body carries it only where it is quoted as the thing retired. Two of the seven — both in `.claude/plans/` — are *annotations* beside the original text rather than rewrites; the plan states that choice deliberately ("left as written so the record shows what was corrected"), consistent with D9. |
| **N5** (low) job timeout + `up --wait-timeout` | `deploy.yml:68`, `:117` | present; the derivation behind `120` is **P3** |
| **N6** (low) the box keeps its GHCR login | runbook `:137`, §5.2, §9 `:543` | read; all three agree and the decision is sound. What is accepted is described too narrowly — **P8** |

**Standards pass** (`CLAUDE.md`, `services/api/CLAUDE.md`), checked rather than inferred: `CardPaymentsDisabledProvider` lives in `features/payments/` and is deliberately not re-exported (`payments/index.ts` exports the module, factory, `SettlementService`, the key helper and the token only); no deep import into any slice in the diff; grepping `from 'stripe'` / `from 'twilio'` / `@googlemaps` repo-wide returns only the three files inside the payments slice, so `index.ts:9`'s "the Stripe SDK is imported in no file outside this folder" still holds; `PaymentsProvider`, `PaymentChargeResult`, `MapsProvider` all come from `@taxi/shared` with no local twin; the largest shipped file in the diff is `env.schema.ts` at 396 lines and there is no `eslint-disable` of any kind in it; money is integer cents throughout the specs; `migrate-run.ts`'s `console.*` is right for a standalone CLI and matches `seed/run.ts`; the ride state machine and `isPaymentMethodLocked()` are untouched. Workflow permissions are least-privilege and argued (build `contents: read` + `packages: write`, deploy `contents: read`, no top-level block), the host key is pinned with no `StrictHostKeyChecking=no` anywhere, and nothing is echoed (`SSH_KEY` only ever reaches `printf … > file`, no `set -x`).

## Validation

`pnpm turbo run typecheck lint test build --force`, from cleared `dist`/`.next`/`.turbo`, `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6381`. **Run twice at the same HEAD**, because the first was red.

| Run | Result |
|---|---|
| **A** (first) | **RED.** `Failed: @taxi/api#test` — `Test Suites: 1 failed, 72 passed, 73 total`, `Tests: 3 failed, 676 passed, 679 total`. All three are 20 000 ms timeouts in `src/features/drivers/push-token.integration.spec.ts` (suite 40.4 s). Jest then did not exit; killed, so turbo reported 137. |
| `push-token.integration.spec.ts` alone | **5 passed in 1.475 s.** |
| `@taxi/api` package alone | **exit 0, 73 suites / 679 tests passed.** |
| **B** (re-run, same HEAD, same command) | **exit 0, 20/20 tasks, 1 m 3 s.** api 679 / 73 · dispatch 224 / 27 files · shared 211 / 23 files · driver 109 / 27 · db 17 / 3 files. |

**Not a regression from this PR.** `push-token.integration.spec.ts` arrived on `main` with #14 (`43391c9`); nothing in this branch touches `features/drivers` or push. It is the flake class the root `CLAUDE.md` already documents for payments/customers — passes alone, times out under full-gate contention — with a new member, and it is worth its own issue. The PR body's gate claim re-derives exactly on run B.

## Numbers pass

Every figure the round-2 commits added or relabelled. Round 2's table covers the rest, and the base has not moved.

| Figure | Where | Provenance claimed | Re-derived |
|---|---|---|---|
| 34 files, **+1,494 / −90** | PR body | "at HEAD" | **stale — +1,568 / −91 at HEAD** (P1); +1,494 / −90 is `a6481aa..711d840` |
| 11 added, 23 modified | PR body | observed | `--diff-filter=A`/`M`: 11 / 23, holds |
| "**Two** commits on `a6481aa`" | PR body | — | **four** (P2) |
| exit 0, 20/20 tasks, 70 s | PR body | observed at round-2 head | run B: exit 0, 20/20, 1 m 3 s |
| api 679 / 73 · dispatch 224 / 27 · shared 211 / 23 · driver 109 / 27 · db 17 / 3 | PR body | observed, re-run for this body | run B: identical, all five |
| `+3`, `+2/−1`, `+5/−2`, `+4` test cases | PR body | observed, the body's own grep | identical, all four, at HEAD |
| 388 MB · 81 MB · 79,824,202 bytes | PR body, Dockerfile header, report | **observed at `711d840`**, and says so | not re-measured, and does not need to be: `git diff 711d840..76361e0` touches no image input — `Dockerfile`, `.dockerignore`, `db/`, the manifests and the lockfile are all untouched, and the two `services/api` files in the delta change docblocks only. Correctly labelled with its commit. |
| `/health` 1 s; seven gates each exit 1; 11 `.sql` + 11 migration rows | PR body | observed at `711d840` | same reasoning; round 2 re-observed all of them |
| N1: pre-fix **5 of 11** markers, post-fix **11 of 11** | PR body, runbook §4 step 2 | observed | 11 = the executable lines `cd` … `ps` (`set` excluded); 5 = `cd`, `login`, `export`, `compose=`, `pull` — the lines before the migration. Consistent with the enumeration above, and the mechanism reproduced independently against real docker. |
| N2: three cases × two versions | PR body, report | observed under shims | **re-run under my own shims: identical, all six cells** |
| N5: `up -d --wait --wait-timeout 45 api` → exit 0 in 12 s; `PUSH_PROVIDER` removed → exit 1 in 15 s | PR body, report, runbook §3 | observed | not re-run. Correct about the *gates*; **not** evidence for the shipped project-scoped `--wait-timeout 120` (P3). |
| `--wait-timeout 120` ← "20 + 5 × 10 = 70 s" | `deploy.yml:114-116`, report `:100` | derived | **arithmetic sound, case wrong** (P3): 70 s is the give-up deadline, and the flag is project-scoped while the sum covers one service. Cold `db` to healthy `observed` 6 s locally, so the shipped ceiling is not at risk. |
| "`@`, `/`, `:`, `#` or `%` breaks `pg`'s URL parser" | `compose.prod.yml:38-41`, runbook `:204` | stated as fact | **two false, one missing, one inverted** (P4) — `observed` against `pg-connection-string` 2.14.0 in this tree |
| N4 "**seven** places, not the three the review named" | PR body, report | observed via subject grep | seven confirmed, no eighth survives; two of the seven are annotations rather than rewrites |
| €6.09 = 4.49 + 0.60 + 1.00; €21.24; €47.98 | PR body, runbook §7 | derived | unchanged since round 1, re-checked there |

## Guarantees pass

**Not triggered.** Phase 1's `baseRefOid` is `a6481aaadef63712264e569a8f237db416b9e6be`; round 2's header records the same. The base has not moved. Round 1's standing note carries forward unchanged and is the reason `PUSH_PROVIDER` was missed once already: **if the base moves, rebuild the image and boot it with the runbook's §3 environment — the gate never boots the app under `NODE_ENV=production` and cannot see a new production throw.**

## What is good

- **N1 was fixed at the mechanism, not the symptom.** The redirect went on exactly the two commands that need it, and the comment explains *why the other four do not* — a claim I could try to falsify in one command and could not. `docker login --password-stdin` two lines above is the trap this fix could have fallen into and did not.
- **`trap - EXIT` is argued rather than placed.** The comment at `backup-db.sh:54-59` says what the trap was for, why its job is done, what a later failure must now do instead, and what the operator will and will not see in the log. That last clause is the one most people omit — and it is what let P5 be written as a refinement rather than a discovery.
- **N4 is the model of what the grep-the-subject rule asks for.** The review named three files; the author grepped the noun, found seven, and fixed the plan's *acceptance criterion* — the copy that would have re-taught the false claim to the next implementation pass. That is retiring the subject, not the sentence.
- **`CardPaymentsDisabledProvider` picks its refusal reason by who can act on it** (`card-payments-disabled.provider.ts:22-33`): a 402 would tell a driver the rider's card failed when no card was ever seen. It logs nothing and says why — the settlement service already carries the ids this class never sees. Restraint, argued.
- **`payments.module.spec.ts:50-61` asserts behaviour over class identity and says why** (`not.toBeInstanceOf(StubPaymentsProvider)` "could never fail on its own"). That is the difference between pinning the property and pinning the implementation.
- **The maps switch is scoped to one clause and dated to an event, not a ticket.** `geo.module.ts` reports both production gaps in one throw, so the deploy that fixes routes does not discover the dead typeahead from a support call; `env.schema.ts` names the due date as the pilot opening and explicitly refuses the tempting inference that an empty Stripe key makes a haversine quote safe.
- **The runbook now says which half of each claim was run.** §3's "`up -d --wait` fails the deploy" carries its own run, §4 step 2 carries the marker count, §5.2 and §9 carry N6's accepted risk. A reader can tell read-off-the-file from ran-it — which is the only reason P3, P4 and P8 are findings about wording rather than about trust.

## Recommendation

**Request changes.** Not for the code — for four claims and five one-liners. P1 and P2 are two sentences; rounds 1 and 2 both requested changes for less. The reason to spend a round on them is that it is the second time in this PR that a body claim true at one head was relabelled at another and shipped unaudited — round 1's F1 was the first, and it hid a production boot that did not work. The body is also the one artefact that outlives the branch and is not in the working tree, so nothing else catches it. A conditional approve does not enforce a condition; this does.

P3 and P4 are prose in files that already exist, and both have propagated to a second surface, so fix the pair together and grep the noun. P5–P9 are the author's call: P6 (`umask 077`) is one word and worth taking now; P7 is latent until the first Postgres major upgrade but the failure mode is silent and nightly; P8 is a correction to a record, not a reopening of N6.

Next: `piv-fix-review-findings` on this file, then merge. Nothing here touches the suite, so expect run B's counts unchanged — and if `push-token.integration.spec.ts` times out again, that is the flake, not the fix. Round 4, if there is one, compares its `baseRefOid` against `a6481aaadef63712264e569a8f237db416b9e6be` above.
