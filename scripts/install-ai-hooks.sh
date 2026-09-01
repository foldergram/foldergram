#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="$root/.git/hooks/pre-commit"

if [ ! -d "$root/.git" ]; then
  echo "No .git directory found; skip hook install."
  echo "Refresh indexes manually with: scripts/ai-refresh.sh"
  exit 0
fi

mkdir -p "$root/.git/hooks"

if [ -f "$hook" ] && ! grep -q "AI_INDEX_HOOK" "$hook"; then
  backup="$hook.backup.$(date +%Y%m%d%H%M%S)"
  cp "$hook" "$backup"
  cat > "$hook" <<EOF_HOOK
#!/usr/bin/env bash
set -euo pipefail

# Existing hook preserved at: $backup
"$backup" "\$@"

# AI_INDEX_HOOK
scripts/ai-refresh.sh >/dev/null
git add ai/AI_FILE_INDEX.md 2>/dev/null || true
EOF_HOOK
else
  cat > "$hook" <<'EOF_HOOK'
#!/usr/bin/env bash
set -euo pipefail

# AI_INDEX_HOOK
# Keep AI discovery files fresh before each commit.
scripts/ai-refresh.sh >/dev/null
git add ai/AI_FILE_INDEX.md 2>/dev/null || true
EOF_HOOK
fi

chmod +x "$hook"
echo "Installed $hook"
