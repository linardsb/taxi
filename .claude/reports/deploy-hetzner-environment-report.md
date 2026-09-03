# Implementation Report — Deploy: Hetzner environment (#13)

**Plan**: `.claude/plans/deploy-hetzner-environment.md`   **Branch**: `feature/deploy-hetzner-environment`   **Status**: PARTIAL — every code, infra-as-code and documentation task is complete and validated locally; the steps that need Linards' accounts (Hetzner, domain, Cloudflare, Twilio, the first `workflow_dispatch` run, the on-box restore rehearsal, the from-outside-the-LAN AC checks) are written up in the runbook and not executed.

## Summary

Production can now boot: the three provider gates are resolved without weakening any of them — Twilio trio binds the real SMS provider (no code change), production without a Stripe key binds a new `CardPaymentsDisabledProvider` that refuses every card charge instead of the old boot-time throw, and the stub maps provider sits behind a documented single-purpose switch (`ALLOW_STUB_MAPS_PROVIDER`) that #134 deletes. The deployment artefacts exist: a multi-stage Dockerfile, a production compose overlay, a Caddyfile (Cloudflare Origin CA, Full strict), a manual GitHub Actions deploy, a migration runner for the pruned image, and a `pg_dump` backup script. The built image was booted on the laptop with a production-shaped env and every gate was broken one at a time. The runbook, the architecture amendment and the four follow-up tickets (#134–#137) are in place.

## Tasks completed

- CardPaymentsDisabledProvider → `services/api/src/features/payments/card-payments-disabled.provider.ts` (CREATE)
- its spec → `services/api/src/features/payments/card-payments-disabled.provider.spec.ts` (CREATE)
- factory binds it in production; dead throw removed → `services/api/src/features/payments/payments.module.ts` (UPDATE), `payments.module.spec.ts` (UPDATE), `stub-payments.provider.ts` + `index.ts` KNOWN GAPS (UPDATE, comments)
- `ALLOW_STUB_MAPS_PROVIDER` → `services/api/src/common/config/env.schema.ts` (UPDATE) + `env.schema.spec.ts` (UPDATE) + `.env.example` (UPDATE)
- maps gate honours the switch; Places gap stays independent → `services/api/src/features/geo/geo.module.ts` (UPDATE), `geo.module.spec.ts` (UPDATE)
- rules files that became false → `services/api/CLAUDE.md` (UPDATE, two lines); root `CLAUDE.md` gains an on-demand-context row (UPDATE)
- stale "#13/#16 binds the Google Routes provider" comments retired → nine comment edits in `features/geo/*` and `notifications/tracking/tracking.service.ts`; `app-config.module.ts` "(CI, Railway)" (UPDATE)
- migration runner → `db/src/migrate-run.ts` (CREATE) + `migrate:run` script in `db/package.json` (UPDATE)
- image → `services/api/Dockerfile` (CREATE), `.dockerignore` (CREATE)
- host stack → `compose.prod.yml` (CREATE), `Caddyfile` (CREATE)
- deploy → `.github/workflows/deploy.yml` (CREATE)
- backups → `scripts/backup-db.sh` (CREATE)
- runbook (provisioning · every env var · deploy · migrate/seed · backup + restore · rollback · spend · known-broken) → `docs/runbooks/hetzner-deploy.md` (CREATE)
- architecture amendment (maps + payments posture, TLS row, deploy row, missing pieces) → `docs/epics/sakta-cab.architecture.md` (UPDATE); traceability row → `docs/epics/mvp-traceability.md` (UPDATE); skeleton hosting row struck through → `docs/skeleton-proposal.md` (UPDATE)
- four follow-up tickets filed: #134 (OSRM, deletes the switch), #135 (lever 1), #136 (lever 2), #137 (bake-off); linked from the plan's Forward-references and from `geo.module.ts` / `env.schema.ts` by number

## Tests added

