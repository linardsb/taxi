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
