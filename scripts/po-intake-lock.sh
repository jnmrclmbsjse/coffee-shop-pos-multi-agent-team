#!/usr/bin/env bash
# Shared mutex helpers for po-intake.sh. Source this file; do not execute it.

OD_PO_INTAKE_LOCK_HELD=""

acquire_po_intake_lock() {
  local lock_dir="$1" owner_pid=""

  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" > "$lock_dir/pid"
    OD_PO_INTAKE_LOCK_HELD="$lock_dir"
    return 0
  fi

  if [[ -r "$lock_dir/pid" ]]; then
    read -r owner_pid < "$lock_dir/pid" || owner_pid=""
  fi

  if [[ "$owner_pid" =~ ^[0-9]+$ ]]; then
    if kill -0 "$owner_pid" 2>/dev/null; then
      printf 'PO_INTAKE_BUSY: another intake is still running (pid=%s, lock=%s). Do not retry while it is active.\n' \
        "$owner_pid" "$lock_dir" >&2
      return 75
    fi
  else
    # mkdir is atomic but writing the owner metadata is a second operation. An
    # empty/malformed lock can therefore be a brand-new live lock; never reclaim
    # it automatically and open a second check-and-create window.
    printf 'PO_INTAKE_BUSY: intake lock %s has no valid owner metadata. Do not retry; inspect the lock before removing it.\n' \
      "$lock_dir" >&2
    return 75
  fi

  # The recorded owner no longer exists. Reclaim only this exact lock, then
  # compete normally in case another process is reclaiming it at the same time.
  rm -f "$lock_dir/pid"
  rmdir "$lock_dir" 2>/dev/null || true
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" > "$lock_dir/pid"
    OD_PO_INTAKE_LOCK_HELD="$lock_dir"
    return 0
  fi

  printf 'PO_INTAKE_BUSY: another intake acquired the lock at %s. Do not retry while it is active.\n' \
    "$lock_dir" >&2
  return 75
}

release_po_intake_lock() {
  local lock_dir="${OD_PO_INTAKE_LOCK_HELD:-}"
  [[ -n "$lock_dir" ]] || return 0

  rm -f "$lock_dir/pid"
  rmdir "$lock_dir" 2>/dev/null || true
  OD_PO_INTAKE_LOCK_HELD=""
}
