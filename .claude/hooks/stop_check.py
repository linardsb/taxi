#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# ///
"""
Stop hook — the "Done = pnpm check green, never say-so" guarantee.

When the agent tries to end its turn with uncommitted changes to workspace
code (apps/, services/, packages/, db/), run `pnpm check` (turbo: typecheck +
lint + test). If it fails, block the stop (exit 2) and feed the tail of the
output back so the agent fixes it before declaring done.

Escape hatches, all fail-open:
  - stop_hook_active: if we already blocked once this turn, allow the stop —
    the agent tried and reported; a hook must never loop forever.
  - No dirty workspace code → exit 0 without running anything (conversation
    turns stay free; turbo caching keeps re-runs cheap otherwise).
  - pnpm missing, timeout, or any unexpected error → exit 0.
"""

import json
import os
import subprocess
import sys

CODE_PREFIXES = ("apps/", "services/", "packages/", "db/")
CHECK_TIMEOUT_S = 300
# Node 26's built-in `localStorage` shadows jsdom's, so every dispatch test that
# touches `window.localStorage` fails locally (PR #331). CI does not need it.
WEBSTORAGE_FLAG = "--no-experimental-webstorage"


def check_env() -> dict:
    """The environment for `pnpm check`, plus WEBSTORAGE_FLAG when this Node
    accepts it: an unknown flag in NODE_OPTIONS makes every node process exit."""
    env = dict(os.environ)
    probe = subprocess.run(
        ["node", WEBSTORAGE_FLAG, "-e", "0"],
        capture_output=True, timeout=15,
    )
    if probe.returncode == 0:
        env["NODE_OPTIONS"] = f"{env.get('NODE_OPTIONS', '')} {WEBSTORAGE_FLAG}".strip()
    return env


def dirty_code_files() -> list:
    out = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True, text=True, timeout=15,
    ).stdout
    files = []
    for line in out.splitlines():
        path = line[3:].strip().strip('"')
        if path.startswith(CODE_PREFIXES):
            files.append(path)
    return files


def main() -> None:
    try:
        data = json.load(sys.stdin)
        if data.get("stop_hook_active"):
            sys.exit(0)  # already blocked once this turn — never loop

        if not dirty_code_files():
            sys.exit(0)

        result = subprocess.run(
            "pnpm check", shell=True, env=check_env(),
            capture_output=True, text=True, timeout=CHECK_TIMEOUT_S,
        )
        if result.returncode == 0:
            sys.exit(0)

        tail = (result.stdout + "\n" + result.stderr)[-3000:]
        print(
            "BLOCKED: workspace code changed but `pnpm check` is red. "
            "Fix the failures before finishing (Done = pnpm check green):\n"
            f"{tail}",
            file=sys.stderr,
        )
        sys.exit(2)

    except Exception:
        sys.exit(0)  # fail open


if __name__ == "__main__":
    main()
