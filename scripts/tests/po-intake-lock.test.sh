#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
helper="$repo_root/scripts/po-intake-lock.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/po-intake-lock-test.XXXXXX")"
lock_dir="$test_root/intake.lock"

cleanup() {
  release_po_intake_lock || true
  rm -rf "$test_root"
}
trap cleanup EXIT

source "$helper"

acquire_po_intake_lock "$lock_dir"

set +e
busy_output="$(bash -c 'source "$1"; acquire_po_intake_lock "$2"' _ "$helper" "$lock_dir" 2>&1)"
busy_rc=$?
set -e

if [[ "$busy_rc" -ne 75 ]]; then
  printf 'FAIL: concurrent intake returned %s instead of 75\n%s\n' "$busy_rc" "$busy_output" >&2
  exit 1
fi
if [[ "$busy_output" != *"PO_INTAKE_BUSY"* ]]; then
  printf 'FAIL: concurrent intake did not print PO_INTAKE_BUSY\n%s\n' "$busy_output" >&2
  exit 1
fi

release_po_intake_lock
acquire_po_intake_lock "$lock_dir"
release_po_intake_lock

mkdir "$lock_dir"
set +e
ownerless_output="$(bash -c 'source "$1"; acquire_po_intake_lock "$2"' _ "$helper" "$lock_dir" 2>&1)"
ownerless_rc=$?
set -e
if [[ "$ownerless_rc" -ne 75 ]] || [[ "$ownerless_output" != *"PO_INTAKE_BUSY"* ]]; then
  printf 'FAIL: ownerless lock was reclaimed instead of treated as busy\n%s\n' "$ownerless_output" >&2
  exit 1
fi
rmdir "$lock_dir"

mkdir "$lock_dir"
printf '%s\n' '99999999' > "$lock_dir/pid"
acquire_po_intake_lock "$lock_dir"

echo "po-intake lock tests passed"
