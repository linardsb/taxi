@AGENTS.md

# rider — app-specific rules

The client app (Expo/React Native). Read the root `CLAUDE.md` first; contracts come from `@taxi/shared`.

- **Accessibility is a launch differentiator**: every screen fully usable with VoiceOver/TalkBack — labeled controls, logical focus order, announced ride-status changes. No screen ships without it. Focus is moved **explicitly** on every screen transition (`useScreenFocus` on the `accessibilityRole="header"` element) — RN does not reset the reader's cursor for you. The scripted audit is `docs/runbooks/rider-a11y-walkthrough.md`.
- **THERE IS NO MAP, and that is the design.** No `react-native-maps`, no pin, no polyline, no route preview. Map-pin pickup placement is one of the two flows that actually break for blind users (`docs/research/rider-ux-evidence.md` §1.2), so pickup and dropoff are entered the same way: type, hear the suggestions, tap one. Pickup **defaults** to coarse GPS and is never **required** to come from it. Do not reintroduce a pin in a new shape.
- i18n from day one: LV (default) / RU / EN via the shared catalogs; language auto-detected from the device. No hardcoded user-facing strings.
- Organize by feature (Vertical Slice): `features/<name>/` owns screens, hooks, components, tests. `src/app/**` is routing only — every route file is a one-line re-export.
- **Location is FOREGROUND ONLY.** `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE*`, `RECEIVE_BOOT_COMPLETED` and `expo-task-manager` must never appear in this app. Permissions are declared per app at build time, and Play policy reviews the driver app's background location against the rider majority — adding one here retroactively invalidates the two-app decision.
- Booking rules: any change to pickup or dropoff **discards the quote and mints a fresh `Idempotency-Key`** (`booking-draft.ts`); changing the payment method does neither, because cash and card are one identical fare. A 409 `idempotent_request_in_progress` is retried with the **same** key — a new one books a second car. Payment method is not editable once the ride is accepted (`isPaymentMethodLocked`).
- Multi-stop, scheduled rides, multi-taxi and rider bids are **not sent** by this app: `rideQuoteBodySchema` carries none of them, and the booking body sends only pickup, destination and payment method.
- Money renders from integer cents via `formatEur` — never a float.
- TypeScript is pinned at `~5.9.3` with `expo.install.exclude: ["typescript"]`. TS 6 splits typescript-eslint's peer instances and reddens `@taxi/shared`'s lint in files this app never touches.
- **Not built here (yet):** ride tracking, driver identity and plate, payment execution, ride history, push notifications, server-backed saved addresses. All #17 or later. Saved addresses are device-local (AsyncStorage) and are lost on reinstall — a documented, accepted cost (#16 decision D3).
