#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# ///
"""
PreToolUse hook — deterministic guardrails for the Sakta Cab repo.

Blocks (exit 2, reason on stderr):
  1. Secret access — .env files, keys, credentials, or dumping the process
     environment. Committed .env.example templates are allowed.
  2. Destructive rm -rf.
  3. The anketa fence — edits to the root `app/` and `backend/` mini-project
     (the Sakta Cab anketa). CLAUDE.md says it must never be refactored into
     the workspace; this makes that a guarantee instead of a request.
  4. The draft→ready flip — `gh pr ready`, `--undo` and the GraphQL mutations
     behind them. CI's `ready` job is the only path (#165). Also `gh pr merge`
     (a human merges) and `gh pr create` without `--draft`.
  5. Suppressing a CodeQL finding — dismissing a code-scanning alert through
     the API, or a `lgtm`/`codeql` suppression comment in shipped source. A
     human dismisses in the GitHub UI, with a reason (#165).
  6. The guard fence — writes to `.github/workflows/`, `.github/scripts/`,
     `.claude/hooks/` and `.claude/settings.json`, the files that define the
     gate and this hook.

Guards 4 and 5 read a Bash command's text AND the text a write tool would put
into a non-`.md` file. Text is all they read, which bounds what they can
promise: writing a command into a script and running the script, or editing
the files guard 6 fences, matches no pattern here. They make the wrong move
deliberate rather than convenient. The control that holds is branch protection
on `main` — see docs/runbooks/pr-gate.md §5 (#165, PR #167 review F4/F5).

Everything else is allowed. FAILS OPEN: any unexpected error exits 0 so a bug
here can never brick a session.
"""

import json
import re
import sys

ENV_TEMPLATE_SUFFIXES = (".env.example",)

SECRET_PATH = re.compile(
    r"\.env\b|\.pem$|\.key$|id_rsa|id_ed25519|\.ssh/|\.aws/credentials|\.netrc|credentials\.json",
    re.IGNORECASE,
)

ENV_DUMP = (
    re.compile(r"\bprintenv\b", re.IGNORECASE),
    re.compile(r"^\s*env\s*(\||>|$)", re.IGNORECASE),
    re.compile(r"\becho\b.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)", re.IGNORECASE),
    re.compile(r"os.environ|process\.env|ENV\[", re.IGNORECASE),
)

# Root `app/` and `backend/` are the separate anketa mini-project — NOT the
# monorepo apps under `apps/`. Matches relative paths from the repo root and
# absolute paths that pass through the repo root.
ANKETA_FENCE = re.compile(r"(^|/taxi/)(app|backend)/")

# `gh pr ready` (and `--undo`, on purpose: re-drafting is CI's too) plus BOTH
# GraphQL mutations behind the draft state. REST has no un-draft endpoint.
# `convertPullRequestToDraft` was missing until PR #167's review (F11): the
# comment already said re-drafting is CI's, and the pattern did not say it.
PR_READY_FLIP = re.compile(
    r"\bgh\s+pr\s+ready\b|markPullRequestReadyForReview|convertPullRequestToDraft",
    re.IGNORECASE,
)

# A human merges. The skills all say so and nothing enforced it, which left the
# window in ci.yml's `ready` comment reachable from a session: between a push
# and that head's run finishing, the PR still carries the previous head's green
# tick (#165, PR #167 review F3a).
PR_MERGE = re.compile(r"\bgh\s+pr\s+merge\b", re.IGNORECASE)

# Every PR opens as a draft (#165). Refused unless --draft (or -d) is present:
# a born-ready PR whose `ready` job then fails cannot be undone by CI and sits
# ready with nothing passed (`observed` run 34471798333). The plan declined this
# guard for blocking T7's throwaway probes, but T7's own text opens with
# --draft, so that cost does not exist (PR #167 review F8).
PR_CREATE = re.compile(r"\bgh\s+pr\s+create\b", re.IGNORECASE)
DRAFT_FLAG = re.compile(r"--draft\b|(?<!\w)-d\b", re.IGNORECASE)
# The draft flag is looked for in the SAME command segment as the create, not
# anywhere in the text: `mkdir -d tmp && gh pr create …` otherwise satisfies it
# and the guard fails open. Found by probing this fix's own mechanism.
CMD_SPLIT = re.compile(r"&&|\|\||[;|\n]")

