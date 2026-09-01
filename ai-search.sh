#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ===== PROJECT CONFIG: foldergram =====
DEFAULT_TARGETS=("server/src" "client/src")
EXCLUDES=(
  '!**/node_modules/**' '!**/dist/**' '!**/build/**' '!**/out/**'
  '!**/.git/**' '!**/.idea/**' '!**/.vscode/**' '!**/__pycache__/**'
  '!**/.tmp/**' '!**/.ai/**' '!**/coverage/**' '!**/._*'
  '!data/**' '!docs/.vitepress/dist/**' '!docs/.vitepress/cache/**'
  '!**/*.png' '!**/*.jpg' '!**/*.jpeg' '!**/*.webp' '!**/*.avif'
  '!**/*.mp4' '!**/*.mov' '!**/*.svg' '!**/*.pdf' '!**/*.zip'
  '!**/*.db' '!**/*.sqlite*' '!**/*.lock' '!pnpm-lock.yaml'
  '!ai/AI_REPOMIX_CONTEXT.md' '!ai/AI_FILE_INDEX.md'
)
# ======================================

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/ai-search.sh <query> [path]" >&2
  echo "Optional: AI_SEARCH_LIMIT=40 scripts/ai-search.sh <query>" >&2
  exit 2
fi

query="$1"
limit="${AI_SEARCH_LIMIT:-120}"

search_paths=()
if [ "$#" -ge 2 ] && [ -n "$2" ]; then
  case "$2" in
    /*) search_paths=("$2") ;;
    *) search_paths=("$root/$2") ;;
  esac
else
  for d in "${DEFAULT_TARGETS[@]}"; do
    [ -d "$root/$d" ] && search_paths+=("$root/$d")
  done
fi

run_search() {
  if command -v rg >/dev/null 2>&1; then
    local globs=()
    for pattern in "${EXCLUDES[@]}"; do globs+=(--glob "$pattern"); done
    rg --line-number --hidden --smart-case "${globs[@]}" "$query" "${search_paths[@]}"
  else
    grep -RIn "$query" "${search_paths[@]}"
  fi
}

set +e
output="$(run_search 2>&1)"
status=$?
set -e

if [ "$status" -ne 0 ] && [ -z "$output" ]; then
  echo "No matches for: $query"
  exit 0
fi

printf '%s\n' "$output" | sed "s#^$root/##" | sed -n "1,${limit}p"
lines="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
if [ "$lines" -gt "$limit" ]; then
  echo "... truncated to ${limit} lines. Narrow the query instead of raising the limit."
fi
