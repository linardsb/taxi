# PR #201 review fixes — round 1

**Review** `.claude/code-reviews/pr-201-review.md` · **fixed at** `8aba1d0` (on `8db2c3d`) · 2026-09-14

One file, `services/api/test/app.e2e-spec.ts`, docblock only. All three findings were wording; F1–F3 land in one rewrite.

## Per finding

**F1 · Medium · provenance** — fixed. The docblock now tags the mechanism `observed` (#200, PR #201) and names its real condition: "the app lives ~10 ms after the Redis TCP connect, so `app.close()` sends QUIT mid-handshake". The agent's prescribed wording ("6379 accepts the TCP connect but never answers INFO") was not applied: run before the report, the spec against taxi's own Redis on 6381 shows the same three timers and the same non-exit line (`DEBUG=ioredis:redis`, timestamps: `connect` .652–.655, `quit` .662–.666, `info` .666 or never). The "dumps went empty" sentence is gone; the PR body carries the t+0 / t+500 ms detail.
Grep: `grep -n "observed\|~10 ms" services/api/test/app.e2e-spec.ts` → lines 10–11.

**F2 · Low · accuracy** — fixed. "Not collected by the gate" → "Not run by the gate (lint and typecheck do see it)". Verified before editing: `services/api/package.json:15` lint globs `{src,test,scripts}/**/*.ts`; `tsconfig.json` has no `include`.
Grep: `grep -n "Not run by the gate" services/api/test/app.e2e-spec.ts` → line 17.

**F3 · Low · proportion** — fixed by the same rewrite: 18 lines of ioredis internals → 10 lines of why-the-harness, symptom, pointer to the PR body. `grep -c "disconnectTimeout\|recoverFromFatalError\|_getActiveHandles" services/api/test/app.e2e-spec.ts` → 0.

**N1 · FYI** — no change: `test:e2e` sharing `taxi_api_test` with the main suite is pre-existing and already covered by the one-gate-at-a-time rule.

## Closing commands

| command | result | provenance |
|---|---|---|
| `npx eslint test/app.e2e-spec.ts` | 0 problems | observed |
| `COMPOSE_PROJECT_NAME=taxi npx jest --config ./test/jest-e2e.json` ×2 at `8aba1d0` | 1 passed, exit 0, no non-exit line, wall 3.54 s / 3.00 s | observed |
| `record-gate.sh --clean` at `8aba1d0` | 22 successful, 22 total, exit 0, 1m24.477s; api 77 suites / 724 tests, same per-package counts as `8db2c3d` | observed, `.claude/last-gate.json` in wt-200 |
| `inherited-figures.sh <new body> <live body> --pr 201` | 3 hits, all per-package test counts; the `8aba1d0` gate record prints the same values | observed |

PR body updated: gate block now at `8aba1d0`, the `8db2c3d` result kept in parentheses, a "Review round 1" section added. Pushed; CI re-runs on the new head.
