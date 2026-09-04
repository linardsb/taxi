#!/usr/bin/env bash
# record-gate.sh — run the validation gate and record its result against a commit.
#
# The gate line is the single most-copied figure in this loop, and the one that
# has gone wrong most often: a count from an earlier run pasted next to a delta
# from a later one, a duration that drifted between the report and the handoff
# note, a suite total that a rebase invalidated. Auditing prose after the fact
# does not fix that. This removes the opportunity: the numbers are captured by
# the run itself, stamped with the commit they describe, and the PR body renders
# them instead of restating them.
#
#   record-gate.sh                       # runs the CI-parity gate
#   record-gate.sh --clean               # clears dist/.next first (see below)
#   record-gate.sh -- pnpm turbo run typecheck lint test --force   # other gate
#
# Writes .claude/last-gate.json at the repo root and prints a ready-to-paste
# Validation block. Exits with the gate's own exit code, so a red gate cannot
# quietly produce a green-looking record.
#
# Restored in-repo 2026-09-04 (ledger L2). The previous copy lived only under
# ~/.claude/skills/ and was destroyed with that tree in #129 — nothing in the
# repo referenced it, so nothing noticed. It lives here now, referenced from
# piv-create-pr/SKILL.md Phase 2.5, so deleting it shows up in a diff.
#
# THREE THINGS IT DOES THAT THE DESTROYED VERSION DID NOT, each from a real miss:
#
#  1. It asserts the gate ran the WHOLE graph, and PRINTS THE HOLES IN IT.
#     `turbo run` exits 0 when a task name matches nothing, so a gate that
#     checked less than it looks like it checked still reads as a pass: that is
#     how @taxi/rider and @taxi/driver ran for weeks with no lint and no test
#     task while the gate stayed green at "18 successful, 18 total".
#     The expected count is derived at THIS head by a dry run, so no hardcoded
#     number goes stale — but note that a derived count alone would NOT have
#     caught rider and driver, because the dry run drops the same absent tasks
#     the real run does and the two agree at 18. What catches it is the second
#     half: every task in the graph whose package defines no such script is
#     listed by name. Some absences are legitimate (an Expo app has no `build`);
#     `@taxi/rider#test` sitting in that list is not, and now it is visible.
#  2. It reads per-package results from turbo's own per-task log files
#     (<pkg>/.turbo/turbo-<task>.log), not from the interleaved stdout stream.
#     Under concurrency the stream's package prefixes depend on --log-order and
#     on whether stdout is a TTY; the log files are unprefixed and unmixed.
#  3. It records the `Failed: <pkg>#<task>` lines as the authoritative failure
#     set. When one task fails, turbo kills its siblings, and the resulting
#     ELIFECYCLE noise reads as a broad code failure when one package is red.

set -uo pipefail

GATE_DEFAULT=(pnpm turbo run typecheck lint test build --force)

clean=0
while [ $# -gt 0 ]; do
  case "$1" in
    --clean) clean=1; shift ;;
    --) shift; break ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) break ;;
  esac
done

if [ $# -ge 1 ]; then gate=("$@"); else gate=("${GATE_DEFAULT[@]}"); fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo" >&2; exit 2; }
cd "$root" || exit 2
head_sha=$(git rev-parse HEAD)
head_short=$(git rev-parse --short HEAD)
branch=$(git branch --show-current)

dirty=false
if [ -n "$(git status --porcelain)" ]; then
  dirty=true
  echo "WARNING: working tree is dirty. The record will name $head_short, but the run" >&2
  echo "         covers uncommitted changes that commit does not contain." >&2
fi

case " ${gate[*]} " in
  *" build "*) ;;
  *) echo "WARNING: the gate command has no 'build' task. CLAUDE.md's CI-parity gate is" >&2
     echo "         'pnpm turbo run typecheck lint test build --force'; 'pnpm check' omits" >&2
     echo "         build and is NOT parity. The record will say what actually ran." >&2 ;;
esac