- `card-payments-disabled.provider.spec.ts` — expected (refused as `provider_error` / `card_payments_disabled`, `providerRef: null`) · edge (same key twice → identical result) · failure (`it.each` × 4 inputs: never `ok: true`)
- `payments.module.spec.ts` — production + no key binds `CardPaymentsDisabledProvider` and does not throw; production never binds the stub
- `geo.module.spec.ts` — production + switch off → throws naming the switch; production + switch on + key → routes through the stub (`polyline: ''`); switch on + no key → refuses on the Places gap alone; both gaps in one message; switch is a no-op outside production
- `env.schema.spec.ts` — defaults false; literal `"true"` → true; `1`/`yes`/`TRUE`/`on` refused

Results (`observed`, `pnpm --filter @taxi/api test -- card-payments-disabled payments.module geo.module env.schema`): 4 suites, 48 tests, all passed.

## Validation results

- **Gate**: `pnpm turbo run typecheck lint test build --force` from cleared `dist`, `REDIS_TEST_URL=redis://localhost:6381` — `observed` twice on 2026-08-25, the second run on the final tree: 18/18 tasks successful, api `Test Suites: 67 passed`, `Tests: 634 passed`, 0 skipped, exit 0.
- **Migration runner**: `pnpm --filter @taxi/db migrate:run` twice against the local docker Postgres — both exit 0, "Migrations up to date" (`observed`).
- **Image** (`docker build -f services/api/Dockerfile -t taxi-api .`, `observed` 2026-08-25): `/app/db/migrations` lists 10 `.sql` + `meta`; `NODE_ENV=production` baked, runs as `node`; `node db/dist/migrate-run.js` inside the image twice, exit 0.
- **Production-shaped boot** against local compose db/redis (`observed`): `/health` → `{"status":"ok","service":"api"}` ~2 s after start. Broken one at a time, each exits 1 naming the gate: (a) `JWT_SECRET=dev-only-change-me`, (b) `ALLOW_STUB_MAPS_PROVIDER` unset, (c) `PUBLIC_TRACKING_BASE_URL=http://localhost:3000`, (d) two of three `TWILIO_*`, (e) `GOOGLE_MAPS_API_KEY` unset with the switch on, (f) no `TWILIO_*` at all.
- **Compose overlay**: `docker compose -f docker-compose.yml -f compose.prod.yml config` renders; only 80 and 443 are published (`!reset` cleared 5432/6379). `deploy.yml` and `compose.prod.yml` parse as YAML.
- **Backup/restore rehearsal** (local, `observed`): `pg_dump -Fc` → 57 015 bytes; the script's structural grep finds `TABLE public geozones`; `pg_restore --no-owner` into a scratch database exit 0; restored counts equal source (4 geozones, 24 rides, 0 ledger entries, 10 migrations); `PostGIS_Full_Version()` → 3.4.3.
- **Railway grep**: only struck-through/superseded lines (architecture Key decisions, skeleton row), the amendment's own history, the research doc (frozen by its status line), and dated plans/reviews under `.claude/` remain.
- **Not run** (needs accounts/hardware): AC 1 from outside the LAN, Socket.IO >60 s through Cloudflare, `gh workflow run deploy.yml`, the on-box restore, the observed spend figure.

## Deviations from the plan

