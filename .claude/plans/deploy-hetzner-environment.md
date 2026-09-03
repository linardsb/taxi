# Feature: Deploy — Hetzner environment (API + PostGIS + Redis), self-hosted

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Stand up the first shared, internet-reachable Sakta Cab environment: the NestJS API, Postgres+PostGIS and Redis on a single Hetzner Cloud VPS, running the repo's own `docker-compose.yml` topology plus an API container, behind Cloudflare for TLS and IPv4. Migrations run automatically on deploy; the Rīga seed runs once, manually. Deploy documentation lands in `docs/runbooks/`, and the monthly spend estimate is recorded against the budget guardrail.

**This ticket replaces the epic's locked Railway decision with Hetzner** (Linards, 2026-08-14, "as cheap as possible / no Railway"). Research and full cost arithmetic: `docs/research/hosting-sms-cost-research.md`.

## User Story

As Linards (solo builder)
I want a reachable, boring, cheap production-shaped environment for the API
So that Atis can test the driver app from a moving car on LV mobile networks, and the #24 demo runs against something that isn't my laptop

## Problem Statement

Everything so far runs on localhost. #14 (driver app, background location streaming) needs an endpoint reachable over cellular; the #24 demo needs an environment that survives the laptop lid closing. There is no deployment artifact in the repo at all: no Dockerfile, no host config, no deploy runbook, and no way to run migrations against a remote database.

Worse, **`NODE_ENV=production` cannot boot today.** Three provider factories throw by design when no real provider is bound:

| Factory | Line | Satisfiable by config? |
|---|---|---|
| `smsProviderFactory` | `features/auth/auth.module.ts:35` | **Yes** — Twilio trio (a Twilio trial account suffices) |
| `paymentsProviderFactory` | `features/payments/payments.module.ts:41` | **No** — the pilot is cash-only; there is no SIA, so no Stripe key |
| `mapsProviderSourceFactory` | `features/geo/geo.module.ts:22` | **No** — no real `MapsProvider` exists in the tree |

A deploy is not possible until all three are resolved, and two of them need code.

## Solution Statement

One Hetzner CX22, one `compose.prod.yml` layering an API service over the existing Postgres/Redis definitions, Cloudflare in front for TLS and IPv4, a GitHub Actions deploy over SSH, and a `pg_dump` backup cron.

The three boot gates are resolved *without weakening any of them*:

