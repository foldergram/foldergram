#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ===== PROJECT CONFIG: foldergram (pnpm monorepo, server + client) =====
# Format: "标题|相对路径|后缀(可选，默认用 EXTS)"
# SYMBOL_DIRS 只放真正需要按符号定位的目录，测试和迁移只进文件索引。
SRC_DIRS=(
  "Server Source|server/src"
  "Client Source|client/src"
  "Server Tests|server/test"
  "DB Migrations|server/db/migrations|.sql"
  "Root Scripts|scripts|.mjs,.sh,.py"
)
SYMBOL_DIRS=("server/src" "client/src")
EXTS="${AI_EXTS:-.ts,.tsx,.vue,.mjs}"
ENTRYPOINTS=(
  "server-entry|server/src/index.ts"
  "server-app|server/src/app.ts"
  "api-routes|server/src/routes/api.ts"
  "db-repos|server/src/db/repositories.ts"
  "db-schema|server/src/db/schema.ts"
  "server-models|server/src/types/models.ts"
  "server-env|server/src/config/env.ts"
  "client-entry|client/src/main.ts"
  "client-router|client/src/router/index.ts"
  "client-http|client/src/api/http.ts"
  "client-api|client/src/api/gallery.ts"
  "client-types|client/src/types/api.ts"
)
# ======================================================================

out="$root/ai/AI_FILE_INDEX.md"
mkdir -p "$root/ai" "$root/.ai"

symbol_dirs=()
for dir in "${SYMBOL_DIRS[@]}"; do
  if [ -d "$root/$dir" ]; then
    symbol_dirs+=("$root/$dir")
  else
    echo "SYMBOL_DIRS entry not found, skipped: $dir" >&2
  fi
done

if [ "${#symbol_dirs[@]}" -eq 0 ]; then
  echo "No SYMBOL_DIRS resolved. Edit SYMBOL_DIRS at the top of scripts/ai-map.sh" >&2
  exit 1
fi

list_files() {
  local dir="$1"
  local ext_list="${2:-$EXTS}"
  local args=()
  local found=""
  IFS=',' read -r -a ext_arr <<< "$ext_list"
  if command -v rg >/dev/null 2>&1; then
    for e in "${ext_arr[@]}"; do args+=(--glob "*${e}"); done
    found="$(rg --files "$dir" "${args[@]}" --glob '!**/._*' 2>/dev/null || true)"
  else
    for e in "${ext_arr[@]}"; do args+=(-o -name "*${e}"); done
    found="$(find "$dir" -type f \( "${args[@]:1}" \) ! -name '._*' 2>/dev/null || true)"
  fi
  if [ -z "$found" ]; then
    echo "_(no matching files)_"
    return 0
  fi
  printf '%s\n' "$found" | sed "s#^$root/##" | sort | awk '{print "- `" $0 "`"}'
}

{
  echo "# AI File Index"
  echo
  echo "Generated: $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo
  echo "Run again after adding/moving files: \`scripts/ai-map.sh\`."
  echo
  echo "Do not read \`ai/AI_REPOMIX_CONTEXT.md\` or graph dumps by default."
  echo
  echo "## Important Entrypoints"
  echo
  echo "| Area | Path |"
  echo "|---|---|"
  for row in "${ENTRYPOINTS[@]}"; do
    echo "| ${row%%|*} | ${row#*|} |"
  done
  for row in "${SRC_DIRS[@]}"; do
    IFS='|' read -r title dir dir_exts <<< "$row"
    [ -d "$root/$dir" ] || continue
    echo
    echo "## $title (\`$dir\`)"
    echo
    list_files "$root/$dir" "$dir_exts"
  done
} > "$out"

if command -v python3 >/dev/null 2>&1; then
  joined="$(IFS=','; echo "${symbol_dirs[*]}")"
  python3 "$root/scripts/ai-index-symbols.py" "$root" "$joined" "$EXTS"
else
  echo "python3 not found; skipped .ai symbol index" >&2
fi

echo "Wrote $out"
