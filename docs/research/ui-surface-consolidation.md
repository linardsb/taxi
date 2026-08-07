# Research: UI surface consolidation — fewer/leaner UIs for Sakta Cab

**Status:** DECIDED 2026-08-07 (Linards, grilling session) — all levers resolved; tickets #14–#21 re-cut accordingly. Decisions recorded in `docs/epics/sakta-cab.architecture.md` §"UI surface decisions"; functionality preservation tracked in `docs/epics/mvp-traceability.md`.
**Feeds:** the 2026-08-07 re-slice of the surface tickets. Evidence base: `driver-ux-evidence.md`, `rider-ux-evidence.md`, `dispatch-ops-ux-evidence.md` (same folder).
**Context:** solo build; question raised while the spike #4 GPS field kit was being shipped. Current architecture doc (`docs/epics/sakta-cab.architecture.md`) inherits the 4-surface split from the skeleton proposal without arguing it explicitly.

## Decisions (2026-08-07)

| Lever | Decision |
|---|---|
| 1 — dispatch+admin merge | **ADOPTED.** One Next.js app, role-based route groups `/dispatch` + `/admin`; `apps/admin` workspace retires into `apps/dispatch`. Zero functional change. |
| 2 — rider PWA-first | **REJECTED — rider ships native** (Expo → TestFlight + Play internal/APK, EAS Update for instant pilot iteration). The spike became unnecessary: research answered both open questions against PWA (iOS web push needs add-to-home-screen — exactly the users who won't do it; react-native-web has open ARIA bugs vs the screen-reader-first launch requirement). PWA's no-install benefit is served better by the SMS + no-login live-tracking web page (new ticket). Full verdict: `rider-ux-evidence.md`. |
| 3 — buy-don't-build admin | **ADOPTED.** #20 re-cut to minimal bespoke (driver/vehicle approval + CRUD, trips CSV, platform-config editor) inside the merged app; stats via self-hosted Metabase when the first recurring question appears; legal = public static pages. Support-inbox stub consciously deferred (flagged in traceability map). |
| 4 — fewer screens, not fewer apps | **Standing rule confirmed** — enforced per-ticket by the existing breadboard + friction-audit hard rules, now with measurable targets in `docs/ux-metrics-ledger.md`. |
| Rider+driver single app | **Not pursued** (as recommended below). "Why two mobile apps" note added to the architecture doc. |

## The question

Can Sakta Cab run on fewer UIs than the four planned surfaces — specifically, one mobile app for riders + drivers with permission-based UI — or otherwise get a more concise UI footprint?

## Current state (planned)

| Surface | Users | Form |
|---|---|---|
| `apps/rider` | Passengers | Mobile app (Expo / RN) |
| `apps/driver` | Drivers | Mobile app (Expo / RN) |
| `apps/dispatch` | Dispatcher (Dina's console) | Web portal (Next.js) |
| `apps/admin` | Owner — stats, config, legal | Web portal (Next.js) |

All four talk only to `services/api`; contracts/enums/state machine/theme come from `packages/shared`. Nothing below the UI layer is affected by any option in this doc.

## Option examined: single rider+driver mobile app (role-based UI) — recommend NO

Technically feasible (role-gated route groups after login; inDriver shipped this way for years). Rejected because the blocker is not UI:

- **Permissions are declared per app at build time, not per user role.** The driver experience needs `ACCESS_BACKGROUND_LOCATION`, a location-type foreground service, and the iOS "Always"/background-location mode — exactly the machinery spike #4 is field-testing. A combined app ships those declarations to every rider install:
  - Google Play background-location policy review (mandatory declaration + demo video) is judged against the app's primary audience — riders, who never need it. Material rejection risk.
  - Privacy optics: a passenger app that declares always-on location tracking.
  - The OEM battery-whitelisting problem (spike #4's subject) leaks into the rider install base for zero benefit.
- **Release coupling:** a driver hotfix rides the same store review as the rider app; one rejection stalls both.
- **Bloat:** driver nav/background machinery in every rider download.
- **Onboarding friction:** a first-run role picker fails the friction-audit hard rule for the rider flow.
- **Pilot agility lost:** with ≥10 drivers (Q4-2026), the driver app needs no store at all — distribute as APK/internal track (the GPS spike kit already proved this path: Worker + R2 hosting) and iterate with zero review latency, while the rider app stays store-clean. One binary forfeits this.
- Cost being avoided is already mitigated: monorepo + `@taxi/shared` means two apps ≠ two codebases; if component overlap emerges, add `packages/ui`, don't merge apps.

Industry: Bolt/Uber/Lyft all ship two apps.

## Consolidation levers that DO work

### 1. Merge dispatch + admin into one Next.js app (role-based routes) — strongest candidate

The permission-based-UI idea applied where it is actually free: web has no manifest, no store, no install. One app shell, one auth, one deploy, one Tailwind setup; route groups `/dispatch` and `/admin` keep the CLAUDE.md separation (stats/config/legal never visually pollute the operational console).

- **Functional change: zero.** Same screens, same role boundaries, different packaging.
- **Timing constraint: decide before the dispatch/admin epics are sliced into tickets** — it changes ticket structure.

### 2. Rider app as PWA-first (same Expo codebase → react-native-web) — contingent on a spike

Only the **driver** app truly requires native (background GPS, foreground service, OEM battery policy). The rider flow is entirely foreground: request → matched → track → pay. Expo compiles to web, so the rider app could ship as a PWA for the pilot (no store accounts, no review latency, instant updates), with stores later.

Functional deltas to accept or mitigate:

- **Locked-phone notifications** ("driver assigned / arriving"): native push territory; iOS web push requires add-to-home-screen. Mitigations: SMS via the existing provider seam (watch the <€100/mo budget guardrail on volume) or accept riders keep the tab open during the short match-to-pickup window. **This is the go/no-go question.**
- **Screen-reader-excellent differentiator survives but changes tech path:** VoiceOver/TalkBack over ARIA instead of native a11y APIs; react-native-web's a11y mapping is good-not-perfect. Fold into the same spike.
- Minor: weaker offline states, less-smooth maps, no haptics. Payments unaffected (Stripe on web is easier; taxi is a physical service, no IAP requirement).
- **Fallback if the spike fails:** ship rider native as originally planned; nothing else in this doc changes.

**Proposed spike:** iOS/Android web-push reality check + RN-web screen-reader audit on one real rider screen.

### 3. Buy-don't-build the admin internals

At pilot scale, "admin" is reading numbers and editing config rows:

- Stats → Metabase (free, self-hosted) on Postgres.
- Config → Drizzle Studio edits of `platform_config` (commission still resolved at runtime via `resolveCommissionPct()` — hard rules hold).
- Footnote: rider-visible legal/terms pages are public static pages, not admin UI — they'll need a home eventually regardless.

Capabilities preserved; bespoke UI deferred until real admin flows earn pixels. Combines with lever 1 (whatever admin UI remains is a route group).

### 4. Concise = fewer screens, not fewer apps

The pilot ride loop is small: rider ≈ 4–5 screens (request → matched → track → done/pay), driver ≈ 4 (online → offer → drive → complete). The existing hard rules (breadboards + friction audit with justified tap counts) already enforce this — applied ruthlessly, merging apps saves almost nothing while adding routing complexity.

## Rejected as overengineering

Server-driven UI (screens-as-data), universal super-app frameworks — same class as the already-rejected design-token pipeline: front-loads architecture to save UI work that is already small.

## Functional-impact summary

| Lever | Intended functionality |
|---|---|
| Dispatch+admin merge | Unchanged |
| Screen-count discipline | Unchanged (by definition of the friction-audit rule) |
| Metabase/Drizzle admin | Capabilities unchanged; polish deferred; internal-only so acceptable |
| Rider PWA-first | Same intent, **contingent on notification spike**; a11y path changes; minor offline/maps/haptics losses |
| Rider+driver single app | Not pursued |

## Next steps — as resolved 2026-08-07

1. ~~Decide lever 1 before those epics are sliced~~ → **done**: merge adopted; "why two mobile apps, one web app" note added to `sakta-cab.architecture.md`.
2. ~~Define and run the rider-PWA spike~~ → **spike cancelled, question closed by research**: rider ships native (see Decisions table and `rider-ux-evidence.md` verdict).
3. ~~Lever 3 default posture~~ → **adopted and encoded** in the re-cut #20.
4. Driver app stays native; spike #4 (field drive scheduled/imminent) still determines *how* native (background task vs. keep-awake fallback) — unchanged.