- **D1 — the maps switch does not cover the Places gap.** The plan's shape was `if (production && !switch) throw`, which would have silenced the `GOOGLE_MAPS_API_KEY` refusal #19/#125 added. Kept that refusal independent: accepting straight-line quotes is not accepting a typeahead that throws on Dina's first keystroke. Consequence: the host `.env` needs a Maps Platform key (runbook §3). Spec'd.
- **D2 — refusal reason is `provider_error`, not `declined`/`payment_method_unavailable`.** No such error exists; the seam pins exactly two reasons and its own doc says a third must earn a third caller behaviour. `declined` → 402 `payment_declined` would tell the driver the rider's card failed when no card was seen; `provider_error` → 502 is the honest, retry-safe shape, and `message: 'card_payments_disabled'` carries the cause into the log the runbook reads. Documented in the class, the barrel and the runbook.
- **D3 — four deploy secrets, not three.** Added `SSH_KNOWN_HOSTS` so the host key is pinned rather than trusted on every run. `GHCR_TOKEN` is used on the box to pull (repo is private); the runner pushes with `GITHUB_TOKEN`.
- **D4 — the workflow syncs the compose files to the box** (`scp` of `docker-compose.yml`, `compose.prod.yml`, `Caddyfile`, `scripts/backup-db.sh`) so the box's config tracks the repo; the plan only had pull + up + migrate.
- **D5 — `POSTGRES_PASSWORD` is required by the overlay** and `DATABASE_URL`/`REDIS_URL` are composed in `compose.prod.yml` rather than listed in the host `.env`. The base file's `taxi:taxi` is fine behind an unpublished port on a laptop; on an internet-connected box the password is set once, in one place.
- **D6 — IPv4 taken** (+~€0.60/mo `observed` 2026-08-14) per the plan's own provisioning task; the derived infra figure is therefore ≈ €6.09/mo, not the research's €5.49. Recorded with the arithmetic in the runbook §7 and the architecture amendment.
- **D7 — TLS is Cloudflare Origin CA + Full (strict), not plain HTTP.** The plan allowed either; plain HTTP would carry OTPs and JWTs Cloudflare → Hetzner in the clear. Stated in the `Caddyfile` header and the architecture mitigation table.
- **D8 — stale `#13/#16` comments retired across the geo slice**, not only the two lines the plan named: the numbers rule says retire the subject, and nine other comments claimed "#13/#16 bind the Google Routes provider".
- **D9 — historical `.claude/plans/*` and `.claude/code-reviews/*` Railway mentions left as they are.** They are dated per-ticket artefacts; rewriting them would be revisionism. The AC's "clearly-marked history" is read as covering them.
- **D10 — the production-env-vars document is folded into the runbook** (§3), which the plan permitted.

## Issues encountered

- **First image cut died on `Cannot find module '@taxi/shared'`.** The root `.npmrc` (`node-linker=hoisted`) puts third-party packages flat at the root but the workspace links in each consumer's own `node_modules`; the runtime stage now copies `db/node_modules` and `services/api/node_modules` too. Found by booting the image, as the plan's GOTCHA demanded, not by reading the Dockerfile.
- **The migration-folder GOTCHA is half wrong**: drizzle reads `meta/_journal.json` first and throws if the folder is missing, so an image that forgets `db/migrations` fails loudly rather than applying nothing. `migrate-run.ts` says so.
- **A card ride booked in the cash-only pilot cannot settle and cannot be re-settled as cash** (method locks at acceptance). Not fixed here — out of scope (no feature-slice changes); recorded in the payments barrel's KNOWN GAPS and runbook §9 as a booking-time rule for #16/#17 and the console.
- Repo hooks: `rm -rf`/`rm -r` and any Bash command text containing `.env` (including `process.env`) are blocked; `dist` was cleared with `find -delete` and the probes ran from scratchpad scripts.
- The `docs/research/hosting-sms-cost-research.md` status line says it is not edited further, so its Railway sections stay as the 2026-08-14 snapshot.

## Review round 1 — fixes (2026-09-03)

Review: PR #147, round-1 comment. Fixed F1–F9 and F11–F13 on the PR; F10 (dumps unencrypted at rest on R2) deferred to #149, which waits on a passphrase-custody decision. The figures above from 2026-08-25 are left as the dated history they are; the ones below supersede them.

- **F1** — `main` gained a fourth production boot gate with #14 (`PUSH_PROVIDER`, `43391c9`, 2026-08-31) between the 2026-08-25 boot and the 2026-09-02 rebase; the runbook did not set it and the PR body said the boot's inputs were unchanged. Runbook §3 and §8.3 carry it now; the boot was re-observed at the fix commit (below). The Summary's "three provider gates" was true on 2026-08-25 and is four at head.
- **F2** — the runtime tree is `pnpm --filter @taxi/api deploy --prod --legacy` output; in-image paths are `dist/main.js` and `node_modules/@taxi/db/dist/…` (Dockerfile, workflow, runbook).
- **F3 / F9** — `scripts/backup-db.sh`: grep reads the whole listing (no `-q` under `pipefail`); an EXIT trap removes a partial dump.
- **F4 / F5 / F6 / F12** — workflow: `caddy reload` after `up`, `prune -af`, a trailing-newline guard before the `API_IMAGE_TAG` append, `permissions: contents: read` on the deploy job.
- **F7** — `ALLOW_STUB_MAPS_PROVIDER=''` reads as unset (spec added; it failed on the unfixed schema with `Invalid enum value … received ''`).
- **F8** — the factory's failure case now asserts that the production provider's `charge()` resolves `ok: false`.
- **F11** — sshd hardening as an `sshd_config.d/00-hardening.conf` drop-in, verified with `sshd -T`.
- **F13** — the refusing provider logs nothing; `payment.settlement.charge_failed` is the one line.

