# PR #82 review — refactor(api): split dispatch.service.ts along its natural seams (#69)

**Verdict: APPROVE** · 0 Critical · 0 High · 0 Medium · 1 Low

Fresh-context review at head `9c1af46`, run from an isolated worktree (the main checkout was in use by another session). Deep pass by the code-reviewer agent; movement claim verified mechanically.

## Summary

Three files where there was one: `force-assign.service.ts` (168), `dispatch-notifier.ts` (109), and a `dispatch.service.ts` down to under the ~500-line guideline. The "pure code movement" claim **holds**: `git diff --color-moved` against `main` shows every non-moved line is scaffolding — imports, class/constructor declarations, `this.emitOffer(...)` → `this.notifier.emitOffer(...)` call sites, and one doc-comment tweak. No logic line is new or altered.

## Issues

### Low

1. **`services/api/src/features/dispatch/force-assign.service.ts` — no dedicated unit spec.** Force-assign is covered only by the integration suite (`dispatch.integration.spec.ts:421` mid-cascade, `:485` offline driver, `:529` 409 on accepted, `:845` role refusal). Not a regression — the pre-split unit spec never exercised `forceAssign` either, and the integration suite boots the real module graph. But the split created a cheap seam: a thin `force-assign.service.spec.ts` reusing the DispatchService spec's mock kit would pin the `requested → offered → accepted` two-hop walk, the `from`-status bookkeeping, and the two 409 codes at unit speed. Optional follow-up; fine to land as-is.

## Notes (no action needed)

- PR body says the emit tail was "one of the three seams the issue named" — #69 actually named the offer cascade, the sweeper entry points, and force-assign. The extraction itself is well-motivated (both assignment paths share `emitAssigned`); only the description overstates.
- #69 said "not worth a standalone refactor PR"; the PR body documents why it exists anyway (explicit backlog-clearing ask). Documented deviation, not a finding.
- No implementation report exists for this branch; reviewed against #69 and the PR body instead.

## Verification detail

- **No leftover cruft**: `dispatch.service.ts` still uses every dep it injects (`realtime` and `RT` in `raiseUnclaimed`/`expireOffer`); `NotFoundException`, `AssignmentSource`, `RideOffer`, `RevokedRef` correctly dropped from its imports.
- **DI wiring**: spec's `new DispatchNotifier(realtime, transitions)` matches the constructor; the 14-arg `DispatchService` construction matches the class exactly; module registers both providers without exporting them.
- **Slice API sealed**: `index.ts` untouched; zero references to `ForceAssignService`/`DispatchNotifier` outside `features/dispatch/`.
- **State machine intact**: status moves only via `transitions.transitionInTx`; `rides.assignDriver` writes only `driver_id`.
- **Log contract byte-identical**: `dispatch.offer.notify_failed`, `dispatch.assign.join_failed`, `dispatch.assign.notify_failed`, `dispatch.assign.forced`, `dispatch.offer.sent`; each class carries its own `Logger` context.
- **No ordering drift**: `offerNext` still emits status before the offer; `accept` passes the same six args; all emits remain strictly post-commit; try/catch boundaries unchanged.

## Validation

| Check | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` | ✅ 20/20 tasks (45.7s, no cache) |
| `@taxi/api` tests (Redis suites enabled via `REDIS_TEST_URL`) | ✅ 382/382, 48 suites — matches the PR's claim |
| Branch head vs remote | ✅ both at `9c1af46` |

(A first gate attempt failed on a port collision — the review worktree's directory name spawned a second compose project against the same 5432. Reviewer-environment artifact, pinned with `COMPOSE_PROJECT_NAME=taxi`; not the PR.)

## What's good

- The spec wires the **real** `DispatchNotifier` over the same mocks instead of mocking it away, so every pre-existing emit/ordering assertion still observes actual behavior through the new seam — the refactor is proven equivalent by tests that didn't have to change their assertions.
- Import hygiene after the extraction is exact in all three files.
- The never-throws post-commit tail is now a class whose docblock *is* the invariant, and force-assign's "privileged command, not a strategy" placement is stated on the class itself.
- Encapsulation preserved: new providers are module-internal; the module still exports only `DispatchService`, `DispatchSweeper`, and the queue token.

## Recommendation

Merge. The one Low is an optional follow-up — a thin `ForceAssignService` unit spec — worth folding into the next dispatch ticket rather than blocking this.
