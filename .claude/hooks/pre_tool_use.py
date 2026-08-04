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

        sys.exit(0)

    except Exception:
        sys.exit(0)  # fail open


if __name__ == "__main__":
    main()
