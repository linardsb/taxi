# Code review — PR #147, round 1

**PR** https://github.com/linardsb/taxi/pull/147 · `feat(deploy): Hetzner environment — image, host stack, deploy, runbook (#13)`
**Head** `dff4c4f` · **Base** `main` @ `a6481aaadef63712264e569a8f237db416b9e6be` · reviewed 2026-09-03 in the `taxi-141` worktree, detached at head
**Implementation report** `.claude/reports/deploy-hetzner-environment-report.md` — D1–D10 read as decisions, not findings
**Prior rounds** none

## Summary

**Request changes.** The gate is green at head and the two provider gates are correct, but the PR's central claim, that production can now boot, is false at head. Between the 25 August observation and the 2 September rebase, `main` gained a fourth production boot gate (`PUSH_PROVIDER`, #14, commit `43391c9` on 2026-08-31). The runbook does not set it, so a first deploy that follows the runbook fails at `up -d --wait`. One variable fixes the boot; the defect is that the boot was not re-run after the base moved, while the PR body says the inputs were unchanged.

Three further mediums: the runtime image is 2.38 GB and carries the Expo, Next and React Native trees plus jest and typescript, against a Dockerfile comment that says it carries none of that; the backup script's sanity check can fail falsely under `pipefail`; and the workflow ships a new Caddyfile to the box without reloading Caddy.

Counts: **1 high · 3 medium · 9 low**.

## Findings

### High

**F1 — the runbook's production environment does not boot at head.** `docs/runbooks/hetzner-deploy.md:198-238` (§3 table and template), `:473-484` (§8.3 gate table), PR body (Summary, Validation).

