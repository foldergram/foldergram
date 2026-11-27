#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'Deployment failed: %s\n' "$*" >&2; exit 1; }

# The CI key uses this script as an SSH forced command.
if [[ -n ${SSH_ORIGINAL_COMMAND+x} ]]; then
  if [[ $SSH_ORIGINAL_COMMAND == check ]]; then
    printf 'Foldergram deployment access ready for %s.\n' "$(id -un)"
    exit 0
  fi
  if [[ $SSH_ORIGINAL_COMMAND =~ ^deploy\ (v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?)\ ([0-9a-f]{40})$ ]]; then
    set -- "${BASH_REMATCH[1]}" "${BASH_REMATCH[3]}"
  elif [[ $SSH_ORIGINAL_COMMAND =~ ^deploy-docs\ ([0-9a-f]{40})$ ]]; then
    set -- docs "${BASH_REMATCH[1]}"
  else
    fail 'only check, deploy <version-tag> <commit-sha>, or deploy-docs <commit-sha> is allowed'
  fi
fi

[[ $# == 2 ]] || fail 'expected a version tag (or docs) and commit SHA'
tag=$1
commit=$2
[[ $tag == docs || $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || fail 'invalid deployment target'
[[ $commit =~ ^[0-9a-f]{40}$ ]] || fail 'invalid commit SHA'

deploy_root=${FOLDERGRAM_DEPLOY_ROOT:-/srv/foldergram}
app_root=$deploy_root/app
docs_root=${FOLDERGRAM_DOCS_ROOT:-/var/www/foldergram-docs}
ecosystem=$deploy_root/ecosystem.config.cjs
backup_root=$deploy_root/deploy-backup
node_bin=${FOLDERGRAM_NODE_BIN:-/opt/node-v22.23.4-linux-x64/bin}
health_url=${FOLDERGRAM_HEALTH_URL:-http://127.0.0.1:4141/api/health}
health_attempts=${FOLDERGRAM_HEALTH_ATTEMPTS:-30}
health_delay=${FOLDERGRAM_HEALTH_DELAY:-2}
export PATH="$node_bin:/usr/local/bin:/usr/bin:/bin"
[[ -d $app_root/.git && -d $docs_root && -x $node_bin/node ]] || fail 'deployment configuration is incomplete'
if [[ $tag != docs ]]; then
  [[ -f $app_root/.env && -f $app_root/data/db/gallery.sqlite && -f $ecosystem ]] || fail 'application layout is incomplete'
fi
[[ -z $(git -C "$app_root" status --porcelain) ]] || fail 'server checkout has uncommitted changes'

exec 9> "$deploy_root/.deploy.lock"
flock -n 9 || fail 'another deployment is running'

if [[ $tag == docs ]]; then
  docs_stage=
  docs_backup_work=
  docs_publishing=0
  docs_backup_root=$deploy_root/docs-backup

  cleanup_docs() {
    [[ -z $docs_stage ]] || rm -rf -- "$docs_stage"
    [[ -z $docs_backup_work ]] || rm -rf -- "$docs_backup_work"
  }

  rollback_docs() {
    local status=${1:-$?}
    trap - ERR HUP INT TERM
    if [[ $docs_publishing == 1 ]]; then
      printf 'Restoring the previous documentation.\n' >&2
      if ! rsync -ac --delete "$docs_backup_root/" "$docs_root/"; then
        printf 'Documentation recovery is incomplete. Backup: %s\n' "$docs_backup_root" >&2
      fi
    fi
    exit "$status"
  }

  trap cleanup_docs EXIT
  trap rollback_docs ERR
  trap 'rollback_docs 130' INT
  trap 'rollback_docs 143' HUP TERM

  git -C "$app_root" fetch --no-tags origin refs/heads/main
  resolved=$(git -C "$app_root" rev-parse --verify 'FETCH_HEAD^{commit}')
  [[ $resolved == "$commit" ]] || fail 'main no longer matches the workflow commit; run the workflow again'
  if git -C "$app_root" ls-tree -r --name-only "$commit" -- .env data | grep -vE '^data/(.*/)?\.gitkeep$'; then
    fail 'documentation source tracks files in .env or data/'
  fi

  docs_stage=$(mktemp -d "$deploy_root/.docs.XXXXXX")
  git -C "$app_root" archive "$commit" | tar -x -C "$docs_stage"
  (
    cd "$docs_stage"
    CI=1 pnpm install --frozen-lockfile --prod=false
    pnpm build:docs
  )
  [[ -f $docs_stage/docs/.vitepress/dist/index.html ]] || fail 'documentation build output is incomplete'

  docs_backup_work=$(mktemp -d "$deploy_root/.docs-backup.XXXXXX")
  rsync -a "$docs_root/" "$docs_backup_work/"
  rm -rf -- "$docs_backup_root"
  mv "$docs_backup_work" "$docs_backup_root"
  docs_backup_work=

  docs_publishing=1
  rsync -ac --delete --chmod=D755,F644 "$docs_stage/docs/.vitepress/dist/" "$docs_root/"
  docs_publishing=0
  printf 'Deployed docs from main (%s); rollback backup: %s\n' "$commit" "$docs_backup_root"
  exit 0
fi

stage=
backup_work=
backup_ready=0
app_stopped=0
previous_commit=$(git -C "$app_root" rev-parse HEAD)

cleanup() {
  [[ -z $stage ]] || rm -rf -- "$stage"
  [[ -z $backup_work ]] || rm -rf -- "$backup_work"
}

rollback() {
  local status=${1:-$?}
  local restored=1
  trap - ERR HUP INT TERM
  if [[ $app_stopped == 1 ]]; then
    printf 'Restoring the previous application and database.\n' >&2
    if ! pm2 stop foldergram-demo; then
      printf 'Cannot stop the app safely; recover manually from %s.\n' "$backup_root" >&2
      exit "$status"
    fi
    if [[ $backup_ready == 1 ]]; then
      git -C "$app_root" checkout --detach "$previous_commit" || restored=0
      rsync -ac --delete --exclude='/.git/' --exclude='/.env' --exclude='/data/' "$backup_root/app/" "$app_root/" || restored=0
      rsync -ac --delete "$backup_root/db/" "$app_root/data/db/" || restored=0
      cp -p "$backup_root/env" "$app_root/.env" || restored=0
      rsync -ac --delete "$backup_root/docs/" "$docs_root/" || restored=0
    fi
    if [[ $restored != 1 ]]; then
      printf 'Recovery is incomplete; the app remains stopped. Backup: %s\n' "$backup_root" >&2
      exit "$status"
    fi
    pm2 restart "$ecosystem" --only foldergram-demo || true
    pm2 save || true
  fi
  exit "$status"
}

trap cleanup EXIT
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' HUP TERM

printf 'Fetching %s (%s).\n' "$tag" "$commit"
git -C "$app_root" fetch --no-tags origin "refs/tags/$tag:refs/tags/$tag"
resolved=$(git -C "$app_root" rev-parse --verify "refs/tags/$tag^{commit}")
[[ $resolved == "$commit" ]] || fail 'tag does not match the workflow commit'
# A release must never replace persistent configuration or gallery files.
if git -C "$app_root" ls-tree -r --name-only "$commit" -- .env data | grep -vE '^data/(.*/)?\.gitkeep$'; then
  fail 'release tracks files in .env or data/'
fi

stage=$(mktemp -d "$deploy_root/.release.XXXXXX")
git -C "$app_root" archive "$commit" | tar -x -C "$stage"
printf 'Building the application and docs before stopping the demo.\n'
(
  cd "$stage"
  CI=1 pnpm install --frozen-lockfile --prod=false
  pnpm build
  pnpm build:docs
)
[[ -f $stage/server/dist/index.js && -f $stage/client/dist/index.html && -f $stage/docs/.vitepress/dist/index.html ]] || fail 'build output is incomplete'

backup_work=$(mktemp -d "$deploy_root/.deploy-backup.XXXXXX")
printf 'Stopping the demo and replacing the single rollback backup.\n'
app_stopped=1
pm2 stop foldergram-demo
mkdir "$backup_work/app" "$backup_work/db" "$backup_work/docs"
rsync -a --exclude='/.git/' --exclude='/.env' --exclude='/data/' "$app_root/" "$backup_work/app/"
rsync -a --exclude='/gallery.sqlite' --exclude='/gallery.sqlite-wal' --exclude='/gallery.sqlite-shm' "$app_root/data/db/" "$backup_work/db/"
python3 - "$app_root/data/db/gallery.sqlite" "$backup_work/db/gallery.sqlite" <<'PY'
import os
import sqlite3
import sys
from pathlib import Path

source = sqlite3.connect(Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True)
target = sqlite3.connect(sys.argv[2])
source.backup(target)
assert target.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
target.close()
source.close()
os.chmod(sys.argv[2], 0o600)
PY
cp -p "$app_root/.env" "$backup_work/env"
rsync -a "$docs_root/" "$backup_work/docs/"
printf '%s\n' "$previous_commit" > "$backup_work/commit"
# Finish the replacement snapshot before removing the previous one.
rm -rf -- "$backup_root"
mv "$backup_work" "$backup_root"
backup_work=
backup_ready=1

git -C "$app_root" checkout --detach "$commit"
rsync -ac --delete --exclude='/.git/' --exclude='/.env' --exclude='/data/' "$stage/" "$app_root/"
pm2 restart "$ecosystem" --only foldergram-demo

healthy=0
for ((attempt=1; attempt<=health_attempts; attempt++)); do
  if curl --fail --silent --show-error --max-time 5 "$health_url" > "$stage/health.json" &&
    node -e 'const fs=require("node:fs"); const r=JSON.parse(fs.readFileSync(process.argv[1])); if(!r.ok || !r.storage?.available || r.storage.usingInMemoryDatabase) process.exit(1)' "$stage/health.json"; then
    healthy=1
    break
  fi
  sleep "$health_delay"
done
[[ $healthy == 1 ]] || { printf 'New application did not become healthy.\n' >&2; false; }
rsync -ac --delete --chmod=D755,F644 "$stage/docs/.vitepress/dist/" "$docs_root/"
pm2 save
app_stopped=0
printf 'Deployed %s (%s); rollback backup: %s\n' "$tag" "$commit" "$backup_root"
