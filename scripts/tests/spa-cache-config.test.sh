#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
nginx_config="$repo_root/deploy/nginx.conf"
deploy_workflow="$repo_root/.github/workflows/deploy.yml"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

index_location="$({
  awk '
    /^[[:space:]]*location = \/index[.]html[[:space:]]*\{/ { capture = 1 }
    capture { print }
    capture && /^[[:space:]]*\}/ { exit }
  ' "$nginx_config"
})"

[[ -n "$index_location" ]] ||
  fail "nginx must define an exact /index.html location"

grep -Fq 'add_header Cache-Control "no-cache" always;' <<<"$index_location" ||
  fail "the exact /index.html location must always emit Cache-Control: no-cache"

general_location="$({
  awk '
    /^[[:space:]]*location \/[[:space:]]*\{/ { capture = 1 }
    capture { print }
    capture && /^[[:space:]]*\}/ { exit }
  ' "$nginx_config"
})"

grep -Fq 'try_files $uri $uri/ /index.html;' <<<"$general_location" ||
  fail "deep SPA routes must internally fall back to /index.html"

if grep -Fq 'add_header Cache-Control "no-cache"' <<<"$general_location"; then
  fail "Cache-Control: no-cache must not be applied to content-hashed assets"
fi

grep -Fq -- '--paths "/*"' "$deploy_workflow" ||
  fail "the deploy workflow must invalidate every cached deep-link path"

if grep -Fq -- '--paths "/index.html" "/"' "$deploy_workflow"; then
  fail "the deploy workflow must not limit invalidation to root entry paths"
fi

echo "SPA cache configuration tests passed"
