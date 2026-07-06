@AGENTS.md

# rider — app-specific rules

The client app (Expo/React Native). Read the root `CLAUDE.md` first; contracts come from `@taxi/shared`.

- **Accessibility is a launch differentiator**: every screen fully usable with VoiceOver/TalkBack — labeled controls, logical focus order, announced ride-status changes, and a list-based alternative wherever the map is the primary control. No screen ships without it.
- i18n from day one: LV (default) / RU / EN via the shared catalogs; language auto-detected from the device. No hardcoded user-facing strings.
- Organize by feature (Vertical Slice): `features/<name>/` owns screens, hooks, components, tests.
- Booking flow rules from the outline: pickup defaults to GPS location (draggable pin), recent/frequent addresses suggested, multi-stop supported, payment method is NOT editable once the ride is accepted (`isPaymentMethodLocked`).
- Money renders from integer cents; EUR balance is always visible on the home screen.
