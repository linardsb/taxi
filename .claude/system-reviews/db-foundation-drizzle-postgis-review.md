# System Review — DB foundation (Drizzle + PostGIS + Rīga seed)

## Meta Information

- **Plan reviewed**: `.claude/plans/db-foundation-drizzle-postgis.md`
- **Execution report**: `.claude/execution-reports/db-foundation-drizzle-postgis.md`
- **Plan skill**: `.claude/skills/piv-plan-implementation/SKILL.md`
- **Execute skill**: `.claude/skills/piv-implement/SKILL.md`
- **Date**: 2026-08-04
- **Ticket**: #6 · PR #32 (approved, merged path)

## Overall Alignment Score: 9/10

13/13 plan tasks completed, nothing skipped, all acceptance criteria met, `pnpm check` green from a wiped volume. All four divergences were justified and documented with reasons at implementation time — the review round confirmed the documented deviations rather than discovering undocumented ones, which is exactly what the PIV loop is designed to produce. One point withheld because two divergences trace to plan assumptions that were checkable at plan time (turbo strict env mode; drizzle's error wrapping), and the code review surfaced three schema-quality gaps the plan could have specified.

## Divergence Analysis

```yaml
divergence: pretest docker scope narrowed
planned: "pretest: docker compose up -d --wait (full stack)"
actual: "docker compose up -d --wait db"
reason: redis --wait fails on this machine (SSH tunnel squats 6379); db tests never touch redis
classification: good ✅
justified: yes
root_cause: machine-specific environment; strictly narrower, identical behavior on clean machines
```

```yaml
divergence: turbo.json gained globalEnv DATABASE_URL
planned: "zero turbo.json changes needed" (plan NOTES)
actual: "globalEnv: [\"DATABASE_URL\"] added"
reason: turbo 2.x strict env mode strips undeclared vars; vitest silently fell back to the localhost default under pnpm check
classification: good ✅ (the fix) — but the plan assumption was wrong
justified: yes
root_cause: missing plan-time check — turbo's env passlist was never inspected even though the plan wired an env-var-reading test suite into turbo tasks. Worst-case failure mode (tests silently pass against the wrong DB).
```

```yaml
divergence: enum-rejection test asserts on error.cause
planned: "rejects.toThrow(/invalid input value/)"
actual: unwrap DrizzleQueryError, assert on cause
reason: drizzle 0.44 wraps driver errors; the message is not on the thrown error
classification: good ✅
justified: yes
root_cause: plan specified an assertion shape for a library error without verifying the library's error-wrapping behavior — a Phase 3 (external research) gap
```

```yaml
divergence: pgEnum readonly-tuple fallback unused
planned: typed-assertion fallback if drizzle rejects as-const arrays
actual: direct usage worked
classification: good ✅
justified: yes
root_cause: none — conservative insurance, zero cost when unneeded. This is the pattern to keep: pre-written deterministic fallbacks prevent debugging spirals.
```

**Post-plan additions** (unplanned work, not divergences): review-fix migration 0002 (`NULLS NOT DISTINCT` ledger index, `$onUpdate` timestamps, composite offer index, `polygonToEwkt` guard), CI TCP-healthcheck fix, lint fix. The first of these is the interesting one — three of the review findings were **plan-inherited schema gaps**, meaning the plan's schema spec (Tasks 5–7, highly detailed column-by-column) still missed nullable-unique NULL semantics, mutable-row timestamp updates, and a hot-path index.

## Pattern Compliance

- [x] Followed codebase architecture — root `db/` workspace package per skeleton §4; shared-imports-nothing preserved
- [x] Used documented patterns — enums single-sourced from `@taxi/shared`, integer cents everywhere, config-not-constant commission (no DB default), package shape mirrors `packages/shared`
- [x] Applied testing patterns — 1+1+1 naming, colocated tests, live-PostGIS integration by design; the self-extending `information_schema` money sweep exceeds the standard
- [x] Met validation requirements — every task's VALIDATE ran; full gate from wiped volume; migrations + seed proven idempotent

## What the Plan Did Unusually Well (patterns to keep)

1. **Pre-run SQL verification greps with exact expected lines** (Task 8) — all three passed mechanically; the risky drizzle-kit/customType interaction never became a debugging session.
2. **Deterministic fallbacks written into the plan** (GIST-index custom migration; pgEnum type assertion) — insurance that costs nothing when unused.
3. **Pre-empted wrong test design** (Task 11 GOTCHA: Postgres rounds, doesn't reject, floats) — a subtle trap the implementer would plausibly have fallen into.
4. **Risk register with closures** — every identified risk had a mitigation and a location.

## System Improvement Actions

**Update Plan Skill (`.claude/skills/piv-plan-implementation/SKILL.md`):** — *applied, see below*

- [x] Add to Phase 2 (Codebase Intelligence): when the plan wires new tasks/tests into a monorepo task runner, inspect the runner's env-var passlist (turbo 2.x `globalEnv` / per-task `env`) for every env var the new code reads — strict mode strips undeclared vars **silently**, and the failure mode is tests passing against the wrong target.
- [x] Add a DB-ticket schema checklist to Phase 4 (Deep Strategic Thinking) covering the three plan-inherited review findings: unique indexes over nullable columns (`NULLS NOT DISTINCT` or partial index?), `updated_at` behavior on mutable rows (`$onUpdate`), an index for each known hot read path, and ORM error-wrapping shape for any constraint-rejection test (drizzle → `DrizzleQueryError.cause`).

**Update Execute Skill (`.claude/skills/piv-implement/SKILL.md`):**

- [ ] No change. The deviation-documentation discipline worked exactly as designed — the review confirmed intent instead of re-litigating it. Deliberately not adding a CI-parity step here (one-off finding; noted below for piv-validate instead, but not applied — one occurrence isn't a pattern yet).

**Update CLAUDE.md:**

- [ ] None. Concur with the execution report: the port conflict is machine-specific (already in auto-memory), and money/enum/config rules already exist and were verified enforced. A schema checklist belongs in the plan skill, not the global rules.

**Create New Skill:**

- [ ] None warranted. No manual process repeated 3+ times.

**Deferred (log only, act if it recurs):**

- `piv-validate` CI-parity note: compose healthchecks and CI service-container healthchecks differ (socket vs TCP readiness on cold volumes). One occurrence — revisit if another CI-only cold-start failure appears.

## Key Learnings

**What worked well:**

- Exact-expectation verification steps and pre-written fallbacks turned the plan's two riskiest interactions (drizzle-kit customType SQL, pgEnum typing) into non-events.
- Documented deviations → trivial review round-trip. The report-as-reviewer-signal loop is functioning.
- Highly specific column-by-column task specs enabled genuine one-pass implementation.

**What needs improvement:**

- The plan asserted "zero turbo.json changes needed" without checking turbo's env semantics — plan-time claims about infrastructure config should be verified, not inferred.
- External-research phase specified a test assertion shape against a library error without checking how that library surfaces errors.
- Detailed schema specs still benefit from a generic quality checklist (nullable-unique, timestamps, hot-path indexes) — detail ≠ completeness.

**For next implementation (#7 auth/gateway is the direct consumer):**

- #7 adds env-driven config to `services/api` — the turbo `globalEnv` lesson applies immediately; check the passlist in the plan.
- Reuse the "exact expected output + deterministic fallback" pattern for the NestJS/Socket.IO wiring risks.
- The deferred review finding (unindexed `ledger_entries.ride_id`, `dispatch_audit_log.driver_id` FKs) is owned by #12/#10 — carry it into those plans' Related Work.
