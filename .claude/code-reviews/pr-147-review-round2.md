# Code review — PR #147, round 2

**PR** https://github.com/linardsb/taxi/pull/147 · `feat(deploy): Hetzner environment — image, host stack, deploy, runbook (#13)`
**Head** `711d840` · **Base** `main` @ `a6481aaadef63712264e569a8f237db416b9e6be` · reviewed 2026-09-03 in the `taxi-141` worktree at head
**Implementation report** `.claude/reports/deploy-hetzner-environment-report.md` — D1–D10 read as decisions, not findings; its "Review round 1 — fixes" section is what this round audits
**Prior rounds** round 1 at `dff4c4f` (`.claude/code-reviews/pr-147-review.md`, PR #148): 1 high · 3 medium · 9 low; author reports F1–F9, F11–F13 fixed in `711d840`, F10 → #149

## Summary

**Request changes**, for one new high that the round-1 fixes could not have surfaced because the workflow has never run. The deploy script travels to the box on stdin (`ssh … 'bash -s' <<EOF`), and `docker compose run` and `docker compose exec` forward stdin into the container by default. The migration step therefore swallows every line after it: `up -d --wait`, the Caddy reload, the `API_IMAGE_TAG` record, the prune. The step exits 0 on the migration's own status, the old image keeps running against the new schema, and on the first deploy nothing starts at all while the job goes green. `observed` here with the same shell shape; the fix is `</dev/null` on two lines. One medium: the F9 trap removes a validated dump when the upload fails, which the pre-fix script did not.

Everything else holds. Every round-1 finding the author marked fixed is fixed in the tree, and every figure and every "observed" claim in the PR body's round-1 section re-observes at head from this worktree: the image built from `711d840` is 388 MB with 81 MB of `node_modules` and none of the eight packages named, it migrates a scratch database twice, boots with the runbook's §3 variables to `/health` in 1 s, and each of the seven gates (plus the empty-switch case F7 added) exits 1 naming its variable. The backup script's two fixes were re-run under shims against both the pre-fix and the fixed script, and the two mutants the report describes for F8 fail the cases it says they fail. The base has not moved since round 1 (`baseRefOid` unchanged), so the guarantees pass is not triggered.

Counts: **1 high · 1 medium · 4 low**.

## Findings

### High

**N1 — the deploy stops after the migration: `compose run` and `compose exec` eat the rest of the script.** `.github/workflows/deploy.yml:94-124`, specifically `:102` and `:108`.

- The remote script arrives on stdin (`ssh … 'bash -s' <<EOF`). Bash reads a non-seekable script one line at a time precisely so a child can consume what follows, and compose v2's `run` and `exec` both default to `--interactive` (`-T` drops only the TTY), so the docker CLI reads the rest of the script off stdin and forwards it into the migrator container, which ignores it. Bash then hits EOF after the migration and exits with its status.
- `observed` 2026-09-03, same shape locally (`printf … | bash -s`, compose 5.1.0): `docker compose run --rm one` followed by `echo AFTER` → nothing printed; the same with `</dev/null` → `AFTER`; `docker compose exec -T sleeper true` followed by `echo AFTER` → nothing; with `</dev/null` → `AFTER`; control without docker → `AFTER`.
- Consequence, `derived` from the script order: on a routine deploy the migration runs with the new image, then `up -d --wait`, `caddy reload`, the `API_IMAGE_TAG` record and `prune` never run; the old API keeps serving against the new schema; the job is green and the "Health from the outside" step passes against the old image. On the **first** deploy, `run` starts `db` and `redis` as dependencies, migrates, and stops: no `api`, no `caddy`, health step skipped (`API_DOMAIN` unset), job green, nothing listening. Not observed on a box (the PR says the workflow has never been dispatched), but the mechanism needs no box.
- Fix: `</dev/null` on both lines — `\$compose run --rm api node node_modules/@taxi/db/dist/migrate-run.js </dev/null` and `\$compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null` — with a one-line comment naming why (the script is on stdin and compose forwards stdin by default). `--interactive=false` on each is the equivalent. Acceptance: the local shape above with the workflow's own lines, `echo AFTER` printing after each; and the runbook's §4 step 2 stays true.

### Medium

**N2 — the F9 trap deletes a validated dump when the upload fails.** `scripts/backup-db.sh:30-37, 55-57`.

- The EXIT trap removes `$file` on any non-zero status, and it is armed for the whole script. `rclone copy` failing (expired R2 token, network) exits under `set -e` → the trap removes the local dump that had just passed the geozones check → nothing remote, nothing local. The same for a failing `rclone delete` or `find` after a successful upload. Before F9 the local copy survived every post-dump failure, which is what §6.1's "local copies are a convenience for a fast restore" relies on.
- `observed` 2026-09-03 under the round-1 shims with `rclone copy` made to fail: head → exit 1, 0 local files, `backup FAILED (exit 1): removed …`; pre-fix `dff4c4f` → exit 1, 1 local file left.
- Fix: disarm after the sanity check — `trap - EXIT` on the line after the `fi` at `:53` — so the trap covers the dump and the check only; keep the non-zero exit so the cron log still shows the upload failure. Acceptance: the shim run above leaves 1 file at head; the F9 case (failing `pg_dump`) still leaves 0.

### Low

**N3 — the composed `DATABASE_URL` assumes a URL-safe password.** `compose.prod.yml:38`; `docs/runbooks/hetzner-deploy.md` §3 `POSTGRES_PASSWORD` row. `postgres://taxi:${POSTGRES_PASSWORD}@db:5432/taxi` interpolates the value unescaped; `@`, `/`, `:`, `#`, `%` break `pg`'s parser, and the `:?` guard checks presence only. Safe today solely because §3 prescribes `openssl rand -hex 16`. Fix: say "hex only — it is interpolated into a URL unescaped" in the compose comment and the §3 row.

**N4 — "no Stripe key, so no money moves off a bad quote" overstates what the Stripe condition buys.** `services/api/src/common/config/env.schema.ts:202-206`; `.env.example` `ALLOW_STUB_MAPS_PROVIDER` comment; runbook §3 row. A cash ride quoted straight-line × 1.35 is real money at the kerb; the absence of a card rail covers card rides only. Every one of the three texts also requires "the pilot is closed", which is the load-bearing condition, so the conjunction is right and the parenthetical is not. Fix: reword so the switch's due date is the pilot opening, with Stripe absence as the card-rail half of it.

**N5 — the deploy job has no `timeout-minutes`.** `.github/workflows/deploy.yml:61`. The code-reviewer expected `up -d --wait` to hang on a boot-gate crash loop (health never leaving `starting` under `restart: unless-stopped`). `observed` 2026-09-03, compose 5.1.0, the head image with `PUSH_PROVIDER` unset and the overlay's healthcheck and restart policy: `up -d --wait --wait-timeout 45` exits 1 after 4 s, `container … is unhealthy`, `RestartCount 3`; without the restart policy, exit 1 after 2 s, `exited (1)`. So the runbook's "`up -d --wait` fails the deploy" (§3, §8.3) is true on this compose version and now has a run behind it. What remains is hygiene: with no job timeout, any failure shape that does hang runs to GitHub's 6 h default. Fix: `timeout-minutes: 20` on the deploy job and `--wait-timeout 120` on the `up`, and label the §3/§8.3 sentence `observed` with the version.

**N6 — the GHCR token persists on the box after the deploy.** `.github/workflows/deploy.yml:98`; runbook §5.2. `docker login --password-stdin` writes the PAT to the deploy user's `~/.docker/config.json`, where it stays after the run. The rollback in §5.2 relies on that persisted login for its `pull`. Either is defensible; the runbook should say which: `docker logout ghcr.io` at the end of the script and a by-hand `docker login` step in §5.2, or keep the login and say the box holds a `read:packages` PAT at rest.

## Round-1 fixes, verified at `711d840`

| # | Round-1 finding | Fix in the tree | Verified how |
|---|---|---|---|
| F1 (high) | runbook env did not boot: `PUSH_PROVIDER` missing | `docs/runbooks/hetzner-deploy.md` §3 table + template carry `PUSH_PROVIDER=expo` and `EXPO_PUSH_ACCESS_TOKEN=`; §8.3 has the seventh row and the "boot again after any base move" rule | `observed`: image built from head, runbook §3 variables, `/health` → `{"status":"ok","service":"api"}` 1 s after start; `PUSH_PROVIDER` removed → exit 1 `No production PushProvider is bound` |
| F2 (med) | 2.38 GB image, prune claim false | `services/api/Dockerfile:70-78, 83`: `pnpm --filter @taxi/api deploy --prod --legacy --frozen-lockfile /app/deploy`; runtime copies that one tree; header carries the measured figures and the commands | `observed`: `docker image ls` 388 MB; `du -sm node_modules` 81 MB, `/app` 86 MB; `@expo` `next` `react-native` `jest` `typescript` `ts-node` `drizzle-kit` `@nestjs/cli` all absent; `docker save \| gzip -1` 79,826,174 bytes (body says 79,824,202 — the tar carries the build's own ids and timestamps, so byte equality is not expected) |
| F3 (med) | `grep -q` under `pipefail` | `scripts/backup-db.sh:50`: `grep 'TABLE public geozones' >/dev/null` | `observed` under shims (`pg_restore --list` → 300,000 lines, match on line 42): pre-fix script exit 1 "no geozones table", head exit 0 with one `rclone copy`; mechanism alone `seq 1 300000 \| grep -q 1` → 141, `\| grep 1 >/dev/null` → 0 |
| F4 (med) | Caddyfile shipped, never reloaded | `.github/workflows/deploy.yml:108`: `\$compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile` after `up`; runbook §5.1 and §5.3 | read; correct in isolation (adapter inferred from the filename, admin API on in the official image) — **but it never runs at head, see N1** |
| F5 (low) | `prune -f` keeps tagged images | `deploy.yml:122`: `docker image prune -af`; runbook §5.2 rewritten to "the box does not keep the previous one, a rollback is a re-pull" | read; the sentence now matches the flag; also unreached at head (N1) |
| F6 (low) | `API_IMAGE_TAG` append without trailing newline | `deploy.yml:116`: `[ -z "\$(tail -c1 .env)" ] \|\| echo >> .env` — box-side (escaped `\$`), `$(…)` strips the trailing newline so a newline-terminated file reads empty | read; the heredoc is unquoted, so `$TAG` expands on the runner and `\$compose`/`\$(…)` on the box, which is the split the comment describes; unreached at head (N1) |
| F7 (low) | empty `ALLOW_STUB_MAPS_PROVIDER=` refused everywhere | `env.schema.ts:216-221`: `z.preprocess(v => v === '' ? undefined : v, z.enum([...]).default('false'))`; `Env['ALLOW_STUB_MAPS_PROVIDER']` still infers `boolean` | `observed`: the new spec case fails on the pre-fix schema with `Invalid enum value. Expected 'true' \| 'false', received ''` (1 failed, 30 passed) and passes at head; in the image, `ALLOW_STUB_MAPS_PROVIDER=` (empty) → exit 1 with the maps gate's own message |
| F8 (low) | factory failure case could not fail alone | `payments.module.spec.ts:58-69`: asserts `charge()` resolves `ok: false` | `observed`: provider mutant (`ok: true`) → this case fails while the factory's other three pass; factory mutant (stub in production) → this case and the expected case fail (2 failed, 2 passed) |
| F9 (low) | failed `pg_dump` leaves a partial dump | `backup-db.sh:30-37`: EXIT trap removes `$file` on non-zero status | `observed` under a failing `docker` shim: pre-fix leaves the file (1 file, exit 1); head removes it (0 files, exit 1, "backup FAILED (exit 1): removed …") — **fixed, and over-reaches, see N2** |
| F10 (low) | dumps unencrypted on R2 | deferred → #149 (open) | issue exists; not in this PR |
| F11 (low) | sshd hardening overridable, unverified | runbook §1.2: `sshd_config.d/00-hardening.conf` drop-in, `systemctl restart ssh`, `sshd -T \| grep -Ei '^(passwordauthentication\|permitrootlogin) '` | read; `00-` sorts before cloud-init's `50-`, sshd keeps the first value, `-T` prints lowercased keywords |
| F12 (low) | deploy job without `permissions:` | `deploy.yml:64-66`: `permissions: contents: read` | read |
| F13 (low) | refused charge logged twice | `card-payments-disabled.provider.ts`: no logger; `charge()` takes no argument | read; `settlement.service.ts:336` still emits `payment.settlement.charge_failed` with `reason`, `message`, `providerRef` |

## Validation

All `observed` 2026-09-03 at `711d840` in the `taxi-141` worktree, `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6381`, from cleared `dist` and `.next`.

| Check | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` | exit 0, 20/20 tasks, 1 m 12 s |
| `@taxi/api` test | 73 suites, 679 tests, 0 skipped |
| `@taxi/dispatch` · `@taxi/shared` · `@taxi/driver` · `@taxi/db` | 224 (27 files) · 211 (23 files) · 109 (27 suites) · 17 (3 files) |
| `docker build -f services/api/Dockerfile .` at head | exit 0, 34 s (layer cache warm) |
| Inside the image | 388 MB; `node_modules` 81 MB, `/app` 86 MB; user `node`; `NODE_ENV=production`; 11 `.sql` + `meta/_journal.json` at `node_modules/@taxi/db/migrations`; `dist/main.js`, `node_modules/@taxi/db/dist/{migrate-run,seed/run}.js` present; the eight named packages absent |
| `node node_modules/@taxi/db/dist/migrate-run.js` twice, scratch DB | exit 0 both, "Migrations up to date"; `drizzle.__drizzle_migrations` 11 rows |
| Production-shaped boot, runbook §3 variables incl. `PUSH_PROVIDER=expo` | `/health` → `{"status":"ok","service":"api"}` 1 s after start, no error-level log line |
| Seven gates, one at a time (`JWT_SECRET` published value · switch unset · localhost tracking URL · two of three `TWILIO_*` · no `TWILIO_*` · no `GOOGLE_MAPS_API_KEY` · `PUSH_PROVIDER` unset) | each exit 1 with the §8.3 message |
| Eighth: `ALLOW_STUB_MAPS_PROVIDER=` empty (F7) | exit 1 with the maps gate's message, not an enum error |
| `docker compose -f docker-compose.yml -f compose.prod.yml config` | refuses without `POSTGRES_PASSWORD` (the `:?` message); with both variables, published ports are 80 and 443 only |
| `up -d --wait --wait-timeout 45`, head image, `PUSH_PROVIDER` unset, overlay healthcheck + `restart: unless-stopped` (compose 5.1.0) | exit 1 after 4 s, `is unhealthy`; without the restart policy exit 1 after 2 s, `exited (1)` (N5) |
| `bash -s` over a pipe: `compose run --rm` / `compose exec -T` followed by `echo AFTER` | `AFTER` never printed; printed with `</dev/null` on the docker line; printed in the no-docker control (N1) |
| `scripts/backup-db.sh` under shims: pre-fix vs head × valid dump / failing dump / failing `rclone copy` | F3, F9 and N2 rows above |
| F7 spec on the pre-fix schema; F8 provider and factory mutants | the outcomes in the F7/F8 rows above; tree clean after (`git status` empty) |

Not re-run, and labelled so in the PR body: the Caddy reload run, the 2026-08-25 restore rehearsal, and everything that needs an account or a box.

## Numbers pass

Every figure in the PR body's round-1 additions and the runbook's new lines, with what produced it. Round 1's table covers the rest; the base has not moved and those lines are unchanged.

| Figure | Where | Provenance claimed | Re-derived |
|---|---|---|---|
| 34 files, +1,494 / −90, 11 added, 23 modified | PR body | observed at head | `git diff --stat origin/main..HEAD`, `--diff-filter=A` / `M`: identical |
| 20/20 tasks, 69 s; api 679/73; dispatch 224/27; shared 211/23; driver 109/27; db 17/3 | PR body, gate | observed 2026-09-03 | my run: identical counts, 72 s |
| `+3`, `+2/−1`, `+5/−2`, `+4` test cases | PR body | observed, grep at head | the body's own grep at head: identical |
| 388 MB · 81 MB · 79,824,202 bytes (2.38 GB · 1,547 MB · 535,327,427 at `dff4c4f`) | PR body, Dockerfile header, report | observed 2026-09-03 | 388 MB · 81 MB · 79,826,174 bytes on my build; the `dff4c4f` figures are round 1's own |
| `/app` 86 MB | report, Dockerfile header | observed | `du -sm node_modules /app` → 81 + 5 |
| 11 `.sql` + journal, 11 migration rows | PR body | observed | identical |
| `/health` 1 s | PR body | observed | 1 s |
| seven gates, each exit 1 naming the variable | PR body, runbook §8.3 | observed 2026-09-03 | all seven re-observed, plus the empty-switch case |
| "`up -d --wait` fails the deploy" on a gate | runbook §3 (after the template), §8.3 | none stated; the report's boots were plain `docker run` | **observed now** (N5): exit 1 in 4 s on compose 5.1.0 |
| "pull, **migrate with the new image**, `up -d --wait`, reloads Caddy, records `API_IMAGE_TAG`, prunes" | runbook §4 step 2, §5.1; workflow header | describes the script | **false at head**: the script ends after the migration (N1) |
| F7 failed first with `Invalid enum value … received ''` | PR body, report | observed | re-observed on the pre-fix schema |
| F8: factory mutant fails the failure and expected cases; provider mutant fails the failure case alone | report | observed | re-observed, both |
| backup script: pre-fix exit 1 on a valid dump, partial file left; head exit 0 with one upload, partial file removed | PR body, report | observed under shims | re-observed under my own shims; plus the N2 case the report did not run |
| `seq 1 300000 \| grep -q 1` → 141 | report, script comment | observed | 141; `grep … >/dev/null` → 0 |
| Caddy served only after `caddy reload`, exit 0 with and without a TTY | PR body, report | observed | not re-run; the mechanism (bind-mounted file content is not in compose's config hash) is the one round 1 stated |
| €6.09 = 4.49 + 0.60 + 1.00; €21.24; €47.98 | PR body, runbook §7 | derived | unchanged since round 1; sources re-checked in `docs/research/hosting-sms-cost-research.md` lines 97, 101, 240, 242 |
| "Two commits on `a6481aa`" | PR body | — | `git merge-base HEAD origin/main` = `a6481aa`; `origin/main` = `a6481aa` |
| `scripts/backup-db.sh` executable | cron line runs it directly | — | `new file mode 100755` in the diff |

## Rebase notes for round 3

The base is still `a6481aa`. If it moves before merge, round 1's note stands: boot the image with the runbook's §3 variables, the gate cannot see a new production throw. N1's acceptance is a local `bash -s` run, not a box; it does not need the base to move to be re-checked.

## What is good

- Every round-1 fix came with its own observation, and every one of those observations reproduced from a clean context with independent scripts: the shims, the mutants, the probe. That is the discipline round 1 asked for, applied to the fixes rather than only to the feature. N1 is the one thing that discipline could not reach, because the workflow has no local run — and it is exactly the kind of failure the workflow header warns about ("a green CI that does not exercise a production boot").
- The Dockerfile header now states the mechanism it rejected, the figures, the run that produced them and the two commands to re-measure. A reader who changes the file has the acceptance test in front of them.
- The F7 fix is a two-line preprocess, matches the sibling variables' shape, and the failure case was watched failing first. The F8 fix asserts behaviour rather than class identity, and the report shows the mutant pair that proves the independence.
- The workflow's SSH script carries a comment per non-obvious line (reload, prune flag, newline guard), each naming the failure it prevents, and the runbook's §5 mirrors them. The two `</dev/null`s belong in that style.

## Recommendation

**Request changes.** N1 is the blocker: two redirections and a comment, then the `printf … | bash -s` check with the workflow's own lines. N2 is one `trap - EXIT` after the sanity check, with the shim run as acceptance. N3–N6 are the author's call and none of them changes the deploy path.

Next: `piv-fix-review-findings` on this file, re-run the gate (nothing in N1/N2 touches the suite, so expect the same counts), and re-run the two shell checks. Round 3 compares its `baseRefOid` against `a6481aaadef63712264e569a8f237db416b9e6be` above.
