#!/usr/bin/env bash
# audit-diff.sh — fail when HEAD's production dependency tree carries an
# advisory that the base's does not (#165, S2).
#
# The repo's `pnpm audit --prod` backlog is not zero and will not be for a
# while, so "audit must be clean" cannot be a gate: every PR would be red on
# day one and the job would be ignored by day two. The rule that CAN be a gate
# is the diff: a PR may not ADD an advisory id the base does not report.
# The backlog rides; growing it does not.
#
#   audit-diff.sh <base-ref>        # e.g. origin/main, or origin/$GITHUB_BASE_REF in CI
#   audit-diff.sh -h|--help
#
# Steps, in order:
#   1. Short-circuit. If pnpm-lock.yaml is byte-identical to the base's, exit 0
#      without auditing: both audits would ask the registry the same question
#      at the same moment. Two-dot diff, not three-dot: CI checkouts are
#      shallow and have no merge base, and HEAD in CI is the PR's merge ref.
#   2. Suppression guard. An added line naming an audit ignore list
#      (`ignoreGhsas`, `ignoreCves`, `audit.ignore`, a yaml `ignore:` key) or a
#      `registry=` in package.json, pnpm-workspace.yaml or .npmrc is red before
#      any audit runs. Without this a PR could add a vulnerable dependency and
#      its GHSA to the ignore list in one commit and read as green — or point
#      the head audit alone at a registry that reports less (see the guard).
#   3. Base audit, from the base's lockfile alone in a temp dir. No manifests,
#      no node_modules: pnpm 10's audit reads only the lockfile, and `--prod`
#      is decided from the lockfile's per-importer sections.
#   4. Head audit at the repo root.
#   5. Both outputs must be JSON with an `advisories` object. Anything else
#      (a registry error, a network failure) is RED, not green.
#   6. The ids at HEAD that are not in the base are printed, one line each,
#      and the script exits 1 if there are any.
#
# `pnpm audit` itself exits 1 whenever advisories exist, which is always here;
# that exit code is data and is ignored.
#
# Exit codes:
#   0  no new advisory, or the lockfile is unchanged vs the base
#   1  a new advisory; an audit ignore-list edit; audit output that is not JSON
#   2  usage, not a git repo, base ref not found, pnpm or jq missing
#
# What it does NOT catch:
#   - an advisory the base already carries (that is the backlog, by design);
#   - an advisory published between the base's run and this one for a package
#     both trees share (both audits see it; the diff is empty);
#   - a dev-only dependency (`--prod`), which never ships;
#   - a change that lowers a package's version to one with a DIFFERENT
#     advisory id the base also happens to carry through another path.
# Registry-side data is what it is on the day; a re-run can differ from a
# previous run without any commit in between.

set -uo pipefail

case "${1:-}" in
  -h|--help) awk 'NR>1 && /^#/ {print; next} NR>1 {exit}' "$0"; exit 0 ;;
  "") echo "usage: audit-diff.sh <base-ref>   (-h for the full header)" >&2; exit 2 ;;
esac
base=$1

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not a git repo" >&2; exit 2; }
cd "$root" || exit 2

for tool in pnpm jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "::error::$tool is not installed; audit-diff needs it (#165)"; exit 2; }
done

git rev-parse --verify -q "${base}^{commit}" >/dev/null \
  || { echo "::error::base ref '$base' not found; fetch it first (#165)"; exit 2; }

# 1. Short-circuit on an unchanged lockfile.
if git diff --quiet "$base" HEAD -- pnpm-lock.yaml; then
  echo "pnpm-lock.yaml unchanged vs $base; identical trees cannot differ in advisories"
  exit 0
fi

# 2. Suppression guard: an ignore list edited in this PR is red, not a fix.
#
# `registry=` is in the pattern for a reason the ignore keys make obvious only
# once stated: the base audit runs in a temp dir with no .npmrc and the head
# audit runs at the repo root with one, so an added registry line is asked of a
# DIFFERENT registry than the base was. A quieter registry reports fewer ids,
# the diff comes back empty and the job is green — a larger lever than any
# ignore list, and the asymmetry is structural to step 3 (#165, PR #167 F16).
SUPPRESSION_RE='^\+.*(ignoreGhsas|ignoreCves|audit\.ignore)|^\+\s+ignore:|^\+[^#]*registry\s*='
if git diff "$base" HEAD -- package.json pnpm-workspace.yaml .npmrc \
    | grep -E "$SUPPRESSION_RE" >/dev/null; then
  echo "::error::an audit ignore list or registry changed in this PR; that is a suppression, not a fix (#165)"
  git diff "$base" HEAD -- package.json pnpm-workspace.yaml .npmrc \
    | grep -nE "$SUPPRESSION_RE" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -r -- "$tmp"' EXIT
mkdir -p "$tmp/base"

# 3. Base audit from the base's lockfile alone.
git show "${base}:pnpm-lock.yaml" > "$tmp/base/pnpm-lock.yaml" \
  || { echo "::error::no pnpm-lock.yaml at $base (#165)"; exit 1; }
(cd "$tmp/base" && pnpm audit --prod --json > "$tmp/base.json" 2> "$tmp/base.err")

# 4. Head audit at the repo root.
pnpm audit --prod --json > "$tmp/head.json" 2> "$tmp/head.err"

# 5. Both must be JSON with an advisories object; anything else is red.
for side in base head; do
  if ! jq -e '.advisories | type == "object"' "$tmp/$side.json" >/dev/null 2>&1; then
    echo "::error::$side audit output is not JSON (registry error?); refusing to pass on no data (#165)"
    head -c 600 "$tmp/$side.err" "$tmp/$side.json" >&2
    exit 1
  fi
done

# 6. Ids at HEAD that the base does not report.
new_ids=$(comm -13 \
  <(jq -r '.advisories | keys[]' "$tmp/base.json" | sort) \
  <(jq -r '.advisories | keys[]' "$tmp/head.json" | sort))

base_n=$(jq '.advisories | length' "$tmp/base.json")
head_n=$(jq '.advisories | length' "$tmp/head.json")

if [ -z "$new_ids" ]; then
  echo "no new advisories vs $base ($base_n at base, $head_n at HEAD, none new)"
  exit 0
fi

new_n=$(printf '%s\n' "$new_ids" | wc -l | tr -d ' ')
echo "::error::$new_n advisory id(s) at HEAD that $base does not report ($base_n at base, $head_n at HEAD) (#165)"
for id in $new_ids; do
  jq -r --arg id "$id" \
    '.advisories[$id] | "  \(.github_advisory_id)  \(.severity)  \(.module_name)@\(.findings[0].version)  \(.title)"' \
    "$tmp/head.json"
done
exit 1