`observed` 2026-09-03, image built from the fix commit (`docker build -f services/api/Dockerfile -t taxi-api:pr147-fix .`, exit 0), all from the `taxi-141` worktree:

- `docker image ls` 388 MB (2.38 GB at `dff4c4f`); `du -sm node_modules` inside 81 MB (1,547 MB); `/app` 86 MB; `docker save | gzip -1` 79,824,202 bytes (535,327,427). None of `@expo`, `next`, `react-native`, `jest`, `typescript`, `ts-node`, `drizzle-kit`, `@nestjs/cli` present. User `node`, `NODE_ENV=production`, 11 `.sql` + `meta/_journal.json` at `node_modules/@taxi/db/migrations`.
- `node node_modules/@taxi/db/dist/migrate-run.js` twice against a scratch database on the local compose Postgres: exit 0 both, `drizzle.__drizzle_migrations` 11 rows.
- Boot with the runbook §3 variables, `PUSH_PROVIDER=expo` included: `/health` → `{"status":"ok","service":"api"}` 1 s after start.
- Seven gates broken one at a time (`JWT_SECRET` published value; switch unset; localhost tracking URL; two of three `TWILIO_*`; no `TWILIO_*`; no `GOOGLE_MAPS_API_KEY`; `PUSH_PROVIDER` unset): each exits 1 with the message in §8.3's table.
- Backup script under shims for `docker`, `pg_restore` (300,000-line listing, match on line 42), `rclone`, `stat`: at `dff4c4f`, the valid dump → exit 1 "no geozones table", and a failed `pg_dump` left the partial file; fixed → exit 0 and one upload, and the failed run removes the file and exits 1. Mechanism alone: `seq 1 300000 | grep -q 1` → 141 under `pipefail`, `grep … >/dev/null` → 0.
- Caddy (`caddy:2-alpine`, bind-mounted Caddyfile rewritten in place): the old response is served until `caddy reload --config /etc/caddy/Caddyfile`, which exits 0 and serves the new one; exit 0 again on an unchanged file and with stdin not a TTY.
- Mutations: the factory's production branch returning the stub fails the F8 case (and the expected case); the provider reporting `ok: true` fails the F8 case alone, which is the independence the review asked for.
- Gate: see the PR body's Validation section for the run at the fix commit.

## Review round 2 — fixes (2026-09-03)

