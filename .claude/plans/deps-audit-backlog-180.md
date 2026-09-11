# Plan — work down the `pnpm audit --prod` backlog (#180)

`audit-diff` (#165) gates the **diff**, not the level: a PR may not add an advisory id the
base does not report. Removing ids is always green. So this chore is a sequence of
independent PRs off `main`, each one dependency family, each proved by
`.github/scripts/audit-diff.sh origin/main` before it is pushed.

Figures carry provenance per the root `CLAUDE.md` rule: `observed` (a run produced it —
named), `derived` (arithmetic shown), `expected` (not yet run). **Registry data drifts
between runs** — the script's own header says so — so every count below is dated, not a
constant.

## Baseline

| Figure | Value | Provenance |
|---|---|---|
| Backlog at `main` (`6819d25`) | 66 ids over 1,013 production dependencies; 2 critical, 46 high, 17 moderate, 1 low | `observed` 2026-09-11, `pnpm audit --prod --json` at the main checkout, whose lockfile is byte-identical to `origin/main`'s. Matches the 66 recorded at `6d72261` (runbook §2 row 1) — the lockfile has not moved since. |
| `audit-diff` base side reads 66 | `66 at base` | `observed` 2026-09-11, every `audit-diff` run of step A1. This is the loop's sanity check: the base audit runs in a temp dir with no `.npmrc`, the head audit at the repo root with one, and a divergence there would make every diff in this chore suspect. It does not diverge. |

Where the 66 enter the production tree (`observed`, path prefixes, ids counted per path so
the column sums above 66 — `js-yaml` and `brace-expansion` arrive twice):

| Root | Path hits |
|---|---|
| `apps__driver>expo` | 34 |
| `apps__dispatch>next` | 20 |
| `services__api>@nestjs/platform-express` | 7 |
| `apps__driver>expo-router` | 6 |
| `db>drizzle-orm` | 1 |

## Mechanism, in preference order

1. **Direct manifest bump** — the dependency is ours. A1, A3.
2. **Parent-package bump** — the parent's newer release already pins a fixed child.
3. **`pnpm.overrides`** in the root `package.json` — the parent pins an exact vulnerable
   version and has no release that moves it. A2, A4.

An override is **not** a suppression: it changes the resolved version, so the advisory
leaves the tree for real, and the id disappears from `pnpm audit` because the vulnerable
code is gone. The guard in `audit-diff.sh` matches `ignoreGhsas`, `ignoreCves`,
`audit.ignore`, a yaml `ignore:` key and `registry=` — none of which an override is. Say
this in the PR body regardless; a reviewer seeing `pnpm.overrides` grow will ask. The root
`package.json` already carries two (`react`, `react-dom`), so the mechanism is in use.

## Steps

Each step: edit → `pnpm install` → commit → `.github/scripts/audit-diff.sh origin/main` →
read `base_n`/`head_n` and any new id → `pnpm turbo run typecheck lint test build --force`
→ PR off `main`. No stacking: five independent PRs, nothing to retarget.

### A1 — `next` 16.2.10 → 16.3.4 (`apps/dispatch`)

Both criticals live here (`GHSA-p293-qw3h-jr36`, `GHSA-2xp9-vwfh-vxw4`, Next.js
unauthenticated RCE, patched `>=16.3.3`). `next` is pinned exact, so `eslint-config-next`
moves in lockstep.

| Figure | Value | Provenance |
|---|---|---|
| 66 → 51, none new | 15 ids removed: 2 critical, 7 high, 6 moderate | `observed` 2026-09-11 on this branch, `audit-diff.sh origin/main`, exit 0. The head-stamped run and its wall time are in the PR body; a SHA is not repeated here because amending this file would invalidate it. |
| Ids beyond `next`'s own 11 | `sharp` 0.34.5 → 0.35.4 (2 high), `postcss` 8.4.31 → 8.5.23 (1 high, 1 moderate) | `derived` from the removed-id list: 15 removed − 11 `next` ids = 4, all under `next`'s subtree |

`build` in the gate is genuine verification for this one: the Next build compiles the app.

### A2 — `multer` → 2.3.0 via override (`services/api`)

`@nestjs/platform-express@11.1.27` pins `multer: 2.1.1` **exactly**, and `@latest` (12.0.1,
a NestJS major across the whole `@nestjs/*` family) pins `2.2.0` — still short of the
`>=2.3.0` three of the five ids need (`observed` 2026-09-11, `npm view`). So the parent
bump does not clear it and is a major besides. Override to `2.3.0` (npm latest).

Clears 5 ids: 3 high, 1 moderate, 1 low. `expected` — 51 → 46.

`qs` 6.15.3 → 6.16.0 (2 moderate, via `express`) rides in the same PR: same root, same
override mechanism, one dependency family.

### A3 — `drizzle-orm` 0.44.7 → 0.45.2

`GHSA-gpj5-g38j-94v9`, high: SQL injection via improperly escaped SQL identifiers. Declared
**twice** — `db` (`^0.44.0`) and `services/api` (`^0.44.7`) — and both must move together or
the tree carries two copies. 0.45.2 is npm latest stable (`observed` 2026-09-11; 1.0.0-rc.5
exists and is not a candidate).

Identifier escaping is the raw-SQL/PostGIS surface, so this one is validated by the full
`db` + `@taxi/api` suites, not by typecheck. Pre-1.0 drizzle minors have carried breaking
changes; read the release notes before assuming the gate is the whole story.

Clears 1 id: 1 high. `expected` — 46 → 45.

### A4 — the Expo tooling leaves, via overrides (`apps/driver`, `apps/rider`)

34 path hits, near-all build-time tooling reached through `expo`: `@expo/cli`,
`@expo/config-plugins`, `xcode`, `metro`, `@expo/xcpretty`. **Not an SDK bump** — the pins
in both apps (typescript `~5.9`, eslint `^9`) exist because TS 6 splits typescript-eslint's
peer instances and turns shared's type-aware lint red in untouched files, and SDK 57's iOS
build does not compile on this machine anyway. Overrides on the leaves:

| Leaf | Now | To | Ids |
|---|---|---|---|
| `@xmldom/xmldom` (via `@expo/plist`) | 0.8.13 | 0.8.15 | part of 23 |
| `@xmldom/xmldom` (via `plist`) | 0.9.10 | 0.9.12 | part of 23 |
| `brace-expansion` | 1.1.15 / 5.0.7 | 1.1.18 / 5.0.9 | 5 high |
| `js-yaml` | 3.15.0 / 4.3.0 | 3.15.2 / 4.3.2 | 4 high |
| `browserslist` | 4.28.5 | 4.28.9 | 2 high |
| `nanoid` | 3.3.15 | 3.3.19 | 2 high |
| `postcss` (via `@expo/metro-config`) | 8.5.16 | 8.5.28 | 1 high, 1 moderate |
| `uuid` (via `xcode`) | 7.0.3 | 11.1.1+ | 1 moderate — major jump, verify `xcode` still resolves |
| `baseline-browser-mapping` | 2.10.42 | 2.11.0+ | 1 moderate |

Every target version exists on npm (`observed` 2026-09-11, `npm view <pkg> versions`).

**Coverage here is weaker than A1–A3 and the PR body must say so.** The gate runs
`jest-expo`, not `expo prebuild`; `@expo/plist`, `xcode` and `@expo/xcpretty` are exercised
by the native build, which CI does not run. `uuid@7 → 11` is defensible on inspection —
`xcode@3.0.1` does `require('uuid').v4()` and uuid 11 still ships a CJS entry under its
`exports` `node.require` condition (`observed` 2026-09-11) — but nothing in CI exercises it,
and the PR body must say that rather than let a green gate imply otherwise. Split A4 if a
leaf goes red.

**Before writing A4, prove the override selector forms empirically.** Two are needed and
neither is yet observed: parent-scoped (`"@expo/plist>@xmldom/xmldom"` beside
`"plist>@xmldom/xmldom"`, since the two parents need different majors) and the version
selector (`"brace-expansion@1"` / `"@5"`, `"js-yaml@3"` / `"@4"`, `"nanoid@3"`). pnpm matches
the selector against the **declared range**, not the resolved version, so a selector can
silently match nothing. Add them, install, grep the lockfile for the resolved versions, and
fall back to parent-scoped keys — enumerable from the lockfile the way the xmldom parents
were — if the version selector does not bind. One install; a red gate costs far more.

### A5 — the residue, and why it stays

`image-size@1.2.1` carries two **high** ids (`GHSA-w3rx-r6r6-pgpr`, `GHSA-5p2g-fcmc-qvqq`,
cvss 7.5, ICNS/JXL/HEIF parser infinite loops). `vulnerable_versions` is `<=2.0.2`,
`patched_versions` is `<0.0.0`, and npm latest is 2.0.2 — **no released version fixes
either**. Its only path is `expo>…>metro@0.87.0>image-size`, and `metro@latest` is 0.87.0
and still declares `image-size: ^1.0.2` (`observed` 2026-09-11, `npm view metro@latest
dependencies.image-size`). So no bump anywhere in the chain clears it.

This is the runbook §1 case the issue itself describes: the human **Ready for review**
button plus a line in the PR body naming the GHSA and why it does not apply. Why it does
not apply here: `image-size` runs at bundle time inside Metro, sizing local asset files
that ship in the repo. Nothing attacker-supplied reaches it.

`decode-uri-component@0.2.2` carries one moderate id (`GHSA-vcc3-ghjq-m6fr`) and is **not**
attempted. Its only fixed release, 0.5.0, is `"type": "module"` with no CJS condition in its
`exports`, and its only consumer here is `query-string@7.1.3`, which is CJS (`observed`
2026-09-11, `npm view decode-uri-component@0.5.0 type exports` and the installed
`query-string` manifest). `query-string@8`+ is ESM-only too, so the parent bump does not help
either. The only thing that would exercise the override is a Metro bundle, which the gate
never builds — a green gate would say nothing about whether `expo-router`'s query parsing
still works. One moderate id is not worth a change nothing here can verify.

The `js-yaml` and `brace-expansion` ids arriving via `expo-router` are a second artefact
worth recording even after A4 removes them: `@testing-library/react-native` is a
**peerDependency** of `expo-router`, satisfied from each app's `devDependencies`, so pnpm's
`--prod` walk pulls jest's whole tree into the production graph. RNTL never ships in a
built app.

## Done when

The issue's criterion — "0 critical and 0 high" — is **not reachable by bumping**, because
of `image-size` above. Read it as: **0 critical, and 0 high that any released version
clears**, with the remainder listed in the runbook §2 backlog row with its reason. State
this on #180 rather than leaving a criterion nothing can satisfy.

`derived`, assuming every step lands and the registry does not move: 66 − 15 (A1) − 7 (A2)
− 1 (A3) − A4's leaves = **3** — the two `image-size` highs plus the `decode-uri-component`
moderate above. A4's own figure is deliberately left unstated here: it is the one step whose
mechanism is unproven, and the count must come from the audit at A4's head, not from this
line. `inherited-figures.sh` will flag any of these that reach a PR body; re-derive rather
than copy.

Last step: update runbook §2's backlog row to the new count and add the residue row.
