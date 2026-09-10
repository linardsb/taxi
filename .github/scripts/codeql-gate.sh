#!/usr/bin/env bash
# codeql-gate.sh — fail when the PR's CodeQL analysis has an open alert at the
# gate's severity that the base branch's analysis does not (#165).
#
# Why a script: `github/codeql-action/analyze` never fails on findings. It
# uploads a SARIF and GitHub adds a separate "Code scanning results" check
# run to the PR; that check is not a job in ci.yml, so `ready.needs` cannot
# see it. This job reads the alerts GitHub produced from that upload (the
# analyze step waits for processing before it returns) and turns them into
# an exit code the `ready` job depends on.
#
# The rule is the audit-diff rule applied to CodeQL: the PR may not ADD an
# alert at the gate's severity that the base does not carry. The backlog
# rides. A dismissed alert is not open and never counts, so a human's
# dismissal in the GitHub UI (with a reason) is honoured; the hook refuses
# that dismissal from a Claude session.
#
#   codeql-gate.sh --pr N --base BRANCH               # CI: GH_TOKEN + GITHUB_REPOSITORY set
#   codeql-gate.sh --pr N --base BRANCH --repo o/r    # locally, with `gh auth`
#   codeql-gate.sh --pr-alerts f.json --base-alerts f.json   # offline, fixture JSON arrays
#   codeql-gate.sh -h|--help
#
# Gate severity: rule.security_severity_level in {high, critical} (GitHub's
# mapping of security-severity 7.0 and above) OR rule.severity == "error".
# Alerts are matched by their number, which is one entity across refs.
#
# Exit codes:
#   0  no new alert at the gate's severity (zero alerts is a valid answer and says so)
#   1  at least one new alert; or the PR ref has no analysis (red, not green)
#   2  usage, gh or jq missing, an API error other than "no analysis found"
#
# A base with NO analysis yet (404 "no analysis found") counts as an empty
# base: every open alert on the PR at the gate's severity is new, with a
# warning. That is the state on the first PR after this job lands, until a
# push to main has been analysed; the human bypass in docs/runbooks/pr-gate.md
# §1 is the path for that one PR.
#
# What it does NOT catch: anything CodeQL does not query for (the default
# suite is security-only, high precision; `queries: security-extended` in
# ci.yml widens it); an alert below the gate's severity; an alert on the base
# that GitHub tracks as the same alert after the PR moved it.

set -uo pipefail

pr=""; base=""; repo="${GITHUB_REPOSITORY:-}"; pr_file=""; base_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) awk 'NR>1 && /^#/ {print; next} NR>1 {exit}' "$0"; exit 0 ;;
    --pr) pr=${2:-}; shift 2 ;;
    --base) base=${2:-}; shift 2 ;;
    --repo) repo=${2:-}; shift 2 ;;
    --pr-alerts) pr_file=${2:-}; shift 2 ;;
    --base-alerts) base_file=${2:-}; shift 2 ;;
    *) echo "unknown argument: $1 (-h for the header)" >&2; exit 2 ;;
  esac
done
command -v jq >/dev/null 2>&1 || { echo "::error::jq is not installed; codeql-gate needs it (#165)"; exit 2; }

offline=0
if [ -n "$pr_file" ] || [ -n "$base_file" ]; then
  offline=1
  [ -n "$pr_file" ] && [ -n "$base_file" ] || { echo "usage: --pr-alerts and --base-alerts go together" >&2; exit 2; }
else
  [ -n "$pr" ] && [ -n "$base" ] || { echo "usage: codeql-gate.sh --pr N --base BRANCH [--repo o/r]   (-h for the header)" >&2; exit 2; }
  [ -n "$repo" ] || { echo "usage: --repo o/r (GITHUB_REPOSITORY is unset)" >&2; exit 2; }
  command -v gh >/dev/null 2>&1 || { echo "::error::gh is not installed; codeql-gate needs it (#165)"; exit 2; }
fi