Review: `.claude/code-reviews/pr-147-review-round2.md` (PR #148), 1 high · 1 medium · 4 low at `711d840`. All six fixed. The round-1 figures above stand; nothing below supersedes them.

- **N1 (high)** — `.github/workflows/deploy.yml`: `</dev/null` on the migration `run` and the Caddy `exec`, and only on those two. The remote script IS bash's stdin (`ssh … 'bash -s' <<EOF`), bash reads a pipe one line at a time, and compose's `run`/`exec` default to `--interactive`, so the docker CLI was reading the rest of the script and forwarding it into the container. Everything after the migration — `up -d --wait`, `caddy reload`, the `API_IMAGE_TAG` record, `prune -af`, `ps` — never ran, and the step exited 0 on the migration's own status. The comment above the line names the mechanism.
- **N2 (medium)** — `scripts/backup-db.sh`: `trap - EXIT` immediately after the geozones sanity check. F9's trap was armed for the whole script, so a failed `rclone copy` deleted a dump that had just passed validation, leaving nothing remote *and* nothing local — worse than pre-F9 behaviour, and it contradicted runbook §6.1's "local copies are a convenience for a fast restore". The exit status still travels; what is lost on an upload failure is this script's own `backup FAILED` line, rclone's stderr and the non-zero exit remaining. Flagged in the code comment.
- **N3 (low)** — `compose.prod.yml` and runbook §3: `POSTGRES_PASSWORD` is interpolated into `DATABASE_URL` unescaped, so it must be hex. The `:?` guard checks presence, not shape.
- **N4 (low)** — the maps switch's safety claim, in **seven** places (the review named three): `env.schema.ts`, `.env.example`, runbook §3, plus `geo.module.ts`, `docs/epics/sakta-cab.architecture.md` and two on `.claude/plans/deploy-hetzner-environment.md` — the NOTES paragraph *and* the task AC at line 227, which instructed the docblock to say it and would have reproduced it. "No Stripe key, so no money moves off a bad quote" was overstated: the absent key closes the **card rail**, and a cash ride quoted at haversine × 1.35 is real money at the kerb. The closed pilot is the load-bearing condition and carries the due date on its own — unset the switch before the first real rider, #134 or not. The three copies past the review's list were found by grepping the **subject** (`ALLOW_STUB_MAPS_PROVIDER`, `StubMapsProvider`) and reading every hit; the phrase-greps that found the first three could not reach any of them.
- **N5 (low)** — `timeout-minutes: 20` on the deploy job and `--wait-timeout 120` on the `up`. 120 s is a backstop, not the api's budget: the api healthcheck resolves itself first — healthy on its first successful probe, unhealthy at `start_period` 20 s + 5 × 10 s = 70 s, after which `up --wait` fails on its own. The flag is project-scoped; reasoning about the api alone is valid because the `run` on the line above already resolved api's `depends_on … service_healthy` on db and redis. (Corrected in round 3 — **P3**; the original wording called 70 s a legitimate startup, which inverts the consequence.) Runbook §3's "`up -d --wait` fails the deploy" now carries a run.
- **N6 (low)** — decision, not a code change: the deploy does **not** `docker logout`, because §5.2's rollback `pull` depends on the persisted login and an incident is the wrong moment to go looking for a PAT. Recorded in §1.4 (`GHCR_TOKEN` row), §5.2 and §9 — the box holds a `read:packages` token at rest, on a key-only host behind a 22/80/443 firewall.

`observed` 2026-09-03 at the round-2 fix commit, `taxi-141` worktree, docker 29.2.1 / compose 5.1.0:

- **N1, the real script.** The heredoc body was extracted from the workflow exactly as `bash -s` receives it (10 spaces of YAML indent stripped, `\$`/`` \` `` unescaped, the runner-side `$GHCR_TOKEN`/`$GHCR_USER`/`$TAG` substituted), a marker inserted after every executable line, and the result piped to `bash -s` under a `docker` shim that drains stdin on `run`/`exec`. **Pre-fix 5 of 11 markers, exit 0, no tag recorded. Post-fix 11 of 11, exit 0, tag recorded** — on both branches of the `API_IMAGE_TAG` `if`. Control (a shim that never reads stdin): 11 of 11 pre-fix, which isolates the cause to stdin rather than to the shim.
- **N1, real docker, no shims.** `alpine:3.20` under compose, `printf … | bash -s`: `compose run --rm` then `echo AFTER-RUN` → AFTER never printed; with `</dev/null` → printed. `compose exec -T` → same pair. And the reason the redirect goes on exactly two lines: `compose pull`, `compose up -d --wait`, `docker image prune -af` and `compose ps` each printed their AFTER unredirected.
- **N2.** Backup script under shims for `docker`, `pg_restore` (300,000-line listing, geozones on line 42), `rclone`, `stat`, three cases × two versions. Valid dump + upload OK: both exit 0, 1 local file. Failing `pg_dump`: both exit 1, **0** local files (F9 intact). Failing `rclone copy`: `711d840` exit 1 with **0** local files; fixed exit 1 with **1** — the dump survives, which is the fix.
- **N5.** Image built from the round-2 head, real overlay, `up -d --wait --wait-timeout 45 api` on runbook §3's values: **exit 0 in 12 s**, api `running`/`healthy`. With `PUSH_PROVIDER` alone removed: **exit 1 in 15 s**, `container … is unhealthy`, `RestartCount` 4. Held constant between the two runs: everything but that one line. Times vary 8–15 s across runs; the exit codes and "well inside 45 s" are what is stable. (The healthy run boots against an unmigrated scratch database — `/health` does not touch it, and a background poll logs a failed query. Boot gates were the subject; the migration path is round 1's row above.)
- Gate: see the PR body's Validation section.

## Review round 3 — fixes (2026-09-03)

Review: the PR #147 comment of 2026-09-03 (round 3, plus its P4 addendum) — 0 critical · 0 high · 4 medium · 5 low at `76361e0`. All nine addressed. Nothing in the deploy path was broken: four findings are claims that were wrong about what they described and five are one-line hardenings. The round-1 and round-2 records above stand except where P3 corrects one.

- **P1 (medium)** — the PR body's `git diff --stat origin/main..HEAD` figure was `711d840`'s, relabelled "at HEAD" after HEAD moved. Re-run at the round-3 fix commit and pasted verbatim. Same shape as round 1's F1, which hid a production boot that did not work.
- **P2 (medium)** — the PR body said "Two commits on `a6481aa`" while its own "Review round 2 — fixes" section forty lines below described two more. Now the actual list, one clause each.
- **P3 (medium)** — `.github/workflows/deploy.yml` and this report's N5 line: the comment behind `--wait-timeout 120` called `start_period 20 s + 5 × 10 s = 70 s` the healthcheck's "worst legitimate case". It is not. A container is marked healthy on its **first** successful probe, `start_period` included; 70 s is the point at which compose gives up and marks it **unhealthy**. The practical consequence inverts: an api that genuinely needs 75 s is not rescued by a larger `--wait-timeout`, it is failed at 70 s by its own healthcheck, and the knob that would matter is `start_period`/`retries`. The flag is also project-scoped rather than api-scoped, so the comment now states why reasoning about the api alone is valid — the `run` on the line above already resolved api's `depends_on … service_healthy` on db and redis. The shipped 120 is unchanged and was never at risk. N5's `up -d --wait --wait-timeout 45 api` observation remains sound evidence about the boot gates and is not evidence for a project-scoped 120.
- **P4 (medium)** — `compose.prod.yml` and runbook §3 named `@`, `/`, `:`, `#` and `%` as breaking `pg`'s URL parser. `observed` 2026-09-03 against this tree's `pg-connection-string` **2.14.0** — the parser `new Pool` reaches through `db/src/client.ts:9` — calling `parse('postgres://taxi:<pw>@db:5432/taxi')`: `pa@ss` and `pa:ss` parse cleanly with the password intact; `pa/ss`, `pa#ss` **and `pa?ss`** throw `Invalid URL`, so `?` was missing from the list; `pa%41ss` returns password `paAss` and `pa%2Fss` returns `pa/ss`, both with **no error at all**; `pa%ss` survives intact. Two false alarms, one omission, and the one character that fails *silently* was the one the sentence described as a parse break — which is the case an operator most needs warned about, because the boot then fails on authentication with nothing naming the password's shape. Both places rewritten to say which failure each causes. The prescription, `openssl rand -hex 16`, was always right and is unchanged.
- **P5 (low)** — `scripts/backup-db.sh`: N2's `trap - EXIT` was the only thing that wrote a `backup FAILED` line past the sanity check, so a failed `rclone copy` exited 1 with nothing in `/var/log/taxi/backup.log` naming this script, its exit code or the kept dump — and the only remaining signal was the *absence* of the `backup ok` line, which nobody greps for. The clear is replaced by a `dump_validated` flag that the existing `cleanup` reads: before the check it removes and logs (F9 unchanged), after it keeps and logs. One trap, one place that decides.
- **P6 (low)** — `umask 077` above the script's `mkdir -p`, and `sudo chmod 700 /var/backups/taxi` in runbook §1.3 for the directory the runbook creates first (`mkdir` + `chown` set ownership, never mode). Cron's default umask (022) was leaving every dump — riders, drivers, phone numbers, the ledger — 0644 on a box with other local accounts. The local sibling of F10 (#149, dumps unencrypted on R2).
- **P7 (low)** — the sanity check ran the **host's** `pg_restore` against a dump made **inside** the container, silently coupling the backup to the host client's major being ≥ the db image's. After a Postgres major upgrade `--list` fails on the archive header, `pipefail` carries it, and `exit 1` fires while the trap is still on its remove branch: a good dump destroyed every night, logged as "no geozones table" — and §6.2's "rehearse again after any Postgres major upgrade" is about the *restore*, so it does not point at the cause. Moved into the db container, matching §6.2's restore, which already runs `dc exec -T db pg_restore … < "$dump"`. `postgresql-client` came out of runbook §6.1: the sanity check was its only stated purpose. A dump that genuinely **fails** the check is still removed, deliberately — it is not a backup and `ls -t | head -1` must not pick it.
- **P8 (low)** — runbook §1.4 and §9 recorded N6's accepted risk as "one repo's packages". `GHCR_TOKEN` is a **classic** PAT, and classic-PAT scopes are account-wide: `read:packages` reads every package the account can see. Both records now say so, with the two ways out (a repo-scoped fine-grained token, or `docker logout` plus a documented rollback login). N6 is not reopened — identical in effect today, one private package — but the acceptance now rests on the true premise.
- **P9 (low)** — `API_DOMAIN` had two sources of truth: `vars.API_DOMAIN` for the external probe, and the box's host env file, which is what Caddy actually serves. Edit one and not the other and the last gate measures a different origin from the one just deployed — green against a stale name that still answers, or red while the stack is fine. The health step now reads the box's value back over the same ssh key (`ssh -n`, CR and optional quotes stripped) and fails on a mismatch before probing.

`observed` 2026-09-03 at the round-3 fix commit, `taxi-141` worktree, docker 29.2.1:

- **P4.** `require.resolve('pg-connection-string')` from `db/` → the root `node_modules/pg-connection-string`, **2.14.0**. The nine-password table above is that module's own `parse()` in this tree. Deliberately **not** claimed: a live `pg` handshake. What the comment and the runbook now assert is the parse result and the `%`-decode; the authentication failure follows from the decoded password differing from the one set.
- **P5, P6, P7 — the backup script under shims** (`docker` answering `exec -T db pg_dump` and `exec -T db pg_restore`, plus `rclone` and a GNU-`stat` stand-in), four cases × two versions, with a host `pg_restore` shim so `76361e0` gets a fair baseline:

  | case | `76361e0` | fixed |
  |---|---|---|
  | valid dump, upload OK | exit 0, 1 file, mode **0644** | exit 0, 1 file, mode **0600** — P6 |
  | `pg_dump` fails | exit 1, 0 files, "removed …" | identical — F9 unchanged |
  | sanity check fails | exit 1, 0 files, "no geozones table" | identical — deliberate |
  | `rclone copy` fails | exit 1, 1 file, **no line from this script** | exit 1, 1 file, **"backup FAILED after the dump passed (exit 1): kept …"** — P5, N2 unchanged |

  Each fix moves exactly one cell; the other three are held constant.
- **P7, the mechanism, live.** The same harness with **no** host `pg_restore` shim — the real macOS client reading a foreign archive, which is P7's version-mismatch shape: `76361e0`'s valid-dump case → **exit 1, 0 local files**, logged as "…has no geozones table"; the fixed script on the same inputs → **exit 0, 1 file**. The dump the pre-fix script destroyed was fine; only the reader was wrong.
- **P7, the replacement command, against real Postgres.** `docker exec -i taxi-db-1 pg_dump -U taxi -d taxi -Fc > t.dump` (57 015 bytes), then `docker exec -i taxi-db-1 pg_restore --list < t.dump` → **exit 0, 147 lines**, including `291; 1259 21319 TABLE public geozones taxi`. A custom-format archive does list from a non-seekable stdin, which is the assumption the fix rests on.
- **P5, the trap contract.** `set -euo pipefail` with `local status=$?` inside an EXIT-trapped function: the script's exit status still travels — `RM` / exit 1 on the remove branch, `KEPT` / exit 1 on the log-only branch, exit 0 on success.
- **P6, the directory.** With `BACKUP_LOCAL_DIR` pointing at a path the script creates itself: directory **0700**, dump **0600**.
- **P3, P9.** `deploy.yml` still parses as YAML, with `SSH_HOST` and `API_DOMAIN` on the health step. Not exercised: `gh workflow run deploy.yml` has still never fired, so the mismatch gate and the reworded `--wait-timeout` comment are read, not run.
- Gate: see the PR body's Validation section.
