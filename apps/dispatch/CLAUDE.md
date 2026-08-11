@AGENTS.md

# dispatch — app-specific rules

The dispatcher web portal (Next.js) — Dina's console, the 24/7 human-dispatcher differentiator. Read the root `CLAUDE.md` first; contracts come from `@taxi/shared`.

- Core surface: a live board (map + ride list) fed by `dispatch:board` socket events; phone-order entry form (create a ride on behalf of a caller); privileged commands: assign, reassign, cancel — these work under BOTH dispatch modes (auto_match and geozone_queue).
- Telephony: caller-ID lookup + click-to-dial land in Phase 2–3; build the order-entry form so a phone-number lookup can prefill it.
- Keyboard-first UX: a dispatcher on a call must be able to enter an order without touching the mouse.
- Organize by feature (Vertical Slice): `src/features/<name>/`.
- UI language: LV first (Dina's working language); keep strings in catalogs anyway.
- Tests: vitest + RTL (jsdom), co-located as `src/features/<name>/*.test.tsx`; run via `pnpm turbo run test --filter @taxi/dispatch` (a direct `pnpm --filter … test` needs a built `@taxi/shared`).