# Dismissing a code-scanning alert (REST: PATCH …/code-scanning/alerts/N with
# state=dismissed) and the in-source suppression comment forms CodeQL honours.
# Both are a human's call, in the GitHub UI, with a reason (#165).
#
# The dismiss pattern is anchored on the PATCH, in either word order, because
# flags move: `-f state=dismissed` can precede the URL, the body can arrive via
# `--input`, and the old `alerts/\d+.*dismiss` form also blocked a plain READ
# (`--jq .dismissed_reason`) while missing all three (PR #167 review F4/F11).
#
# The comment pattern is case-insensitive and covers bare `lgtm`, because
# CodeQL's own matcher does: shared/util/codeql/util/suppression/
# AlertSuppression.qll uses `(?i)\blgtm\s*\[…\]`, `(?i)(?<=^|;)\s*lgtm(?!\B|\s*\[)`
# and `(?i)\bcodeql\s*\[…\]`, so `// LGTM[…]` and a bare `// lgtm` are live
# suppressions the old pattern let through.
ALERT_DISMISS = re.compile(
    r"code-scanning/alerts.*?(state=dismissed|(-X|--method)\s*PATCH|--input)"
    r"|((-X|--method)\s*PATCH|state=dismissed).*?code-scanning/alerts",
    re.IGNORECASE | re.DOTALL,
)
SUPPRESSION_COMMENT = re.compile(
    r"\b(lgtm|codeql)\s*\[|(?://|/\*|\#|;)\s*lgtm\b(?!\s*\[)",
    re.IGNORECASE,
)
SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")

# The files that define the gate and this hook. Same shape as the anketa fence
# and the same limit: a hook guarding its own file is a mitigation, not a
# boundary — the fence is one edit away, and a Bash heredoc is not a write tool
# at all. Branch protection is what a branch cannot rewrite (runbook §5).
GUARD_FENCE = re.compile(
    r"(^|/)(\.github/(workflows|scripts)/|\.claude/hooks/|\.claude/settings\.json$)"
)

WRITE_TOOLS = ("Edit", "MultiEdit", "Write", "NotebookEdit")

BLOCKED_ENV_MESSAGE = (
    "BLOCKED: access to secrets is not allowed.\n"
    "Read a committed .env.example template instead."
)
BLOCKED_RM_MESSAGE = "BLOCKED: refusing to run a recursive-force delete (rm -rf)."
BLOCKED_ANKETA_MESSAGE = (
    "BLOCKED: root app/ and backend/ are the separate anketa mini-project.\n"
    "CLAUDE.md: do not modify it or refactor it into the workspace. The\n"
    "monorepo apps live under apps/. If the user explicitly asked to work on\n"
    "the anketa itself, ask them to confirm and edit it outside this guard."
)
BLOCKED_PR_READY_MESSAGE = (
    "BLOCKED: `gh pr ready` is CI's to run, never a model's (#165).\n"
    "A PR leaves draft only when ci.yml's `ready` job sees every gate job green.\n"
    "If it is stuck: read the failing check on the PR, fix, push. A human can\n"
    "flip it in the GitHub UI; that path is documented in docs/runbooks/pr-gate.md."
)
BLOCKED_ALERT_SUPPRESSION_MESSAGE = (
    "BLOCKED: suppressing a CodeQL finding is a human's call, never a model's (#165).\n"
    "Fix the finding inside this PR's diff, or leave it and say why under\n"
    "`## Notes for the reviewer`. A human dismisses it in the GitHub UI with a\n"
    "reason; see docs/runbooks/pr-gate.md.\n"
    "(Discussing the suppression forms is fine in a .md file, which is exempt.)"
)
BLOCKED_PR_MERGE_MESSAGE = (
    "BLOCKED: merging a PR is a human's call, never a model's (#165).\n"
    "The agent loop ends at a reviewed, green PR. A green tick can belong to an\n"
    "EARLIER head than the one you are looking at — see docs/runbooks/pr-gate.md §0."
)
BLOCKED_PR_CREATE_MESSAGE = (
    "BLOCKED: every PR opens as a draft (#165) — add --draft.\n"
    "CI's `ready` job flips it when the gate is green. A PR opened ready cannot\n"
    "be re-drafted by CI if that job then fails, so it would sit ready with\n"
    "nothing passed. See docs/runbooks/pr-gate.md."
)
BLOCKED_GUARD_FENCE_MESSAGE = (
    "BLOCKED: this file defines the PR gate or this hook (#165).\n"
    ".github/workflows/, .github/scripts/, .claude/hooks/ and .claude/settings.json\n"
    "are fenced: a session that can edit the gate does not have one. If the user\n"
    "explicitly asked for this change, ask them to confirm and make it outside\n"
    "this guard. See docs/runbooks/pr-gate.md §5."
)


def _is_template(path: str) -> bool:
    return path.endswith(ENV_TEMPLATE_SUFFIXES)


def is_secret_access(tool_name: str, tool_input: dict) -> bool:
    if tool_name in ("Read", "Edit", "MultiEdit", "Write", "NotebookEdit"):
        path = tool_input.get("file_path", "").replace("\\", "/")
        return bool(SECRET_PATH.search(path)) and not _is_template(path)

    if tool_name in ("Grep", "Glob"):
        target = f"{tool_input.get('pattern', '')} {tool_input.get('path', '')}".replace("\\", "/")
        return bool(SECRET_PATH.search(target)) and ".env.example" not in target

    if tool_name == "Bash":
        command = tool_input.get("command", "").replace("\\", "/")
        if any(p.search(command) for p in ENV_DUMP):
            return True
        return bool(SECRET_PATH.search(command)) and ".env.example" not in command

    return False