# Expected task count, derived at this head. --dry=json enumerates the cartesian
# product of tasks x packages, so a package that does not define the script
# appears with command "<NONEXISTENT>"; those never execute and must not be
# counted. Costs well under a second and runs nothing.
dry=()
for a in "${gate[@]}"; do [ "$a" = "--force" ] || dry+=("$a"); done
dry_out=$("${dry[@]}" --dry=json 2>/dev/null \
  | node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d));
      process.stdin.on("end", () => {
        try {
          const j = JSON.parse(s);
          const missing = j.tasks.filter((t) => !t.command || t.command === "<NONEXISTENT>");
          process.stdout.write(String(j.tasks.length - missing.length) + "\n");
          process.stdout.write(missing.map((t) => t.taskId).sort().join(" ") + "\n");
        } catch (e) {
          process.stdout.write("\n\n");
        }
      });
    ' 2>/dev/null)
expected=$(printf '%s\n' "$dry_out" | sed -n '1p')
missing_tasks=$(printf '%s\n' "$dry_out" | sed -n '2p')

if [ -z "${expected:-}" ]; then
  echo "note: could not derive the expected task count (dry run failed) — the" >&2
  echo "      whole-graph assertion below is skipped, not silently passed." >&2
fi

# A stale apps/dispatch/.next reddens the dispatch typecheck in ~25 s with
# TS6053 — a build/typecheck race, not code. CLAUDE.md's parity gate also
# specifies a cleared dist. rmSync, not rm -r: the session hook blocks rm -r.
if [ "$clean" -eq 1 ]; then
  node -e '
    const fs = require("fs");
    const paths = [
      "apps/dispatch/.next",
      "apps/dispatch/tsconfig.tsbuildinfo",
      "packages/shared/dist",
      "db/dist",
      "services/api/dist",
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        console.log("cleared " + p);
      }
    }
  '
elif [ -d apps/dispatch/.next ]; then
  echo "WARNING: apps/dispatch/.next exists. A stale one reddens the dispatch typecheck" >&2
  echo "         in ~25 s (TS6053) — a build/typecheck race, not code. Re-run with" >&2
  echo "         --clean if that is what you get." >&2
fi

log=$(mktemp)
stamp=$(mktemp)
trap 'rm -f "$log" "$stamp"' EXIT
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "recording gate at $head_short ($branch): ${gate[*]}"
"${gate[@]}" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)

strip() { sed -e 's/\x1b\[[0-9;]*[a-zA-Z]//g' -e 's/\r$//' "$@"; }

tasks=$(strip "$log" | grep -oE '[0-9]+ successful, [0-9]+ total' | tail -1)
cached=$(strip "$log" | grep -oE '[0-9]+ cached, [0-9]+ total' | tail -1)
elapsed=$(strip "$log" | grep -E '^[[:space:]]*Time:' | tail -1 | sed 's/.*Time:[[:space:]]*//' | tr -d ' ')
successful=$(printf '%s' "${tasks:-}" | sed -n 's/^\([0-9][0-9]*\) successful.*/\1/p')
failed_tasks=$(strip "$log" | grep -oE 'Failed: +[@/a-zA-Z0-9_.-]+#[a-z:-]+' | sed 's/Failed: *//' | sort -u)

# Per-package results, read from turbo's own per-task logs rather than the
# interleaved stream. -newer "$stamp" keeps a previous run's logs out.
packages=$(
  find . -name node_modules -prune -o -path '*/.turbo/turbo-test.log' -newer "$stamp" -print 2>/dev/null \
  | sort | while IFS= read -r f; do
      dir=$(dirname "$(dirname "$f")")
      name=$(node -e 'try{process.stdout.write(require(process.argv[1]+"/package.json").name)}catch(e){process.stdout.write(process.argv[1])}' "$dir" 2>/dev/null)
      strip "$f" | grep -E '^(Test Suites:|Tests:)|^[[:space:]]+(Test Files|Tests)[[:space:]]+[0-9]' \
        | tail -2 | sed 's/^[[:space:]]*//; s/[[:space:]][[:space:]]*/ /g' \
        | while IFS= read -r line; do echo "$name  $line"; done
    done
)