- **SMS** — bind the real `TwilioSmsProvider` (already shipped, #85). A Twilio **trial** account satisfies the gate and costs nothing; it sends only to verified numbers, which is exactly the pilot-testing shape.
- **Payments** — add a `CardPaymentsDisabledProvider` that **refuses** card rides (`payment_method_unavailable`), bound when no Stripe key is set. This is strictly safer than today's stub, which reports success without moving money. Cash rides never touch the seam, so the cash-only pilot works fully.
- **Maps** — a single-purpose, documented config switch (`ALLOW_STUB_MAPS_PROVIDER`), following the #103 precedent (code-level kill switch → config-level). Deleted by the OSRM ticket. See Assumptions.

`NODE_ENV=production` stays on, so the secret-strength, published-secret, `JWT_SECRET ≠ OTP_PEPPER` and non-localhost `PUBLIC_TRACKING_BASE_URL` checks in `env.schema.ts` all remain live.

## Out of Scope / Non-Goals

- **Not included: `OsrmMapsProvider` or the OSRM container.** Its own ticket (see Assumptions). This plan ships the config switch that lets #13 land first, and that ticket deletes it.
- **Not included: self-hosted geocoding** (Photon/Nominatim). #16's need, and the memory-hungry piece — it stays off the box.
- **Not included: deploying `apps/dispatch`.** `PUBLIC_TRACKING_BASE_URL` gets a real hostname that 404s until #18/#19 ship the app. Documented, not fixed here.
- **Not included: the SMS volume levers** (skip-SMS-for-app-riders; shorter links + trimmed templates). Two separate tickets — `docs/research/hosting-sms-cost-research.md` §4.3. Transliteration to ASCII is **rejected**: Latvian lettering and Russian both stay.
- **But do buy a short domain.** Lever 2 needs `sakta.lv`-length, not `saktacab.lv`-length, to keep the linked SMS at one segment. `PUBLIC_TRACKING_BASE_URL` is set in this ticket, so the domain is bought here — choosing a long one now makes the later lever impossible without a second migration.
- **Not included: an SMS provider bake-off / switching off Twilio.** Separate ticket; the seam makes it a config change.
- **Not changing:** the ride state machine, dispatch, pricing, ledger, or any feature slice. This ticket adds deployment surface and resolves boot gates only.
- **Not included: CI deploying automatically on merge to main.** The workflow is `workflow_dispatch` only — a manual trigger. Auto-deploy is a decision for after the first successful manual run.

## Feature Metadata

**Feature Type**: New Capability (infrastructure)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `services/api` (Dockerfile, two provider factories, env schema), `db` (migration runner), repo root (compose overlay, Caddyfile), `.github/workflows`, `docs/runbooks/`, `docs/epics/sakta-cab.architecture.md`
**Dependencies**: Hetzner Cloud account · Cloudflare account (exists — GPS spike kit) · Twilio trial account · a domain

## Related Work

**Implements**: [#13](https://github.com/linardsb/taxi/issues/13) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) / `docs/epics/sakta-cab.architecture.md`

**Back-references**:

- `docs/research/hosting-sms-cost-research.md` — Why: the host and SMS cost research this plan executes; all spend arithmetic lives there
- `.claude/plans/db-foundation-drizzle-postgis.md` — Why: `migrateDb()`, `MIGRATIONS_DIR`, and `seedRiga()` idempotency semantics
- `.claude/plans/real-sms-provider-twilio.md` (#85) — Why: `TwilioSmsProvider` and the all-or-nothing trio validation this plan configures
- `.claude/plans/api-payments-ledger.md` (#12) — Why: the payments seam and why the stub is dangerous in production

**Forward-references** (filed 2026-08-25 during implementation):

- [#134](https://github.com/linardsb/taxi/issues/134) — `OsrmMapsProvider` + OSRM container; **deletes `ALLOW_STUB_MAPS_PROVIDER`**
- [#135](https://github.com/linardsb/taxi/issues/135) — skip rider SMS for app-booked rides (lever 1)
- [#136](https://github.com/linardsb/taxi/issues/136) — 1-segment LV/RU templates, short domain, shorter token (lever 2)
- [#137](https://github.com/linardsb/taxi/issues/137) — SMS provider bake-off before pilot volume

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `services/api/src/common/config/env.schema.ts` (whole file, ~230 lines) - Why: every env var and every production gate. New vars go here with the same comment density; the `.superRefine` production block is where `NODE_ENV=production` rules live.
- `services/api/src/features/geo/geo.module.ts` (lines 12-32) - Why: `mapsProviderSourceFactory`, the gate being switched. Note lines 12-13 name "#13/#16" as where the stub is replaced — this plan deliberately diverges (see Assumptions).
- `services/api/src/features/payments/payments.module.ts` (lines 20-50) - Why: `stripeClientFactory` + `paymentsProviderFactory`; the new refusing provider is bound here.
- `services/api/src/features/payments/stub-payments.provider.ts` - Why: the shape to mirror (and the behaviour to invert) for `CardPaymentsDisabledProvider`.
- `services/api/src/features/auth/auth.module.ts` (lines 13-40) - Why: `smsProviderFactory`; the canonical "stub throws in production" pattern the maps switch must not weaken.
- `services/api/src/main.ts` (whole file, 25 lines) - Why: `app.listen(env.API_PORT)`, the Redis adapter wiring, and `enableShutdownHooks()`.
- `db/src/seed/run.ts` (whole file) - Why: the exact shape the migration runner mirrors — `createDb` → work → `pool.end()` in a `finally`, `main().catch(exit 1)`.
- `db/src/migrate.ts` - Why: `migrateDb(db)` and `MIGRATIONS_DIR` (`__dirname/../migrations`, CJS-dependent — do not rewrite as `import.meta`).
- `db/src/seed/riga.ts` (lines 120-205) - Why: idempotency semantics. `platform_config`'s conflict set re-asserts `commissionPct` and the debt limit; `dispatchPhone` is deliberately excluded. This is why seed is manual, not on every deploy.
- `docker-compose.yml` (whole file) - Why: the service definitions the production overlay extends; note both healthchecks and the `REDIS_PORT` indirection.
- `.github/workflows/ci.yml` - Why: the pnpm/node setup steps the deploy workflow mirrors (pnpm action-setup, node 20, `--frozen-lockfile`).
- `turbo.json` - Why: `globalEnv` — any new env var read during a *task* must be listed or strict mode drops it from the cache key. (The new vars are read at runtime only, so verify before adding.)
- `services/api/package.json` + `db/package.json` + `packages/shared/package.json` - Why: the build chain the Dockerfile must reproduce — `@taxi/shared` → `@taxi/db` → `@taxi/api`, `packageManager: pnpm@10.33.2`.
- `docs/runbooks/settlement-recovery.md` - Why: the house runbook format to match.
- `.claude/references/conventions.md` - Why: commit and PR conventions (read at commit time).

### New Files to Create

- `services/api/Dockerfile` - Multi-stage pnpm-workspace build producing a runtime image with `db/migrations/*.sql` present
- `.dockerignore` (repo root) - Keep `node_modules`, `dist`, `.git`, `.env` out of the build context
- `compose.prod.yml` (repo root) - Production overlay: api + caddy services over the existing db/redis
- `Caddyfile` (repo root) - Reverse proxy; TLS terminated at Cloudflare, so this serves plain HTTP internally
- `db/src/migrate-run.ts` - ~20-line CLI mirroring `seed/run.ts`, calling `migrateDb()`
- `services/api/src/features/payments/card-payments-disabled.provider.ts` - Refuses card charges; bound when no Stripe key
- `services/api/src/features/payments/card-payments-disabled.provider.spec.ts` - Unit spec
- `.github/workflows/deploy.yml` - `workflow_dispatch` deploy: build image → ghcr.io → SSH → pull + up
- `scripts/backup-db.sh` - `pg_dump` → object storage, run by cron on the host
- `docs/runbooks/hetzner-deploy.md` - Provisioning, env vars, deploy, migrate/seed, backup/restore, spend
- `docs/runbooks/production-env-vars.md` - Every production var, its source, and why (or fold into the above)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Hetzner Cloud pricing](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) — confirm CX22 price and the IPv4 surcharge at purchase; figures in this plan are from 2026-08-14
- [Cloudflare Tunnel / proxy WebSocket support](https://developers.cloudflare.com/network/websockets/) — Why: the Socket.IO path depends on it; verify idle-timeout behaviour against Socket.IO's 25 s ping
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) — Why: WebSocket upgrade is automatic in Caddy v2; do not hand-write `Upgrade` headers
- [pnpm in Docker — `--frozen-lockfile` and `deploy`](https://pnpm.io/cli/deploy) — Why: workspace pruning for the runtime stage
- [Drizzle migrator (node-postgres)](https://orm.drizzle.team/docs/migrations) — Why: `migrate()` semantics the runner wraps
- [Twilio trial account limitations](https://www.twilio.com/docs/messaging/guides/how-to-use-your-free-trial-account) — Why: verified-numbers-only and trial-sender rules; `env.schema.ts` already assumes them
- `docs/research/hosting-sms-cost-research.md` §5, §7 — Why: the cost arithmetic this ticket must record, and the host-agnostic gotchas (migrations-in-image, seeding policy, `PORT`, `PUBLIC_TRACKING_BASE_URL`)

### Patterns to Follow

**Provider factory that refuses rather than pretends** — `features/auth/auth.module.ts:23-40`. A factory either binds a real provider or throws at boot. The new payments provider is a third shape: it *binds* successfully but refuses the operation at call time, because cash-only is a legitimate production posture while "card silently succeeds" is not.

```ts
// features/payments/payments.module.ts — existing
export function paymentsProviderFactory(env: Env, stripe: StripeClient | null): PaymentsProvider {
  if (stripe) return new StripePaymentsProvider(stripe);
  if (env.NODE_ENV === 'production') { throw new Error('No production PaymentsProvider is bound: …'); }
  return new StubPaymentsProvider();
}
```

**Env schema comments carry the reasoning, not the restatement** — every var in `env.schema.ts` explains *why* it exists and what breaks without it, often at paragraph length. Match that density; a bare `z.boolean()` with no comment will not pass review.

**Config-level kill switch over code-level** — `MAPS_ETA_FAILURE_TTL_SECONDS`'s `0` disables the negative cache, added by #103 precisely so an operational change isn't a deploy. `ALLOW_STUB_MAPS_PROVIDER` is the same move.

**CLI script shape** — `db/src/seed/run.ts`: read `DATABASE_URL` with a dev default, `createDb`, `try { work } finally { await pool.end() }`, `main().catch(err => { console.error(err); process.exit(1) })`.

**Runbook shape** — `docs/runbooks/settlement-recovery.md`: symptom → check → action, with copy-pasteable commands.

---

## IMPLEMENTATION PLAN

### Phase 1: Make production bootable

The three gates, in code. Nothing can be deployed until this is done, and all of it is testable locally with `NODE_ENV=production`.

**Tasks:**

- `CardPaymentsDisabledProvider` + binding + spec
- `ALLOW_STUB_MAPS_PROVIDER` in the env schema + the `geo.module.ts` gate + spec
- Verify the Twilio trio path binds `TwilioSmsProvider` (no code change expected)

### Phase 2: Build artifact

**Depends on:** Phase 1 (the image must be able to boot)

**Tasks:**

- `services/api/Dockerfile`, `.dockerignore`
- `db/src/migrate-run.ts` + a `migrate:run` script
- Verify the built image boots with a production-shaped env against local compose

### Phase 3: Host & deploy pipeline

**Depends on:** Phase 2
**Independent of:** Phase 4 — the docs can be drafted in parallel from this plan.

**Tasks:**

- Provision CX22, Docker, firewall, unattended-upgrades
- Cloudflare DNS + proxy; domain
- `compose.prod.yml`, `Caddyfile`, host `.env`
- `.github/workflows/deploy.yml`
- `scripts/backup-db.sh` + cron

### Phase 4: Documentation, amendment, and validation

**Tasks:**

- `docs/runbooks/hetzner-deploy.md`
- Amend `docs/epics/sakta-cab.architecture.md` (hosting + maps + payments posture)
- Record the spend estimate with provenance
- Run the AC checks from outside the LAN

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### CREATE `services/api/src/features/payments/card-payments-disabled.provider.ts`

- **IMPLEMENT**: A `PaymentsProvider` whose charge method rejects every call with the domain error the rides layer already understands for an unavailable method. Read `packages/shared/src/seams/` for the exact interface and `stub-payments.provider.ts` for the method signatures. It must **never** report success.
- **PATTERN**: `services/api/src/features/payments/stub-payments.provider.ts` — same interface, inverted behaviour.
- **IMPORTS**: `PaymentsProvider` from `@taxi/shared`; whatever error type `StripePaymentsProvider` throws on a declined charge, so callers need no new branch.
- **GOTCHA**: Cash rides never reach the seam (`payments.module.ts` comment: the cash branch sits above it), so this must not affect cash settlement at all. Verify by reading `settlement.service.ts` before writing.
- **GOTCHA**: The class doc must say *why* this exists — no SIA → no Stripe → cash-only pilot — and that it is strictly safer than `StubPaymentsProvider`, which reports success without moving money.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1 (a production boot is possible at all)

### CREATE `services/api/src/features/payments/card-payments-disabled.provider.spec.ts`

- **IMPLEMENT**: expected (a card charge is refused with the right error) · edge (refusal is idempotent — two calls with the same key both refuse identically) · failure (it never returns a success-shaped result under any input).
- **PATTERN**: the existing payments specs in the same folder.
- **VALIDATE**: `pnpm --filter @taxi/api test -- card-payments-disabled`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/payments/payments.module.ts`

- **IMPLEMENT**: In `paymentsProviderFactory`, when `stripe` is null and `NODE_ENV === 'production'`, return `new CardPaymentsDisabledProvider()` instead of throwing. Keep `StubPaymentsProvider` for non-production. The existing throw message becomes unreachable — **delete it, don't leave it dead**; replace the block comment with the cash-only reasoning.
- **PATTERN**: the surrounding factory.
- **GOTCHA**: This changes a documented safety property. The comment must record that the *stub* was the danger (silent success), not the absence of Stripe, and that a future SIA + Stripe key restores `StripePaymentsProvider` with no code change.
- **VALIDATE**: `pnpm --filter @taxi/api test -- payments`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/common/config/env.schema.ts` — add `ALLOW_STUB_MAPS_PROVIDER`

- **IMPLEMENT**: An explicitly-false-by-default boolean coerced from the string env (`z.enum(['true','false']).default('false').transform(v => v === 'true')` or equivalent — match how the file handles other coercions). The doc comment must state: what it disables, why it exists (no `MapsProvider` implementation exists yet), what it costs (quotes priced off straight-line distance, no polyline), that it is safe only because Stripe is absent so no real money moves, and **that the OSRM ticket deletes it**. <!-- Corrected in review (PR #147, round 2 N4): "Stripe is absent so no real money moves" is false as an acceptance criterion and the shipped docblock no longer says it. The absent key closes the CARD rail only; a cash ride quoted at haversine × 1.35 is real money at the kerb. The condition to state is the CLOSED PILOT, and its due date is the pilot opening, not #134. See the NOTES correction. -->
- **PATTERN**: `MAPS_ETA_FAILURE_TTL_SECONDS`'s kill-switch comment (#103) — the same "config-level switch so it isn't a deploy" reasoning.
- **GOTCHA**: Do **not** put this in the `.superRefine` production block as a relaxation of secret rules. It gates one provider factory and nothing else.
- **GOTCHA**: Add it to `.env.example` with the same explanation, defaulted off.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api test -- env.schema`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/geo/geo.module.ts`

- **IMPLEMENT**: `if (env.NODE_ENV === 'production' && !env.ALLOW_STUB_MAPS_PROVIDER) throw …`. Extend the existing error message to name the switch and the OSRM ticket. Update the module doc comment at lines 12-13: it currently claims "#13/#16 replace this factory" — correct it to name the OSRM ticket instead.
- **PATTERN**: unchanged factory shape.
- **GOTCHA**: `services/api/CLAUDE.md` states "`StubMapsProvider` throws at boot under `NODE_ENV=production`, like `SMS_PROVIDER`." That sentence becomes false. **Update it** — a rules file that lies is worse than no rule. Same for any equivalent line in the root `CLAUDE.md`.
- **VALIDATE**: `pnpm --filter @taxi/api test -- geo.module`
- **SATISFIES**: AC #1

### ADD spec coverage for both gates

- **IMPLEMENT**: In the geo module spec — production + switch off → throws; production + switch on → binds `StubMapsProvider`; non-production → binds regardless. In the payments module spec — production + no Stripe → binds the refusing provider, not the stub, and does not throw.
- **PATTERN**: existing factory specs in each slice.
- **VALIDATE**: `pnpm --filter @taxi/api test`
- **SATISFIES**: AC #1

### CREATE `db/src/migrate-run.ts` and ADD the `migrate:run` script

- **IMPLEMENT**: Mirror `db/src/seed/run.ts` exactly: read `DATABASE_URL` (same dev default), `createDb`, `await migrateDb(db)` in a `try`, `await pool.end()` in a `finally`, log what ran, `main().catch(err => { console.error(err); process.exit(1) })`. Add `"migrate:run": "tsx src/migrate-run.ts"` to `db/package.json` and ensure `tsconfig.build.json` emits it to `dist/`.
- **PATTERN**: `db/src/seed/run.ts` (whole file).
- **IMPORTS**: `createDb` from `./client`, `migrateDb` from `./migrate`.
- **GOTCHA**: This exists because `drizzle-kit` is a **devDependency** — `drizzle-kit migrate` cannot run in a pruned runtime image. `drizzle-orm`'s migrator is a production dep, so this path works. Say that in the file's doc comment.
- **GOTCHA**: `MIGRATIONS_DIR` is `__dirname/../migrations`, resolved from `db/dist/`. The Dockerfile **must** copy `db/migrations/` into the image at the matching relative location, or migrate finds an empty folder and silently applies nothing.
- **VALIDATE**: `docker compose up -d --wait db && pnpm --filter @taxi/db migrate:run` — then re-run; the second run must be a no-op, not an error.
- **SATISFIES**: AC #2

### CREATE `services/api/Dockerfile` and `.dockerignore`

- **IMPLEMENT**: Multi-stage. Builder: node 20 (match CI), corepack + `pnpm@10.33.2`, copy the workspace manifests + lockfile, `pnpm install --frozen-lockfile`, copy sources, `pnpm turbo run build --filter=@taxi/api...` so `@taxi/shared` and `@taxi/db` build first. Runtime: node 20 slim, production deps only, plus `db/dist`, `db/migrations`, `packages/shared/dist`, `services/api/dist`. `CMD ["node", "services/api/dist/main.js"]` (verify the actual emitted path — `nest build` output layout).
- **PATTERN**: the build chain in `turbo.json` (`build` dependsOn `^build`) and the CI setup steps in `.github/workflows/ci.yml`.
- **GOTCHA**: Do **not** run `test` in the image — `services/api`'s `pretest` and `db`'s `pretest` both shell out to `docker compose`, which will not exist in the build container.
- **GOTCHA**: `db/migrations/` must land where `db/dist/migrate.js`'s `__dirname/../migrations` resolves. Verify by running the migration inside the built image, not by reading the Dockerfile.
- **GOTCHA**: `.dockerignore` must exclude `node_modules`, `**/dist`, `.git`, `.env`, `.claude` — otherwise the context is enormous and a stale local `dist` can shadow the build.
- **VALIDATE**: `docker build -f services/api/Dockerfile -t taxi-api .` then `docker run --rm taxi-api node -e "require('fs').readdirSync('/app/db/migrations')"` (adjust path) — must list the `.sql` files.
- **SATISFIES**: AC #1, AC #2

### VALIDATE the image boots with a production-shaped env, locally

- **IMPLEMENT**: Run the built image against local compose Postgres/Redis with `NODE_ENV=production`, freshly generated 32-char `JWT_SECRET` and `OTP_PEPPER`, `ALLOW_STUB_MAPS_PROVIDER=true`, no `STRIPE_SECRET_KEY`, the Twilio trial trio, and a non-localhost `PUBLIC_TRACKING_BASE_URL`. Then deliberately break each gate one at a time and confirm it refuses.
- **GOTCHA**: This is the single highest-value validation in the plan. Every production gate is exercised here, on your machine, before a server exists. Do not skip to provisioning.
- **VALIDATE**: `curl -fsS localhost:<port>/health` → `{"status":"ok","service":"api"}`; then confirm boot **fails** with (a) `JWT_SECRET=dev-only-change-me`, (b) `ALLOW_STUB_MAPS_PROVIDER` unset, (c) `PUBLIC_TRACKING_BASE_URL=http://localhost:3000`, (d) two of three `TWILIO_*` set.
- **SATISFIES**: AC #1

### PROVISION the Hetzner CX22

- **IMPLEMENT**: CX22 (2 vCPU / 4 GB / 40 GB) in Falkenstein or Helsinki. Docker + compose plugin, `ufw` allowing 22/80/443 only, `unattended-upgrades`, SSH key-only, a non-root deploy user. Decide IPv4 vs IPv6-only here: IPv6-only saves ~€0.60/mo behind Cloudflare's proxy but makes direct SSH harder from IPv4-only networks — **take IPv4 for the first deploy** and revisit; €0.60 is not worth a lockout risk on day one.
- **GOTCHA**: Record the actual monthly price at purchase. The €4.49 in this plan is from 2026-08-14 and Hetzner adjusted prices twice in 2026.
- **VALIDATE**: `ssh deploy@<host> docker run --rm hello-world`
- **SATISFIES**: AC #1

### CREATE `compose.prod.yml` and `Caddyfile`

- **IMPLEMENT**: Overlay adding `api` (the ghcr.io image, `env_file`, `depends_on` both healthchecks with `condition: service_healthy`, `restart: unless-stopped`) and `caddy` (ports 80/443, reverse-proxying to `api`). Postgres must **not** publish 5432 to the host in production — remove the port mapping in the overlay. Redis likewise.
- **PATTERN**: `docker-compose.yml` — reuse its healthchecks verbatim; they were hard-won (the TCP-not-socket `pg_isready` comment explains why).
- **GOTCHA**: TLS terminates at Cloudflare, so Caddy serves plain HTTP on 80 to the proxy, or uses Cloudflare Origin certs. Pick one and say which in the Caddyfile comment.
- **GOTCHA**: Caddy v2 upgrades WebSockets automatically — do not hand-write `Upgrade`/`Connection` headers.
- **VALIDATE**: `docker compose -f docker-compose.yml -f compose.prod.yml config` parses; then `up -d --wait` on the host.
- **SATISFIES**: AC #1, AC #3

### CONFIGURE Cloudflare and the domain

- **IMPLEMENT**: A/AAAA record to the box, proxy enabled, TLS mode Full (strict) if using Origin certs. Set `PUBLIC_TRACKING_BASE_URL` to the dispatch app's eventual hostname.
- **GOTCHA**: Socket.IO must survive the proxy. Cloudflare has an idle timeout; Socket.IO's default 25 s ping should keep it open — **verify with a real long-lived connection, don't assume**.
- **GOTCHA**: `CORS_ORIGINS` must list the real origins. It is the single source of truth for both REST (`main.ts`) and the Socket.IO adapter — a missing origin fails the handshake in a way that looks like an auth error (`redis-io.adapter.ts` comment).
- **VALIDATE**: `curl -fsS https://<domain>/health` from a phone on cellular, not from the LAN.
- **SATISFIES**: AC #1

### RUN migrations, then seed once

- **IMPLEMENT**: Migrations: `docker compose -f … run --rm api node db/dist/migrate-run.js` (adjust path). Seed: the same, with `db/dist/seed/run.js`, **once, manually**.
- **GOTCHA**: Seed is idempotent but its `platform_config` conflict set re-asserts `commissionPct` and the debt limit, so an automated re-seed would stomp an admin edit once #20 exists. Migrate automatically on deploy; seed by hand. Document both.
- **VALIDATE**: `SELECT PostGIS_Full_Version();` succeeds; `SELECT count(*) FROM geozones;` → 4; re-running migrate is a no-op.
- **SATISFIES**: AC #2

### CREATE `.github/workflows/deploy.yml`

- **IMPLEMENT**: `workflow_dispatch` only. Build the image, push to ghcr.io, SSH to the host, `docker compose pull && up -d`, then run the migration. Secrets: `SSH_HOST`, `SSH_KEY`, `GHCR_TOKEN`.
- **PATTERN**: `.github/workflows/ci.yml` for the pnpm/node setup.
- **GOTCHA**: Manual trigger deliberately — auto-deploy-on-merge is a decision for after the first successful manual run. Say so in a comment.
- **VALIDATE**: `gh workflow run deploy.yml` completes and `/health` answers the new build.
- **SATISFIES**: AC #2

### CREATE `scripts/backup-db.sh` + cron

- **IMPLEMENT**: `pg_dump` from the db container → gzip → object storage (R2 or B2), timestamped, with retention. Daily cron on the host.
- **GOTCHA**: **Verify a restore.** A backup that has never been restored is not a backup. This is the responsibility taken on by leaving a managed platform, and pilot data is real rides and a money ledger.
- **VALIDATE**: run the script; download the dump; restore into a scratch database; `SELECT count(*) FROM geozones;` → 4.
- **SATISFIES**: AC #2

### CREATE `docs/runbooks/hetzner-deploy.md`

- **IMPLEMENT**: Provisioning · every production env var with its source and why · deploy · migrate/seed (and why seed is manual) · backup + **restore** · rollback · the spend estimate · known-broken (`/t/:token` 404s until #18/#19).
- **PATTERN**: `docs/runbooks/settlement-recovery.md`.
- **GOTCHA**: Root `DEPLOY.md` belongs to the anketa mini-project — **do not touch it** (#13 says so explicitly).
- **VALIDATE**: a reader can provision a second box from this document alone.
- **SATISFIES**: AC #2

### RECORD the spend estimate with provenance

- **IMPLEMENT**: In the runbook: the **derived** pre-deploy estimate with arithmetic and its conditions, then an **observed** figure from the first full week's real invoice, replacing it. Cite `docs/research/hosting-sms-cost-research.md` §5 rather than re-deriving.
- **GOTCHA**: The root `CLAUDE.md` numbers rule is explicit and has been broken twice (#87, #107). A figure under an "Observed" heading that no invoice produced is the defect *even if the arithmetic is right*. Label the pre-deploy number `derived` and say what it assumes: no paid maps provider, Twilio trial (€0), month-3 target ride rate.
- **VALIDATE**: every number in the section carries a provenance label and either an arithmetic line or a named source.
- **SATISFIES**: AC #3

### AMEND `docs/epics/sakta-cab.architecture.md`

- **IMPLEMENT**: Amend the **Hosting** key decision (Railway → Hetzner, dated 2026-08-14, with the reason: cheapest option, hourly billing suits a pilot falsifiable at 3 months, and the ops surface is accepted deliberately). Add the maps posture (self-hosted OSRM planned; stub behind a switch in the interim) and the payments posture (cash-only until the SIA; card refused, not stubbed). Update the "Missing pieces" line that reads "Railway environment (when first needed)".
- **GOTCHA**: This reverses a decision that explicitly rejected Fly.io as *"more ops surface for a solo builder"* — a VPS is more still. Record the reversal honestly; do not quietly rewrite it as if Railway was never chosen.
- **GOTCHA**: The root `CLAUDE.md` and the epic issue body also reference the hosting choice. Grep for `Railway` across `docs/`, `CLAUDE.md`, and `.claude/` and fix every hit — the numbers rule's sibling lesson (#107) is that retiring a claim means grepping the **noun**, not the sentence.
- **VALIDATE**: `grep -rn "Railway" docs/ CLAUDE.md .claude/ --include='*.md'` returns only historical//`docs/research/hosting-sms-cost-research.md` references, each clearly marked as superseded.
- **SATISFIES**: AC #2

### FILE the follow-up tickets

- **IMPLEMENT**: (1) `OsrmMapsProvider` + OSRM container — deletes `ALLOW_STUB_MAPS_PROVIDER`; note the amd64 verification. (2) Skip SMS for app riders. (3) Shorter tracking links + trimmed LV/RU templates — spans `@taxi/shared` (`trackingTokenSchema`), `mintTrackingToken`, the i18n catalogs, and needs a test asserting the 1-segment property against a worst-case driver name. (4) SMS provider bake-off. Link (1) from `geo.module.ts` and from this plan's Forward-references.
- **VALIDATE**: `gh issue list` shows all four, and the maps switch's comment names ticket (1) by number.
- **SATISFIES**: AC #1

---

## TESTING STRATEGY

### Unit Tests

Jest (`services/api`, `.spec.ts` beside the source, `maxWorkers: 1`). Three new/changed factory paths:

- `CardPaymentsDisabledProvider` — refuses; never returns success.
- `paymentsProviderFactory` — production + no Stripe binds the refusing provider and does not throw; non-production still binds the stub; a Stripe key still wins.
- `mapsProviderSourceFactory` — the switch's three cases.

### Integration Tests

No new integration suite. The existing api integration specs must stay green — the payments change touches a factory the harness overrides by token (`PAYMENTS_PROVIDER` is exported for exactly this), so verify the override still wins.

### Edge Cases

- Migration runner against an already-migrated database → no-op, exit 0.
- Seed run twice → converges, does not duplicate.
- Two of three `TWILIO_*` set → boot refused in *every* environment (the schema's deliberate exception).
- `ALLOW_STUB_MAPS_PROVIDER=true` in non-production → no behaviour change.
- Socket.IO connection held >60 s through Cloudflare → survives.
- Container restart mid-dispatch → the sweeper resumes from `ride_offers` rows (no timers), so nothing is stranded. Verify.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint --force
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/api test
pnpm --filter @taxi/db test
```

### Level 3: Full gate (CI parity)

```bash
docker compose up -d --wait
export REDIS_TEST_URL=redis://localhost:${REDIS_PORT:-6379}
pnpm turbo run typecheck lint test build --force
```

### Level 4: Manual Validation (the ticket's acceptance criteria)

```bash
# AC 1a — public health, from OUTSIDE the LAN (phone on cellular, or a remote shell)
curl -fsS https://<domain>/health          # → {"status":"ok","service":"api"}

# AC 1b — Socket.IO connect + echo from outside the LAN
node -e "const io=require('socket.io-client');const s=io('https://<domain>',{transports:['websocket']});s.on('connect',()=>{console.log('connected',s.id);process.exit(0)});s.on('connect_error',e=>{console.error(e.message);process.exit(1)});setTimeout(()=>{console.error('timeout');process.exit(1)},10000)"

# AC 2 — migrations + seed applied
psql "$DATABASE_URL" -c "SELECT PostGIS_Full_Version();"
psql "$DATABASE_URL" -c "SELECT count(*) FROM geozones;"        # → 4
psql "$DATABASE_URL" -c "SELECT commission_pct FROM platform_config;"  # → 15

# Gates hold
#   boot must FAIL with JWT_SECRET=dev-only-change-me
#   boot must FAIL with PUBLIC_TRACKING_BASE_URL=http://localhost:3000
#   boot must FAIL with ALLOW_STUB_MAPS_PROVIDER unset
#   a card settlement must be REFUSED, not silently succeed
```

### Level 5: Additional Validation

- Restore the `pg_dump` into a scratch database and count rows. A backup never restored is not a backup.
- Hold a Socket.IO connection open >60 s through Cloudflare.

---

## ACCEPTANCE CRITERIA

From the issue, plus what this plan adds:

- [ ] **AC 1** — Public `/health` → 200; Socket.IO connect + echo verified **from outside the LAN**
- [ ] **AC 2** — Migrations + Rīga seed applied; deploy-from-main documented in `docs/runbooks/` (**not** root `DEPLOY.md`)
- [ ] **AC 3** — Monthly spend estimate recorded against the guardrail, each figure labelled `derived`/`observed` with arithmetic or a named source
- [ ] `NODE_ENV=production` boots with **every** gate intact except the one documented maps switch
- [ ] A card settlement in production is **refused**, never silently succeeded
- [ ] Backup runs on a schedule **and a restore has been performed at least once**
- [ ] `sakta-cab.architecture.md` amended; no stale `Railway` reference survives outside clearly-marked history
- [ ] Four follow-up tickets filed; the maps switch's comment names the OSRM ticket by number
- [ ] `pnpm turbo run typecheck lint test build --force` green
- [ ] No regressions in existing api/db suites

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual AC checks run from outside the LAN
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

**Decisions taken in this plan** (Linards, 2026-08-14, in session — recorded here rather than re-asked):

1. **Host is Hetzner CX22, not Railway.** "As cheap as possible", "no Railway". This reverses an epic-level decision and requires the architecture amendment task above.
2. **`OsrmMapsProvider` is its own ticket; #13 ships the config switch.** Rationale: #13's AC says nothing about maps; its size estimate is 150–300 lines; #13's own comment already concedes the stub-replacement step is *"a prerequisite of that step rather than of this issue as a whole"*; and OSRM's amd64-only container situation needs verification that has not been done. **This diverges from `geo.module.ts:12-13`, which names "#13/#16" as where the stub is replaced** — that comment is corrected by a task above.
3. **Cash-only pilot; card payments are refused, not stubbed.** No SIA → no Stripe key → the existing production throw would block every deploy. Refusing is safer than the stub either way.

**Assumptions**:

- A Twilio **trial** account satisfies `smsProviderFactory`. `env.schema.ts` documents the trial-sender case, but this has not been executed. If a trial's credentials fail the schema's refines, a paid account (~€0.07/SMS to LV) is needed — small, but it changes the "€0 during testing" claim.
- OSRM/Valhalla is not needed for #13 at all. Only true because the stub switch exists.
- The driver app (#14) can reach a Cloudflare-proxied Socket.IO endpoint from LV mobile networks. Unverified until #14 exists.
- CX22's 4 GB is enough. Estimated ~1.0 GB for API + Postgres + Redis + Caddy — comfortable now, and Hetzner resizes in place to CX33 hourly-billed if metrics say otherwise. **Adding OSRM later costs ~750 MB** (≈5× the ~150 MB Latvia PBF), which still fits; geocoding would not.

**Would change the plan if answered differently**:

- If Atis is on **iPhone**, #14 needs TestFlight and an Apple Developer account ($99/yr) — not this ticket, but it changes the sequencing note in the runbook.
- If the pilot ever needs card payments before the SIA exists, the refusing provider becomes a blocker rather than a correct posture.

---

## NOTES (open canvas)

**Why not Railway.** The full comparison, with arithmetic, is `docs/research/hosting-sms-cost-research.md` §3. Short version: Railway is ~$8.55/mo idle and ~$33.25 at pilot, both derived; Hetzner is €4.49 flat with hourly billing and no commitment. The user's constraint was explicit. The cost of the switch is real — TLS, deploys, backups, patching, and being the person who restores Postgres at 02:00 — and the backup-restore-verification task exists because that is the one that actually bites.

**Why not Contabo or OVH.** Contabo's 24-month minimum is the wrong shape against a hypothesis the PRD says is falsifiable at 3 months. OVH bundles daily backups (genuinely valuable — it's exactly the responsibility being picked up here) but the headline price needs annual upfront, and the page read was the UK site in GBP while Latvia is eurozone. Either is a reasonable second choice; neither is cheaper than CX22.

**The maps switch is the weakest part of this plan** and should be treated as debt with a due date, not a feature. It is defensible only because: (a) Stripe is absent, so no real money moves off a bad quote; (b) the pilot is not open, so no rider is quoted a straight-line price; (c) the OSRM ticket that deletes it is small and next. If any of those three stop being true before OSRM lands, the switch should be removed and the deploy blocked instead.

> **Corrected in review (PR #147, round 2 N4).** (a) does not hold as written. The absent Stripe key closes the **card rail only** — `CardPaymentsDisabledProvider` refuses card charges — and a **cash** ride quoted at haversine × 1.35 is real money at the kerb. (b) is the load-bearing condition and carries the due date on its own: unset the switch before the first real rider, whether or not #134 has landed. The shipped texts (`env.schema.ts`, `.env.example`, runbook §3, `geo.module.ts`, the architecture doc) now say this; the paragraph above is left as written so the record shows what was corrected.

**Sequencing thought.** Phase 1 is worth doing even if the deploy slips: it is the difference between "production is unbootable" and "production boots." It's also entirely local — no account, no card, no server. Consider shipping Phase 1 as its own PR if the host provisioning stalls on anything.

**Rejected: running the seed on every deploy.** Idempotent, and its own comment sanctions re-seeding ("a re-seed corrects a hand-edited row") — but that sanction predates #20's config editor. Automating it now builds in a footgun that fires the day an admin edits the commission. Manual, documented, once.

**Rejected: IPv6-only to save €0.60/mo.** Correct in principle behind Cloudflare, and worth revisiting — but not on the day the box is first provisioned, when a lockout costs more than a year of the saving.

## AMENDMENTS

<!-- newest at the bottom -->

- **2026-08-25 (implementation)** — The maps switch covers the ROUTES clause only; production with `ALLOW_STUB_MAPS_PROVIDER=true` and no `GOOGLE_MAPS_API_KEY` still refuses to boot (the Places refusal #19/#125 added is an independent gate, and accepting straight-line quotes is not accepting a dead typeahead). Consequence: the host `.env` needs a Maps Platform key. The refusing payments provider answers `provider_error` (502), not `declined` (402): the seam pins exactly two reasons, and a 402 would blame a card nobody saw. The image needs the per-package `node_modules` (workspace symlinks) copied, not just the root — found by booting it. Deploy secrets are four, not three: `SSH_KNOWN_HOSTS` pins the host key. Provisioning, domain, Cloudflare, Twilio and the first deploy are external steps left to the runbook; the backup restore was rehearsed locally, not on the box.
