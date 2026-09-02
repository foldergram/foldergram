#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Lightweight default: refresh small indexes only.
# After this: read ai/AI_CONTEXT.md, then query on demand.
scripts/ai-map.sh

# Full-repo dump is expensive. Opt-in only.
if [ "${AI_REFRESH_REPOMIX:-0}" = "1" ] && command -v repomix >/dev/null 2>&1; then
  mkdir -p .tmp
  repomix --config repomix.config.json >/dev/null || true
  echo "Wrote .tmp/AI_REPOMIX_CONTEXT.md (sample it, do not load it fully)"
fi
