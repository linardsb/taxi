# api — service-specific rules

NestJS backend: REST + Socket.IO gateway + dispatch engine. Read the root `CLAUDE.md` first.

- Vertical slices under `src/features/<name>/` (auth, users, drivers, vehicles, rides, dispatch, pricing, payments, ledger, geo, geozones, notifications, support, stats). Each slice: `<name>.module.ts`, controller, service, schemas (zod from `@taxi/shared` where cross-surface), tests.
- Ride status writes ONLY via `assertTransition()` from `@taxi/shared`. Money ONLY in integer cents.
- Provider SDKs (Google Maps, Twilio, Stripe) are imported ONLY inside the slice implementing the corresponding seam interface from `@taxi/shared/seams`; everything else injects the interface.
- Live driver locations live in Redis (GEO sets); PostGIS/Drizzle for persistent data (geozones, recorded tracks). Drizzle migrations in `db/`.
- Socket event names/payloads come from `RT` in `@taxi/shared` — never string literals.
- Cross-cutting Nest plumbing (env config, Drizzle, Redis KV, the zod pipe) lives in `src/common/`; `src/features/` stays feature-vertical.
- Auth is fail-closed: `JwtAuthGuard` + `RolesGuard` are global (`APP_GUARD`); a route is only reachable unauthenticated with `@Public()`. Sockets authenticate in the handshake, and clients never request room joins.
- Logging: structured, `domain.component.action_state` taxonomy (see `.claude/references/logging-standard.md`).
