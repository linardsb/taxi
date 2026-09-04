#!/usr/bin/env bash
# inherited-figures.sh — find MEASUREMENTS a surface inherited rather than re-derived.
#
# The defect this exists for: a number is copied plan -> report -> PR body ->
# handoff prompt and re-derived at none of them. Provenance labels do not catch
# it; the label is usually present and simply names a run that is no longer the
# current one. What discriminates it is head-relative staleness — the same digits
# survive unchanged while the commit they describe moves.
#
#   inherited-figures.sh <new-surface> <prior-surface> [<prior-surface>...]
#   inherited-figures.sh <draft-body> --pr 150        # adds the PR's published body
#
# Scope is deliberately narrow. It matches a number ONLY when bound to a
# measurement word (passed/failed/skipped/suites/files/lines/s/ms/queries/rows/…),
# so issue references, dates, phase numbers and session ids do not drown the
# signal. An earlier draft matched every 2+ digit number and produced 29 hits on
# a real PR body, nearly all noise — a check people switch off is worth nothing.
#
# Exits 1 if any inherited measurement is found. They are not necessarily wrong;
# they are UNAUDITED. Re-derive each at the current head, or say why it is
# head-independent.
#
# What this does NOT catch, stated so it is not oversold: a correct number under
# a wrong label (#87), a correctly-derived counterfactual printed as Observed
# (#107), or a prose claim with no numeral in it at all (2026-08-18's "GitHub
# retargets automatically"). It catches the copying, which is the mechanism the
# numeric instances shared. For the gate line specifically, prefer record-gate.sh,
# which removes the opportunity instead of auditing it.
#
# Restored in-repo 2026-09-04 (ledger L2), with two changes to the destroyed
# version: --pr fetches the published body (the surface that is NOT in the
# working tree, and the one #121's retired claim survived on), and a missing
# prior surface is a printed note and exit 0 rather than a usage error — a
# docs-only PR has no implementation report, and a check that errors on the
# ordinary case gets removed from the skill that calls it.

set -uo pipefail

usage() { echo "usage: $(basename "$0") <new-surface> [<prior-surface>...] [--pr <N>]" >&2; }

new=""
pr=""
priors=()
while [ $# -gt 0 ]; do
  case "$1" in
    --pr) pr=${2:-}; shift 2 || { usage; exit 2; } ;;
    -h|--help) usage; exit 0 ;;
    *) if [ -z "$new" ]; then new=$1; else priors+=("$1"); fi; shift ;;
  esac
done

[ -n "$new" ] || { usage; exit 2; }
[ -r "$new" ] || { echo "cannot read $new" >&2; exit 2; }

tmpdir=$(mktemp -d)
trap 'rm -f "$tmpdir"/* 2>/dev/null; rmdir "$tmpdir" 2>/dev/null' EXIT

if [ -n "$pr" ]; then
  body="$tmpdir/pr-$pr-body.md"
  if gh pr view "$pr" --json body -q '.body' > "$body" 2>/dev/null && [ -s "$body" ]; then
    priors+=("$body")
    echo "note: added PR #$pr's published body as a prior surface ($(wc -l < "$body" | tr -d ' ') lines)."
  else
    echo "note: could not fetch PR #$pr's body (gh not authenticated, or no such PR)." >&2
    echo "      Continuing without it — the published body is UNCHECKED." >&2
  fi
fi

UNITS='passed|failed|skipped|total|suites?|files?|tests?|cases|lines|queries|rows|frames|successful|cached'

# number + measurement word, or a bare duration (58.724s, 1m0.33s, 250 ms).
extract() {
  {
    grep -oiE "[0-9][0-9.,]*[[:space:]]*(${UNITS})" "$1" 2>/dev/null
    grep -oiE '[0-9][0-9.]*[[:space:]]*(ms|s)\b' "$1" 2>/dev/null
  } | tr -s ' ' ' ' | tr 'A-Z' 'a-z' | sed 's/[[:space:]]*$//' | sort -u
}

prior_all="$tmpdir/prior_all"
: > "$prior_all"
readable=0
for p in "${priors[@]+"${priors[@]}"}"; do
  if [ -r "$p" ]; then extract "$p" >> "$prior_all"; readable=$((readable + 1))
  else echo "note: skipping unreadable prior surface $p" >&2; fi
done

if [ "$readable" -eq 0 ]; then
  echo "NOTE — no readable prior surface, so nothing can be compared."
  echo "This is the ordinary case for a docs-only PR with no implementation report."
  echo "It is NOT a pass: every figure in $(basename "$new") is still unaudited, and"
  echo "the by-eye checks (a right number under a wrong label, a claim with no"
  echo "numeral) are the only ones that apply here."
  exit 0
fi

sort -u -o "$prior_all" "$prior_all"
carried=$(extract "$new" | grep -Fxf "$prior_all" 2>/dev/null || true)

if [ -z "$carried" ]; then
  echo "PASS — no measurement in $(basename "$new") also appears in the prior surface(s)."
  exit 0
fi

count=$(printf '%s\n' "$carried" | grep -c .)
echo "INHERITED MEASUREMENTS: $count in $(basename "$new"), each also present in a prior surface."
echo "Re-derive each at the current head, or state why it is head-independent."
echo
while IFS= read -r fig; do
  [ -n "$fig" ] || continue
  echo "  \"$fig\""
  grep -niF "$fig" "$new" | head -2 | cut -c1-160 | sed 's/^/      /'
done <<< "$carried"

echo
if head_sha=$(git rev-parse --short HEAD 2>/dev/null); then
  if grep -qF "$head_sha" "$new"; then
    echo "Surface names the current head ($head_sha) — confirm the figures above came from a run AT it."
  else
    echo "WARNING: surface does not name the current head ($head_sha). Any figure quoted from a"
    echo "named run describes a different tree than the one being shipped."
  fi
fi

exit 1
