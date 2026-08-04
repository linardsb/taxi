# @taxi/shared — contract seam

- This package imports **nothing** from the workspace. Apps and `services/api` import from here, never the reverse.
- Every cross-surface contract (zod schema, socket event name, enum, seam interface) lives here — if an app needs a type another surface also uses, it belongs in this package.
- Types derive from zod schemas via `z.infer` — never hand-write a twin type.
- Ride lifecycle: `ride-state-machine.ts` is the source of truth; consumers use `assertTransition()`, never a transition table of their own. See `.claude/references/ride-state-machine.md`.
- Money: integer cents, EUR; fields named `*Cents`. Payment lock: `isPaymentMethodLocked()`.
- Provider seam interfaces live in `src/seams/` — interface only, no SDK imports here.
- Every contract change ships with tests (`pnpm --filter @taxi/shared test`) and a check of all consumers.