# fetch <ref> → JSON array of open alerts on stdout.
# Returns 44 when GitHub answers "no analysis found" for that ref.
fetch() {
  local ref=$1 out rc
  out=$(gh api --paginate "repos/$repo/code-scanning/alerts?ref=$ref&state=open&per_page=100" 2>&1); rc=$?
  if [ "$rc" -ne 0 ]; then
    if printf '%s' "$out" | grep -q 'no analysis found'; then return 44; fi
    printf '%s\n' "$out" >&2; return 1
  fi
  printf '%s' "$out" | jq -s 'add // []'
}

if [ "$offline" -eq 1 ]; then
  pr_json=$(jq '.' "$pr_file") || { echo "::error::$pr_file is not JSON (#165)"; exit 2; }
  base_json=$(jq '.' "$base_file") || { echo "::error::$base_file is not JSON (#165)"; exit 2; }
  for f in "$pr_file" "$base_file"; do
    jq -e 'type == "array"' "$f" >/dev/null 2>&1 || { echo "::error::$f is not a JSON array of alerts (#165)"; exit 2; }
  done
  pr_ref="(fixture $pr_file)"; base_ref="(fixture $base_file)"
else
  pr_ref="refs/pull/$pr/merge"; base_ref="refs/heads/$base"
  pr_json=$(fetch "$pr_ref"); rc=$?
  if [ "$rc" -eq 44 ]; then
    echo "::error::no CodeQL analysis for $pr_ref; the analyze step's upload was not processed, so this is red, not green (#165)"
    exit 1
  elif [ "$rc" -ne 0 ]; then
    echo "::error::listing alerts for $pr_ref failed (#165)"; exit 2
  fi
  base_json=$(fetch "$base_ref"); rc=$?
  if [ "$rc" -eq 44 ]; then
    echo "::warning::no CodeQL analysis on $base_ref yet; every open alert on the PR at the gate's severity counts as new until a push to $base is analysed (#165)"
    base_json='[]'
  elif [ "$rc" -ne 0 ]; then
    echo "::error::listing alerts for $base_ref failed (#165)"; exit 2
  fi
fi

report=$(jq -rn --argjson p "$pr_json" --argjson b "$base_json" '
  def gated: select(.state == "open"
    and ((((.rule.security_severity_level // "") | IN("high", "critical"))
      or ((.rule.severity // "") == "error"))));
  ($b | map(.number)) as $bn
  | ($p | map(gated)) as $pg
  | ($pg | map(select(.number as $n | ($bn | index($n)) == null))) as $new
  | ($new[] | "::error file=\(.most_recent_instance.location.path // "?"),line=\(.most_recent_instance.location.start_line // 0)::#\(.number) \(.rule.id) (\(.rule.security_severity_level // .rule.severity // "?")) — \((.most_recent_instance.message.text // .rule.description // "") | gsub("\n"; " ") | .[0:160]) \(.html_url // "")"),
    "COUNTS \($p | length) \($pg | length) \($b | length) \($new | length)"
') || { echo "::error::jq failed over the alert lists (#165)"; exit 2; }

printf '%s\n' "$report" | grep -v '^COUNTS '
counts=$(printf '%s\n' "$report" | grep '^COUNTS ')
pr_open=$(printf '%s' "$counts" | awk '{print $2}')
pr_gated=$(printf '%s' "$counts" | awk '{print $3}')
base_open=$(printf '%s' "$counts" | awk '{print $4}')
new=$(printf '%s' "$counts" | awk '{print $5}')

if [ "$new" -gt 0 ]; then
  echo "::error::codeql-gate: $new new alert(s) at high/critical or error on $pr_ref that $base_ref does not carry ($pr_open open on the PR, $pr_gated of them at the gate's severity, $base_open open on the base) (#165)"
  exit 1
fi
echo "codeql-gate: no new alert at high/critical or error on $pr_ref vs $base_ref ($pr_open open on the PR, $pr_gated at the gate's severity, $base_open open on the base)"
exit 0
