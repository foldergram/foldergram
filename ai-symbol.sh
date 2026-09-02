#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tags="$root/.ai/tags"
limit="${AI_SYMBOL_LIMIT:-20}"

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/ai-symbol.sh <symbol-or-regex>" >&2
  echo "Reads .ai/tags only. Do not read the whole symbol index." >&2
  exit 2
fi

if [ ! -f "$tags" ]; then
  echo "Missing $tags. Run scripts/ai-map.sh first." >&2
  exit 1
fi

python3 - "$tags" "$1" "$limit" <<'PY'
import re, sys
from pathlib import Path

tags_path, query, limit = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
rows = []
for line in tags_path.read_text(encoding="utf-8", errors="replace").splitlines():
    if not line or line.startswith("!_TAG_"):
        continue
    parts = line.split("\t")
    if len(parts) < 2:
        continue
    rows.append((parts[0], parts[1], line))

try:
    pattern = re.compile(query, re.I)
except re.error:
    pattern = re.compile(re.escape(query), re.I)

exact = [line for name, _p, line in rows if name.lower() == query.lower()]
named = [line for name, _p, line in rows if pattern.search(name)]
if exact:
    hits, kind = exact, "exact symbol"
elif named:
    hits, kind = named, "symbol name"
else:
    hits, kind = [line for _n, _p, line in rows if pattern.search(line)], "path/text"

shown = hits[:limit]
print(f"{kind} matches: {len(hits)} (showing {len(shown)})")
print("\n".join(shown))
if len(hits) > limit:
    print(f"... truncated to {limit} lines. Narrow the symbol or set AI_SYMBOL_LIMIT.")
if not hits:
    print(f"No symbol matches for: {query}")
    print(f'Next: AI_SEARCH_LIMIT=40 scripts/ai-search.sh "{query}"')
PY
