#!/usr/bin/env python3
"""
Fails if a PR author with a restricted entry in .github/agent-access.json
touches any file outside their allowed path prefixes.

Usage: check_path_restrictions.py <pr-author-login> <base-sha> <head-sha>
Exit 0 = pass (or role unrestricted / no config found), 1 = violation found.
"""
import json
import subprocess
import sys
import pathlib

CONFIG_PATH = pathlib.Path(__file__).resolve().parents[2] / ".github" / "agent-access.json"


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: check_path_restrictions.py <pr-author-login> <base-sha> <head-sha>")
        return 2

    actor, base_sha, head_sha = sys.argv[1], sys.argv[2], sys.argv[3]

    if not CONFIG_PATH.exists():
        print(f"No config at {CONFIG_PATH} — nothing restricted yet, passing.")
        return 0

    config = json.loads(CONFIG_PATH.read_text())
    allowed_prefixes = config.get(actor)

    if allowed_prefixes is None:
        print(f"'{actor}' has no entry in agent-access.json — unrestricted, passing.")
        return 0

    diff = subprocess.run(
        ["git", "diff", "--name-only", f"{base_sha}...{head_sha}"],
        capture_output=True, text=True, check=True,
    ).stdout.splitlines()

    violations = [
        f for f in diff
        if not any(f.startswith(prefix) for prefix in allowed_prefixes)
    ]

    if violations:
        print(f"BLOCKED: '{actor}' is restricted to {allowed_prefixes} but this PR touches:")
        for v in violations:
            print(f"  - {v}")
        return 1

    print(f"OK: all {len(diff)} changed file(s) fall within {actor}'s allowed paths {allowed_prefixes}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
