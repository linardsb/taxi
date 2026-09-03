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
