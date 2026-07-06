@AGENTS.md

# driver — app-specific rules

The driver app (Expo/React Native). Read the root `CLAUDE.md` first; contracts come from `@taxi/shared`.

- Background location is the core capability: `expo-location` + `expo-task-manager`; location stream publishes `driver:location` socket events (see `.claude/references/realtime-events.md`). Battery discipline matters — throttle by movement.
- Driver lifecycle: offline → online (after pre-shift check: photograph the car — Phase 1+) → on_ride. Status must mirror `DriverStatus` from `@taxi/shared`.
- Ride offers arrive as `ride:offer` events with an expiry; declining/timeout re-offers elsewhere — never assume an offer is still valid.
- Organize by feature (Vertical Slice): `features/<name>/`.
- Earnings display from integer cents; the balance shown is `balanceCents` (cash-ride commission nets against card earnings; negative blocks new rides).
