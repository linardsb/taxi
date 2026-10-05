# Compliance code-gap inventory (VID platform reporting + GDPR)

`observed` — read-only scout pass over `main` at `658d052`, 2026-10-04. Input to `plan-architecture` for the compliance epic, alongside `vid-platform-reporting.md` and `gdpr-platform-obligations.md`. Line numbers are as of that commit; `~` marks ones the scout located approximately.

| Id | Gap | Evidence |
|---|---|---|
| G1 | Vehicle hard delete, reachable by the driver via `DELETE /vehicles/:id` | `services/api/src/features/drivers/vehicles.repository.ts:110`, `vehicles.controller.ts:56-62`, `vehicles.service.ts:83` |
| G2 | `rides.vehicle_id` is `ON DELETE SET NULL` — deleting a car blanks which car served past rides; `unassignDriver` nulls driver/vehicle in place | `db/src/schema/rides.ts:52-53` (migration `0008`), `rides.repository.ts:379-381` |
| G3 | Cancel reason only emitted/logged, never stored; no `cancelled_at`; who cancelled lives only in terminal status; `ride_offers` has no decline reason | `ride-lifecycle.controller.ts:108`, `ride-lifecycle.service.ts:305-307`, `packages/shared/src/ride-state-machine.ts:12-15` |
| G4 | No ride history: status, driver/vehicle, payment method, settlement overwritten in place; per-status timestamps absent (`updated_at` trigger overwrites) | `ride-transition.service.ts:86`, `rides.repository.ts:328,379`, `ride-lifecycle.repository.ts:166,228`, `settlement.repository.ts:84` |
| G5 | No carrier (pārvadātājs) entity; no driver licence/permit or vehicle licence-card fields; `fleet_id` has no table; drivers/vehicles mutable with no history | `db/src/schema/drivers.ts:~25`, `vehicles.ts`, `drivers.repository.ts:156-332`, `admin-drivers.repository.ts:112-211` |
| G6 | GPS is Redis-only, 60 s TTL — nothing persisted; no recorded route for reporting; pickup/destination lat/lng in `rides.request`, `ride_offers`, `saved_places` | `drivers/location/redis-driver-location.store.ts`, `packages/shared/src/driver-presence.ts:26` |
| G7 | Backups pruned at 30 d remote / 7 d local — not a retention mechanism | `scripts/backup-db.sh:25-26`, `docs/runbooks/hetzner-deploy.md:701,740` |
| G8 | No erase/anonymise endpoint, no privacy notice or consent screen | grep of `services/api/src`, `packages/shared/src`, `apps/*/src`, `apps/dispatch/app` |
| G9 | Cascades: `ride_fare_lines` on ride delete, `saved_places` on customer delete; all other FKs `no action`; no DB-level immutability (triggers or revoked grants) | `rides.ts:154`, `customers.ts:67`, migration `0001:152-166` |
| G10 | No audit row for admin/dispatcher actions on drivers/vehicles; phone-booking audit insert failure is only logged | `admin-drivers.repository.ts`, `bookings.service.ts:33,80` |

Already in place: offers are persisted with status (`pending/accepted/declined/expired/revoked`) and `sent_at` (`rides.ts:~147-190`, `dispatch.repository.ts:263-358`); phone bookings produce ordinary `rides` rows (`booking_channel='phone'`); roles rider/driver/dispatcher/admin (`packages/shared/src/enums.ts:1`).
