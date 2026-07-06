@AGENTS.md

# admin — app-specific rules

The admin panel (Next.js): statistics, configuration, driver/vehicle verification, legal. Read the root `CLAUDE.md` first; contracts come from `@taxi/shared`.

- Statistics from the outline: orders accepted/rejected/duration by hour/day/month/year; per-geozone and per-driver views later.
- Config surfaces (never constants in code): commission %, dispatch mode per geozone, pricing model per category, city/geozone management.
- Driver onboarding review: documents, licence, car photos — approval gates a driver's first shift.
- Organize by feature (Vertical Slice): `src/features/<name>/`.
