# Realtime events (reference)

**Source of truth: `RT` + payload schemas in `packages/shared/src/realtime-events.ts`.** Socket.IO, Redis adapter. Event names follow `domain:action`. Payloads are zod schemas; wire timestamps are ISO strings (`z.string().datetime()`), not `Date` — **all 8 events, no exception**. Where a wire schema is derived from a domain schema (`ride:offer`), it overrides the date fields to keep that true, because `z.coerce.date()` would make the handler's declared type a `Date` the wire never delivers.

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `driver:location` | driver app → api (ping); api → dispatch board + rider during active ride (event) | `DriverLocationPing` (in) / `DriverLocationEvent` (out) | Two schemas — see below. Throttled by movement; live positions in Redis GEO, not Postgres |
| `driver:queue` | api → driver app | `DriverQueueEvent` | Live place in a geozone queue; `position` is 1-based |
| `ride:status` | api → ride room (rider + driver + dispatch) | `RideStatusEvent` | Emitted on every state-machine transition — which is why there is no separate `ride:requested` |
| `ride:offer` | api → driver app | `RideOfferEvent` | `rideOfferSchema.extend({...})` with ISO-string `sentAt`/`expiresAt` — one source of truth, wire-accurate timestamps. Carries `quote` **and** `split`, so the driver sees the full fare and the commission line. `rideOfferSchema.parse(payload)` re-hydrates to `Date`. Decline/timeout triggers re-offer |
| `ride:offer_revoked` | api → driver app | `RideOfferRevokedEvent` | Clears the offer card: `expired`, `taken`, or `cancelled` |
| `ride:assigned` | api → ride room + winning driver | `RideAssignedEvent` | Carries `source` and, for dispatcher overrides, `dispatcherId` |
| `dispatch:board` | api → dispatch portal | `DispatchBoardEvent` | Feeds Dina's live console. Thin placeholder — #18 owns the board's real shape and will widen it |
| `dispatch:unclaimed` | api → dispatch portal | `DispatchUnclaimedEvent` | Flash alert for an order nobody took past `unclaimedAlertSeconds` (S9-4) |

Accept/decline are **not** socket events — they are REST calls (#10), which need idempotency, auth and retry semantics. The catalog carries offer delivery and revocation only.

Rules:
- Rooms: `ride:<id>` (rider+driver+dispatch), `dispatch:<cityId>` (board), `driver:<id>` (offers).
- Build room names with the `rideRoom()` / `driverRoom()` / `dispatchRoom()` helpers in `@taxi/shared` — never hand-build the strings.
- `driver:location` has **two** schemas on purpose. The inbound ping carries **no `driverId`**: the server takes the driver identity from the JWT. If the inbound schema carried it, any authenticated driver could spoof another driver's position on the dispatch board. Do not merge them.
- Socket.IO generics come from `ClientToServerEvents` / `ServerToClientEvents` in the same file. The server's listen map types inbound payloads as **`unknown`** on purpose — raw client JSON is untrusted, so the only way to read a field is `driverLocationPingSchema.parse(payload)`. The driver app emits through the typed `ClientToServerEmitEvents`.
- Auth on connect via JWT; a socket only joins rooms its role allows.
- Add an event = add it to `RT` + payload schema in shared FIRST, then this table.
