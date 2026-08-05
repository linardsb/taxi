# api — service-specific rules

NestJS backend: REST + Socket.IO gateway + dispatch engine. Read the root `CLAUDE.md` first.

- Vertical slices under `src/features/<name>/` (auth, users, drivers, rides, dispatch, pricing, payments, ledger, geo, geozones, notifications, support, stats). Each slice: `<name>.module.ts`, controller, service, schemas (zod from `@taxi/shared` where cross-surface), tests.
- **Vehicles are not a slice of their own** — they live inside `features/drivers/`. A vehicle belongs to a driver (`vehicles.driver_id` FKs `drivers.user_id`), and splitting them would force a cross-slice import for the child-seat/category filters dispatch runs.
- Ride status writes ONLY via `assertTransition()` from `@taxi/shared`. Money ONLY in integer cents.
- Provider SDKs (Google Maps, Twilio, Stripe) are imported ONLY inside the slice implementing the corresponding seam interface from `@taxi/shared/seams`; everything else injects the interface.
- Live driver locations live in Redis (GEO sets); PostGIS/Drizzle for persistent data (geozones, recorded tracks). Drizzle migrations in `db/`.
- Live positions go through `DRIVER_LOCATION_STORE` (a Redis GEO port in the drivers slice). **The location ping path must never inject `DRIZZLE`** — presence lives in the Redis online set precisely so it doesn't have to, and a spec boots that path with a `DRIZZLE` provider that throws on any access.
- `drivers.status = 'on_ride'` is written only by the ride lifecycle (#11); the driver-facing presence route accepts `online`/`offline` only (`DRIVER_PRESENCE_STATUSES`).
- Socket event names/payloads come from `RT` in `@taxi/shared` — never string literals.
- Cross-cutting Nest plumbing (env config, Drizzle, Redis KV, the zod pipe) lives in `src/common/`; `src/features/` stays feature-vertical.
- Auth is fail-closed: `JwtAuthGuard` + `RolesGuard` are global (`APP_GUARD`); a route is only reachable unauthenticated with `@Public()`. Sockets authenticate in the handshake, and clients never request room joins.
- Logging: structured, `domain.component.action_state` taxonomy (see `.claude/references/logging-standard.md`).
