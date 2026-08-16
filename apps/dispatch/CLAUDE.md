@AGENTS.md

# dispatch — app-specific rules

**The merged web app** (decision 2026-08-07): Dina's console at `/dispatch`, the admin panel at `/admin` (#20), and the public tracking page at `t/[token]` — one Next.js app, one auth, one deploy. The retired `apps/admin` workspace's scope lives on as the `/admin` route group. Read the root `CLAUDE.md` first; contracts come from `@taxi/shared`.

## Auth model (#18)

- OTP login at `/login`; the session (`{accessToken, expiresAt, user}`) lives in **localStorage** (`taxi.console.session`) because the socket handshake needs the raw token client-side. XSS exposure accepted for an internal operator console.
- **The client guard (`RequireRole`) is UX only** — there is deliberately no `middleware.ts` (localStorage is invisible to edge middleware). Enforcement is the API's `@Roles('dispatcher','admin')` guard on every read plus the gateway's handshake + token sweep.
- Dispatchers are **provisioned**, never signed up: `pnpm --filter @taxi/api provision:dispatcher +371… [name]` (no `--` — pnpm 10 forwards it literally). The login form sends `role:'rider'` (the only role `otpRequestSchema` accepts) and the stored role wins; the form's role check discards non-console tokens.

## Console surfaces

- `/dispatch` — the live board (#18): full-state `dispatch:board` frames every 2 s, wholesale state replace, REST snapshot (`GET /dispatch/board`) on every (re)connect, 5 s read-only polling fallback when offline. The connection pill derives from **frame receipt** (`board-state.pillFrom`), never socket flags — zero silent staleness. Last frame persists to localStorage so the driver phone list survives anything.
- Sockets: direct browser→API via `NEXT_PUBLIC_API_URL` (baked at build — declared on turbo's `build.env`); no client-initiated room joins, ever (the server places sockets by role).
- Alarm discipline (ISA-18.2): toast/flash/beep ONLY for `dispatch:unclaimed`, `dispatch:sms_failed`, and the socket going offline. Ride progress recolors in place.
- `/admin` scope (#20, placeholder today): statistics (orders accepted/rejected/duration by hour/day/month/year; per-geozone and per-driver later), config surfaces (commission %, dispatch mode per geozone, pricing model per category, city/geozone management — never constants in code), driver onboarding review (documents, licence, car photos — approval gates a driver's first shift), legal.
- Phone-order entry, force-assign UI, zone/queue view — #19; build so a caller-ID lookup can prefill the order form. Keyboard-first: a dispatcher on a call must manage without the mouse.

## Conventions

- Organize by feature (Vertical Slice): `src/features/<name>/` with `index.ts` as the slice's public API.
- UI language: LV first (Dina's working language); every string via `formatMessage` from the shared catalog anyway.
- Styling: inline `style={{}}` with `var(--color-*)` etc. from `themeCssVars()` (injected per segment layout); no Tailwind utilities in feature components.
- Tests: vitest + RTL (jsdom), co-located `src/features/<name>/*.test.tsx`; no `globals: true` — import `describe/it/expect/vi`; structural stubs per file (leaflet, socket.io-client); run via `pnpm turbo run test --filter @taxi/dispatch` (a direct `pnpm --filter … test` needs a built `@taxi/shared`).