def is_dangerous_rm(tool_name: str, tool_input: dict) -> bool:
    if tool_name != "Bash":
        return False
    command = " ".join(tool_input.get("command", "").lower().split())
    return bool(
        re.search(r"\brm\b.*-[a-z]*r[a-z]*f", command)
        or re.search(r"\brm\b.*-[a-z]*f[a-z]*r", command)
        or re.search(r"\brm\b.*--recursive.*--force", command)
        or re.search(r"\brm\b.*--force.*--recursive", command)
    )


def is_anketa_write(tool_name: str, tool_input: dict) -> bool:
    """True if a write tool targets the fenced-off anketa mini-project."""
    if tool_name not in ("Edit", "MultiEdit", "Write", "NotebookEdit"):
        return False
    path = tool_input.get("file_path", "").replace("\\", "/")
    return bool(ANKETA_FENCE.search(path))


def _written_texts(tool_input: dict) -> list:
    """Every string a write tool would put into the file."""
    texts = [
        tool_input.get("new_string", ""),
        tool_input.get("content", ""),
        tool_input.get("new_source", ""),
    ]
    texts += [e.get("new_string", "") for e in tool_input.get("edits", []) if isinstance(e, dict)]
    return [t for t in texts if t]


def _guarded_texts(tool_name: str, tool_input: dict) -> list:
    """Bash command text, or write-tool text bound for a non-.md file.

    `.md` is exempt so the runbook and the skills can name the phrases they
    document — that exemption is also the escape hatch, and it is deliberate:
    prose about a rule has to be writable, or the rule cannot be explained.
    """
    if tool_name == "Bash":
        return [tool_input.get("command", "")]
    if tool_name in WRITE_TOOLS:
        path = tool_input.get("file_path", "").replace("\\", "/").lower()
        if path.endswith(".md"):
            return []
        return _written_texts(tool_input)
    return []


def is_pr_ready_flip(tool_name: str, tool_input: dict) -> bool:
    return any(PR_READY_FLIP.search(t) for t in _guarded_texts(tool_name, tool_input))


def is_pr_merge(tool_name: str, tool_input: dict) -> bool:
    return any(PR_MERGE.search(t) for t in _guarded_texts(tool_name, tool_input))


def is_undrafted_pr_create(tool_name: str, tool_input: dict) -> bool:
    if tool_name != "Bash":
        return False
    for segment in CMD_SPLIT.split(tool_input.get("command", "")):
        if PR_CREATE.search(segment) and not DRAFT_FLAG.search(segment):
            return True
    return False


def is_alert_suppression(tool_name: str, tool_input: dict) -> bool:
    for text in _guarded_texts(tool_name, tool_input):
        if ALERT_DISMISS.search(text):
            return True
    # The comment forms only suppress inside shipped source, so a write tool is
    # judged on its target; a Bash command is judged on its text, because that
    # is where `sed -i`, a heredoc and `python3 -c` put the same comment.
    if tool_name == "Bash":
        return bool(SUPPRESSION_COMMENT.search(tool_input.get("command", "")))
    if tool_name in WRITE_TOOLS:
        path = tool_input.get("file_path", "").replace("\\", "/")
        if not path.endswith(SOURCE_SUFFIXES):
            return False
        return any(SUPPRESSION_COMMENT.search(t) for t in _written_texts(tool_input))
    return False


def is_fenced_guard_write(tool_name: str, tool_input: dict) -> bool:
    if tool_name not in WRITE_TOOLS:
        return False
    path = tool_input.get("file_path", "").replace("\\", "/")
    return bool(GUARD_FENCE.search(path))


def main() -> None:
    try:
        data = json.load(sys.stdin)
        tool_name = data.get("tool_name", "")
        tool_input = data.get("tool_input", {})

        if is_secret_access(tool_name, tool_input):
            print(BLOCKED_ENV_MESSAGE, file=sys.stderr)
            sys.exit(2)

        if is_dangerous_rm(tool_name, tool_input):
            print(BLOCKED_RM_MESSAGE, file=sys.stderr)
            sys.exit(2)

        if is_anketa_write(tool_name, tool_input):
            print(BLOCKED_ANKETA_MESSAGE, file=sys.stderr)
            sys.exit(2)

        if is_pr_ready_flip(tool_name, tool_input):
            print(BLOCKED_PR_READY_MESSAGE, file=sys.stderr)
            sys.exit(2)

        if is_pr_merge(tool_name, tool_input):
            print(BLOCKED_PR_MERGE_MESSAGE, file=sys.stderr)
            sys.exit(2)

        if is_undrafted_pr_create(tool_name, tool_input):
            print(BLOCKED_PR_CREATE_MESSAGE, file=sys.stderr)
            sys.exit(2)

        if is_alert_suppression(tool_name, tool_input):
            print(BLOCKED_ALERT_SUPPRESSION_MESSAGE, file=sys.stderr)
            sys.exit(2)

        if is_fenced_guard_write(tool_name, tool_input):
            print(BLOCKED_GUARD_FENCE_MESSAGE, file=sys.stderr)
            sys.exit(2)

        sys.exit(0)

    except Exception:
        sys.exit(0)  # fail open


if __name__ == "__main__":
    main()
