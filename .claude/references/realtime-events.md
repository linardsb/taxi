# Realtime events (reference)

**Source of truth: `RT` + payload types in `packages/shared/src/realtime-events.ts`.** Socket.IO, Redis adapter. Event names follow `domain:action`.

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `driver:location` | driver app → api → dispatch board (+ rider during active ride) | `DriverLocationEvent` | Throttled by movement; live positions in Redis GEO, not Postgres |
| `ride:status` | api → rider, driver, dispatch | `RideStatusEvent` | Emitted on every state-machine transition |
| `ride:offer` | api → driver app | `RideOfferEvent` | Has `expiresAt`; decline/timeout triggers re-offer |
| `dispatch:board` | api → dispatch portal | board snapshot/diff | Feeds Dina's live console |

Rules:
- Rooms: `ride:<id>` (rider+driver+dispatch), `dispatch:<cityId>` (board), `driver:<id>` (offers).
- Auth on connect via JWT; a socket only joins rooms its role allows.
- Add an event = add it to `RT` + payload type in shared FIRST, then this table.