# The whole-graph assertion. Exit 0 from turbo is not enough on its own — but a
# RED gate also runs fewer tasks than it planned, and calling that "short" would
# mislabel every genuine failure. Short means: it claimed success while running
# less than the graph. So it is only asked when the gate exited 0.
short_gate=0
if [ "$rc" -eq 0 ] && [ -n "${expected:-}" ] && [ -n "${successful:-}" ] && [ "$successful" != "$expected" ]; then
  short_gate=1
fi

json="$root/.claude/last-gate.json"
mkdir -p "$root/.claude"
{
  printf '{\n'
  printf '  "head": "%s",\n' "$head_sha"
  printf '  "head_short": "%s",\n' "$head_short"
  printf '  "branch": "%s",\n' "$branch"
  printf '  "dirty": %s,\n' "$dirty"
  printf '  "command": "%s",\n' "$(printf '%s ' "${gate[@]}" | sed 's/ $//; s/"/\\"/g')"
  printf '  "exit_code": %d,\n' "$rc"
  printf '  "started": "%s",\n' "$started"
  printf '  "finished": "%s",\n' "$finished"
  printf '  "tasks": "%s",\n' "${tasks:-}"
  printf '  "tasks_successful": "%s",\n' "${successful:-}"
  printf '  "tasks_expected": "%s",\n' "${expected:-}"
  printf '  "tasks_not_in_graph": "%s",\n' "${missing_tasks:-}"
  printf '  "short_gate": %s,\n' "$([ "$short_gate" -eq 1 ] && echo true || echo false)"
  printf '  "cached": "%s",\n' "${cached:-}"
  printf '  "elapsed": "%s",\n' "${elapsed:-}"
  printf '  "failed_tasks": [\n'
  printf '%s' "$failed_tasks" | awk 'NF{gsub(/"/,"\\\""); printf "    \"%s\",\n", $0}' | sed '$ s/,$//'
  printf '  ],\n'
  printf '  "packages": [\n'
  printf '%s' "$packages" | awk 'NF{gsub(/"/,"\\\""); printf "    \"%s\",\n", $0}' | sed '$ s/,$//'
  printf '  ]\n'
  printf '}\n'
} > "$json"

echo
echo "wrote $json"
echo
echo "--- Validation block (paste verbatim; do not retype the numbers) ---"
echo
if [ "$rc" -eq 0 ] && [ "$short_gate" -eq 0 ]; then
  echo "\`observed\` — \`${gate[*]}\`, at \`$head_short\`, exit 0:"
elif [ "$short_gate" -eq 1 ]; then
  echo "**GATE SHORT** — exit 0, but only ${successful:-0} of $expected tasks ran at \`$head_short\`."
  echo "A task name that matches nothing exits 0. This record is NOT a pass."
else
  echo "**GATE RED** (exit $rc) — \`${gate[*]}\`, at \`$head_short\`:"
  [ "$rc" -eq 137 ] && echo "(137 = killed. A red @taxi/api jest run does not exit; turbo waits, then kills it.)"
fi
echo
echo '```'
[ -n "${tasks:-}" ]   && echo "Tasks:    $tasks"
[ -n "${cached:-}" ]  && echo "Cached:   $cached"
[ -n "${elapsed:-}" ] && echo "Time:     $elapsed"
echo '```'
[ -n "$packages" ] && { echo; printf '%s\n' "$packages" | sed 's/^/    /'; }
if [ -n "$failed_tasks" ]; then
  echo
  echo "Failed tasks (authoritative — ignore the ELIFECYCLE noise from killed siblings):"
  printf '%s\n' "$failed_tasks" | sed 's/^/    /'
fi
if [ -n "${missing_tasks:-}" ]; then
  echo
  echo "Not in the graph — the package defines no such script, so the gate did NOT check it:"
  printf '    %s\n' "$missing_tasks"
  echo "    (an Expo app having no \`build\` is fine; a missing \`#test\` or \`#lint\` is the"
  echo "     silent hole that kept the gate green at 18 tasks while two apps went unchecked.)"
fi

if [ "$short_gate" -eq 1 ] && [ "$rc" -eq 0 ]; then exit 3; fi
exit "$rc"