- `observed` 2026-09-03: image built from head (`docker build -f services/api/Dockerfile`, exit 0), run with every §3 variable set (switch on, a fake Maps key, a fake Twilio trio, no Stripe key) against a scratch Postgres the image's own runner had migrated. The container exits at boot: `No production PushProvider is bound: StubPushProvider delivers nothing. Set PUSH_PROVIDER=expo (#14) before running with NODE_ENV=production.` The same environment plus `PUSH_PROVIDER=expo`: `/health` answers `{"status":"ok","service":"api"}` 1 s after start.
- Cause: `services/api/src/features/push/push.module.ts:16-26` on `main` (`43391c9`, 2026-08-31, PR #139) throws in production unless `PUSH_PROVIDER=expo`. This PR's base moved from `1e8d1c2` to `a6481aa`, which contains it. The PR body's "Observed 2026-08-25 on the pre-rebase tree `1e8d1c2`, not re-run (inputs unchanged by the rebase)" is wrong on its condition: the boot's inputs changed (a new gate; also 11 migrations, not the report's 10). The gate is not evidence for a production boot: no test in the tree boots the app under `NODE_ENV=production`, so this can only be caught by running the image.
- Fix: add `PUSH_PROVIDER=expo` (and the optional `EXPO_PUSH_ACCESS_TOKEN`, empty) to the §3 table and the template, a seventh row to the §8.3 gate table (`PUSH_PROVIDER` unset → `No production PushProvider is bound`), and rewrite the PR body: four gates, not three, and replace "inputs unchanged" with what changed. Then re-observe the boot at head and say which run in the body. The report's line 7 ("the three provider gates") is dated history and can stay if the body is right.

### Medium

**F2 — the runtime image is 2.38 GB and the Dockerfile's prune claim is false.** `services/api/Dockerfile:12-15, 61-63`.

- `observed` 2026-09-03 on the head image: `docker image ls` 2.38 GB; `docker save | gzip -1` 535,327,427 bytes; the `COPY /app/node_modules` layer is 1.62 GB; inside, `du -sm node_modules` is 1,547 MB and the largest entries are `@expo` 474 MB, `next` 173 MB, `@next` 125 MB, `react-native-worklets` 119 MB, `expo-sqlite` 76 MB, `hermes-compiler` 47 MB, `react-native` 37 MB; `jest`, `typescript` and `ts-node` are present. `drizzle-kit` and `@nestjs/cli` are absent, so `--prod` was honoured and `--filter @taxi/api...` was not.
- The comment at lines 12-15 says the runtime "carries no compiler, no drizzle-kit, no jest". Two of the three are false by observation. `expected`, not verified: `node-linker=hoisted` resolves the whole lockfile on a filtered install, which is why the apps' dependency trees are there.
- Consequence, `derived`: every deploy whose lockfile changed (an Expo bump in `apps/driver` included) pushes and pulls a new 1.62 GB layer, and with F5 those layers stay on the 40 GB box. `expected`: GitHub Packages' Free plan allows 500 MB of private package storage, which one push of this image exceeds; not checked against the account's plan.
- Fix: produce the runtime tree with `pnpm --filter @taxi/api deploy --prod --legacy /app/deploy` in the `prod-deps` stage (pnpm's pruned single-package output; workspace packages are copied in), or any other approach whose result is measured. Acceptance: `docker run --rm <image> du -sm node_modules` in the Dockerfile comment with its figure, and a boot, per the report's own rule that the image is validated by running it.

**F3 — the backup's sanity check can fail falsely under `pipefail`.** `scripts/backup-db.sh:14, 35`.

- `grep -q` exits at the first match; if `pg_restore --list` then writes again it takes SIGPIPE, the pipeline's status becomes 141 under `set -o pipefail`, and `if ! …` reads that as "no geozones table": the script prints `backup FAILED`, exits 1, and nothing is uploaded that night although the local dump is valid. Mechanism `observed`: `bash -c 'set -o pipefail; seq 1 300000 | grep -q 1; echo $?'` → `141`.
- Condition at head, `observed` on a scratch database with the 11 migrations and no rows: the listing is 7,654 bytes over 130 lines and the match is on line 42. `expected`: `pg_restore`'s piped stdout flushes in 4 KB blocks, so that is two writes and the window is between them: narrow today, wider with every table and index the schema gains.
- Fix: let grep consume the whole listing: `if ! pg_restore --list "$file" | grep 'TABLE public geozones' >/dev/null; then`.

**F4 — a Caddyfile change ships to the box and changes nothing.** `.github/workflows/deploy.yml:76-80, 99`; `compose.prod.yml:70`; `docs/runbooks/hetzner-deploy.md:44`.

- The workflow `scp`s the Caddyfile, but `docker compose up -d` recreates a service only when its config hash changes, and the content of a bind-mounted file is not part of that hash. Caddy reads its config at start only. So the first real Caddyfile change lands on disk and is not served until someone restarts the container; the workflow comment ("a change to the overlay or the Caddyfile ships with the next deploy") and runbook §0 ("synced by every deploy") promise more than the deploy does.
- Fix: after `\$compose up -d --wait`, add `\$compose exec caddy caddy reload --config /etc/caddy/Caddyfile` (zero-downtime; the admin API is on in the official image), or `\$compose restart caddy`, and one sentence in runbook §5.1.

### Low

**F5 — `docker image prune -f` keeps every tagged image.** `.github/workflows/deploy.yml:107`; `docs/runbooks/hetzner-deploy.md:295-296`. Without `-a` prune removes dangling images only; every pulled `sha-*` image keeps its tag, so the box accumulates one image per deploy and the runbook's "keeps the previous image until `prune`" describes the opposite. With F2's layer size that is 1.62 GB per lockfile-changing deploy, `derived`. Fix: `docker image prune -af` (images in use are never removed and §5.2's rollback already re-pulls), or correct the sentence and accept the growth.

**F6 — the `API_IMAGE_TAG` append breaks on a host `.env` with no trailing newline.** `.github/workflows/deploy.yml:102-106`. `echo "API_IMAGE_TAG=$TAG" >> .env` glues onto the last line when the hand-written file lacks a final newline (an editor default); the tag is never recorded, the `grep '^API_IMAGE_TAG='` keeps missing, every deploy appends again, and a by-hand `up` runs `latest`. Fix: before the append, `[ -z "$(tail -c1 .env)" ] || echo >> .env`.

**F7 — an empty `ALLOW_STUB_MAPS_PROVIDER=` refuses boot in every environment.** `services/api/src/common/config/env.schema.ts:212-215`. `.default('false')` substitutes only `undefined`; dotenv delivers `''` for a blanked line, which `z.enum` refuses in dev and test too, with a generic enum message rather than the gate's. Every sibling (`GOOGLE_MAPS_API_KEY`, `STRIPE_SECRET_KEY`, the Twilio trio) maps `''` to unset. Fail-closed, so not unsafe, but untested and therefore accidental. Fix: preprocess `''` to `undefined` like the siblings, or add the failure case to `env.schema.spec.ts` so the refusal is chosen.

**F8 — the payments factory's failure case cannot fail independently.** `services/api/src/features/payments/payments.module.spec.ts:40-47`. `not.toBeInstanceOf(StubPaymentsProvider)` is implied by the `toBeInstanceOf(CardPaymentsDisabledProvider)` three lines above, so the expected/edge/failure triple is met on paper. Fix: make the failure case exercise the property the old throw protected: the production provider's `charge()` resolves `ok: false`.

**F9 — a failed `pg_dump` leaves a truncated dump under the real name.** `scripts/backup-db.sh:24, 30-31`. `set -e` exits on a failed dump with the partial `taxi-<stamp>.dump` in place, and the script's own `backup FAILED` line fires only for the geozones check; a `ls -t | head -1` restore (runbook §6.2's own idiom) would pick it. Fix: `trap` on EXIT that removes `$file` and logs when the status is non-zero.

**F10 — dumps carry phone numbers, names and addresses to R2 unencrypted.** `scripts/backup-db.sh:40`; `docs/runbooks/hetzner-deploy.md:335-345`. The only protection is the bucket token. rclone's `crypt` remote wraps the existing remote in one `rclone config` step and changes nothing in the script; the passphrase's location belongs in §6.1 (a lost passphrase is a lost backup).

**F11 — the sshd hardening can be overridden by a drop-in and is never verified.** `docs/runbooks/hetzner-deploy.md:88`. Ubuntu 24.04's `sshd_config` starts with `Include /etc/ssh/sshd_config.d/*.conf` and sshd keeps the first value it reads, so a cloud-init drop-in wins over the `sed`'d lines. §1.2 checks that key login works, not that password login is off. Fix: write `/etc/ssh/sshd_config.d/00-hardening.conf` instead of `sed`, then `sshd -T | grep -Ei 'passwordauthentication|permitrootlogin'` before closing the root shell.

**F12 — the `deploy` job has no `permissions:` block.** `.github/workflows/deploy.yml:60`. Its `GITHUB_TOKEN` inherits the repository default while the job only checks out. Fix: `permissions: contents: read`.

**F13 — every refused card charge logs twice.** `services/api/src/features/payments/card-payments-disabled.provider.ts:44-49`. `SettlementService.logChargeFailed` already emits `payment.settlement.charge_failed` with a strict superset of these fields, and the class doc names that line as the one the runbook reads. The event name and fields here are otherwise compliant with the logging standard. Fix: drop the logger, or downgrade to `debug`.

## Validation

All `observed` 2026-09-03 at `dff4c4f` in the `taxi-141` worktree, `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL` on 6381, from cleared `dist` and `.next`.

| Check | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` | exit 0, 20/20 tasks, 1 m 12 s |
| `@taxi/api` test | 73 suites, 678 tests, 0 skipped |
| `@taxi/dispatch` · `@taxi/shared` · `@taxi/driver` · `@taxi/db` | 224 · 211 · 109 (27 suites) · 17 passed |
| `docker build -f services/api/Dockerfile .` | exit 0 (layer cache warm from the author's 2 September build: 2.8 s wall) |
| Inside the image | 11 `.sql` + `meta/_journal.json` at `db/migrations`; user `node`; `NODE_ENV=production`; `db/dist/seed/run.js` present |
| `node db/dist/migrate-run.js` twice, scratch DB | exit 0 both; `drizzle.__drizzle_migrations` has 11 rows |
| Production-shaped boot, runbook §3 variables | **fails**: `No production PushProvider is bound` (F1) |
| Same plus `PUSH_PROVIDER=expo` | `/health` ok 1 s after start |
| Gate: switch off | exit 1, `No production MapsProvider is bound: StubMapsProvider prices rides off straight-line distance … (set ALLOW_STUB_MAPS_PROVIDER=true …)` |
| Gate: Twilio trio unset | exit 1, `No production SmsProvider is bound` |
| `docker compose -f docker-compose.yml -f compose.prod.yml config` | refuses without `POSTGRES_PASSWORD` (the `:?` message); with both variables renders with only 80 and 443 published |

## Numbers pass

Every figure in the PR body and the runbook, with what produced it.

| Figure | Where | Provenance claimed | Re-derived |
|---|---|---|---|
| 34 files, +1,384 / −89, 11 added, 23 modified | PR body | observed | `git diff --stat a6481aa..dff4c4f` and `--diff-filter=A/M`: identical |
| 20/20 tasks, 85 s; api 678/73; dispatch 224/27; shared 211/23; driver 109/27; db 17/3 | PR body, gate | observed 2026-09-02 | my run: same counts; 72 s |
| `+3`, `+2/−1`, `+5/−2`, `+3` test cases | PR body | observed | the body's own grep at head: identical |
| 11 migration files in the image | PR body | observed 2026-09-02 | 11 `.sql` at head and in the image |
| `migrate:run` twice, "Migrations up to date" | PR body, "not re-run, inputs unchanged" | observed 2026-08-25 | re-observed at head against a scratch DB; **the input did change** (10 → 11 migrations), the result holds |
| production boot, `/health` ~2 s | PR body, "not re-run, inputs unchanged" | observed 2026-08-25 | **does not hold at head** (F1); 1 s once `PUSH_PROVIDER` is set |
| six gates each exit 1 naming the variable | runbook §8.3 | observed 2026-08-25 | two re-observed at head (maps switch, Twilio); a seventh gate exists and is not in the table (F1) |
| 57,015-byte dump, 4 geozones, 24 rides, 10 migrations | PR body, runbook §6.2 | observed 2026-08-25 | not re-run; the "10 migrations" count is the pre-rebase tree's and the text says so by date; a scratch schema-only dump at head is 44,197 bytes |
| €4.49 CX22, €0.60 IPv4, €8.49 CX33, €0.0143/GB snapshot, €5.49 research infra | runbook §1.1, §7, §10 | observed 2026-08-14 | each present in `docs/research/hosting-sms-cost-research.md` |
| €6.09 = 4.49 + 0.60 + 1.00; €21.24 = 6.09 + 15.15; €47.98 = 6.09 + 41.89 | PR body, runbook §7 | derived | arithmetic correct; 15.15 and 41.89 are the research's §4.3 table (lines 240, 242) |
| €0.30 demo day | runbook §10 | derived, research §3 note 4 | research line 126 |
| 59 chars, 11 to spare, 70-char UCS-2 limit | runbook §2.1 | none stated | issue #136 body, `observed` there from the segmenter run |
| ~750 MB OSRM RSS | runbook §10 | expected | no source in the tree; labelled honestly |
| Socket.IO ping every 25 s, Cloudflare ~100 s idle | runbook §2.4 | expected | no `pingInterval` override in the api, so the default holds; the Cloudflare figure is labelled expected |
| `JWT_SECRET` refused under 32 chars in production | runbook §3 | none stated | `MIN_PRODUCTION_SECRET_LENGTH = 32`, `env.schema.ts:17` |
| seed re-asserts `commissionPct = 15` and the €50 limit on conflict, `dispatchPhone` excluded | runbook §4 | none stated | `db/src/seed/riga.ts:182-184` |
| "the runtime carries no compiler, no drizzle-kit, no jest" | Dockerfile:12-15 | implied observed | **false for jest and typescript** (F2) |
| "the box keeps the previous image until `prune`" | runbook §5.2 | none stated | **false**: `prune -f` keeps tagged images (F5) |

Two claims not verifiable from here and labelled as such in the PR: the Cloudflare idle limit and the spend, both awaiting the runs the runbook's §7 log names.

## Rebase notes for round 2

This PR's base has moved once and the move produced F1. If it moves again before merge, the check that closes it is a production-shaped boot of the head image with the runbook's §3 variables, not the gate: nothing in the suite boots under `NODE_ENV=production`, so a green gate cannot see a new boot gate. Grep `main` for `NODE_ENV === 'production'` throws added since `a6481aa` before re-running.

## What is good

- Refusal at call time instead of pretend success for payments, argued against the seam's own contract and written where the next reader looks: class doc, factory doc, barrel KNOWN GAPS, runbook §9, with the booking-time corollary spelled out. The refused path was traced: `settle()` → `chargeIfNeeded()` → 502 before any transaction opens, no ledger row, no status write, the ride stays `completed`.
- The maps switch is single-purpose: the Places refusal survives, both gaps are reported in one throw, and the spec covers every combination including the non-production no-op.
- The image was validated by booting it, and the report says so: the workspace-symlink failure and the "journal missing throws loudly" correction both came from runs, not from reading the plan's GOTCHA. F1 is what happens when that discipline is applied once and then inherited across a rebase.
- Provenance discipline in the runbook: every figure labelled, the invoice section left honestly empty, the restore rehearsed with counts.
- The deploy script's threat model is in its comments and the mechanics match them: the PAT travels on stdin to a builtin `echo`, the host key is pinned and an empty `SSH_KNOWN_HOSTS` fails closed, migrations run with the new image before `up`.

## Recommendation

**Request changes.** F1 is the blocker: the runbook must boot the image at head, and the PR body must stop saying the boot was observed on unchanged inputs. F2, F3 and F4 are each a small change with a measurable acceptance. F5–F13 are the author's call; F5 and F6 sit in the same ten lines of the workflow as F4.

Next: `piv-fix-review-findings` on this file, re-run the gate, and re-observe the boot at the new head. Round 2 compares its `baseRefOid` against `a6481aaadef63712264e569a8f237db416b9e6be` above.
