---
name: prime-app
description: Primes the agent with focused context for one Sakta Cab surface (rider, driver, dispatch, admin, api, or shared) instead of the whole monorepo. Use at session start when the work is scoped to a single app or service — cheaper and sharper than a full prime.
argument-hint: [rider|driver|dispatch|admin|api|shared]
---

# Prime App: Load One Surface

## Objective

Build focused understanding of a single monorepo surface. Load only what that surface needs — per CLAUDE.md: "Fresh session per phase; load only the surface you're working on."

**Target surface**: `$1`. If empty, ask which surface before proceeding.

| `$1` | Path |
|---|---|
| rider | `apps/rider` |
| driver | `apps/driver` |
| dispatch | `apps/dispatch` |
| admin | `apps/admin` |
| api | `services/api` |
| shared | `packages/shared` |

## Process

1. Read the root `CLAUDE.md` (hard rules) and the surface's own `CLAUDE.md` (or AGENTS.md) if present
2. Read the surface's `package.json` and list its `src/` structure (one level of slices)
3. Read the surface's entry point and any existing feature slices' `index.ts` public APIs
4. Read `packages/shared/src/index.ts` — the contract seam every surface imports
5. Load the on-demand references this surface touches:
   - **api** → `.claude/references/ride-state-machine.md`, `realtime-events.md`, `dispatch-strategies.md`
   - **rider / driver** → `.claude/references/realtime-events.md`
   - **dispatch** → `.claude/references/realtime-events.md`, `dispatch-strategies.md`
   - **shared** → `.claude/references/ride-state-machine.md`
   - **admin** → none by default
6. Check `git log -5 --oneline -- <path>` for recent activity on the surface

## Output

Produce a scannable summary:

- **Surface**: what it is and who uses it (Atis = driver app, Dina = dispatch console, Linards = admin)
- **Stack**: framework + key libraries as actually installed (verify versions in package.json — Expo/Next.js versions here are newer than training data)
- **Slices**: existing feature slices and their public APIs
- **Contracts**: what it imports from `@taxi/shared`; socket events it emits/consumes
- **Conventions**: surface-specific rules from its CLAUDE.md
- **State**: recent commits, anything in progress

Use bullet points. Keep it concise — this prime exists to be cheaper than the full one.
