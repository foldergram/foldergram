#!/usr/bin/env bash
set -Eeuo pipefail

script=$(cd "$(dirname "$0")" && pwd)/deploy-vps.sh
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/repo" "$fixture/deploy" "$fixture/docs" "$fixture/bin"
real_node=$(command -v node)
ln -s "$real_node" "$fixture/bin/node"

git -C "$fixture/repo" init -q
git -C "$fixture/repo" config user.email deploy-test@example.invalid
git -C "$fixture/repo" config user.name 'Deployment test'
printf '.env\ndata/\nnode_modules/\nserver/dist/\nclient/dist/\ndocs/.vitepress/dist/\n' > "$fixture/repo/.gitignore"
printf 'old\n' > "$fixture/repo/version"
git -C "$fixture/repo" add version .gitignore
git -C "$fixture/repo" commit -qm 'initial fixture'
git -C "$fixture/repo" tag v1.0.0
old_commit=$(git -C "$fixture/repo" rev-parse HEAD)
git clone -q "$fixture/repo" "$fixture/deploy/app"
printf 'new\n' > "$fixture/repo/version"
git -C "$fixture/repo" commit -qam 'new fixture'
git -C "$fixture/repo" tag v1.0.1
new_commit=$(git -C "$fixture/repo" rev-parse HEAD)

mkdir -p "$fixture/deploy/app/data/db" "$fixture/deploy/app/data/gallery" "$fixture/deploy/app/data/external-gallery" "$fixture/deploy/app/server/dist" "$fixture/deploy/app/client/dist" "$fixture/deploy/app/node_modules"
printf 'PUBLIC_DEMO_MODE=1\nDATA_ROOT=./data\n' > "$fixture/deploy/app/.env"
printf 'primary-original\n' > "$fixture/deploy/app/data/gallery/photo.jpg"
printf 'secondary-original\n' > "$fixture/deploy/app/data/external-gallery/photo.jpg"
printf 'old\n' > "$fixture/deploy/app/server/dist/index.js"
printf 'old\n' > "$fixture/deploy/app/client/dist/index.html"
printf 'old\n' > "$fixture/deploy/app/node_modules/runtime"
printf 'old\n' > "$fixture/docs/index.html"
printf 'module.exports = {};\n' > "$fixture/deploy/ecosystem.config.cjs"
python3 - "$fixture/deploy/app/data/db/gallery.sqlite" <<'PY'
import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute('CREATE TABLE likes(id INTEGER PRIMARY KEY)')
c.execute('INSERT INTO likes VALUES (42)')
c.commit();c.close()
PY

cat > "$fixture/bin/pnpm" <<'MOCK'
#!/usr/bin/env bash
set -eu
case "$1" in
  install) mkdir -p node_modules; cp version node_modules/runtime ;;
  build)
    [[ ! -f $TEST_FIXTURE/fail-build ]]
    mkdir -p server/dist client/dist
    cp version server/dist/index.js
    cp version client/dist/index.html
    ;;
  build:docs) mkdir -p docs/.vitepress/dist; cp version docs/.vitepress/dist/index.html ;;
  *) exit 1 ;;
esac
MOCK
cat > "$fixture/bin/pm2" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$1" >> "$TEST_FIXTURE/pm2-calls"
if [[ $1 == restart && -f $TEST_FIXTURE/fail-signal && $(cat "$FOLDERGRAM_DEPLOY_ROOT/app/version") == new ]]; then
  kill -TERM "$PPID"
fi
if [[ $1 == restart && -f $TEST_FIXTURE/fail-health && $(cat "$FOLDERGRAM_DEPLOY_ROOT/app/version") == new ]]; then
  python3 - "$FOLDERGRAM_DEPLOY_ROOT/app/data/db/gallery.sqlite" <<'PY'
import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute('ALTER TABLE likes ADD COLUMN migration_marker TEXT'); c.commit();c.close()
PY
fi
MOCK
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
if [[ -f $TEST_FIXTURE/fail-health && $(cat "$FOLDERGRAM_DEPLOY_ROOT/app/version") == new ]]; then exit 22; fi
printf '{"ok":true,"storage":{"available":true,"usingInMemoryDatabase":false}}\n'
MOCK
chmod +x "$fixture/bin/pnpm" "$fixture/bin/pm2" "$fixture/bin/curl"
export TEST_FIXTURE=$fixture
export FOLDERGRAM_DEPLOY_ROOT=$fixture/deploy
export FOLDERGRAM_DOCS_ROOT=$fixture/docs
export FOLDERGRAM_NODE_BIN=$fixture/bin
export FOLDERGRAM_HEALTH_ATTEMPTS=1
export FOLDERGRAM_HEALTH_DELAY=0

assert_state() {
  local expected=$1
  [[ $(cat "$fixture/deploy/app/version") == "$expected" ]]
  [[ $(cat "$fixture/deploy/app/server/dist/index.js") == "$expected" ]]
  [[ $(cat "$fixture/deploy/app/node_modules/runtime") == "$expected" ]]
  [[ $(cat "$fixture/docs/index.html") == "$expected" ]]
  [[ $(cat "$fixture/deploy/app/data/gallery/photo.jpg") == primary-original ]]
  [[ $(cat "$fixture/deploy/app/data/external-gallery/photo.jpg") == secondary-original ]]
  grep -q '^PUBLIC_DEMO_MODE=1$' "$fixture/deploy/app/.env"
  python3 - "$fixture/deploy/app/data/db/gallery.sqlite" "$fixture/docs" <<'PY'
import sqlite3,sys
from pathlib import Path
c=sqlite3.connect(sys.argv[1])
assert c.execute('SELECT * FROM likes').fetchall()==[(42,)]
assert c.execute('PRAGMA quick_check').fetchone()[0]=='ok'
c.close()
assert Path(sys.argv[2]).stat().st_mode & 0o005 == 0o005
assert (Path(sys.argv[2])/'index.html').stat().st_mode & 0o004
PY
}

if SSH_ORIGINAL_COMMAND='deploy v1.0.1;echo unsafe' bash "$script" > /dev/null 2>&1; then exit 1; fi
SSH_ORIGINAL_COMMAND=check bash "$script" > /dev/null
if bash "$script" v1.0.1 "$old_commit" > "$fixture/mismatch.log" 2>&1; then exit 1; fi
[[ ! -f $fixture/pm2-calls ]]
assert_state old

touch "$fixture/fail-build"
if bash "$script" v1.0.1 "$new_commit" > "$fixture/build-failure.log" 2>&1; then exit 1; fi
[[ ! -f $fixture/pm2-calls ]]
assert_state old
rm "$fixture/fail-build"

touch "$fixture/fail-signal"
if bash "$script" v1.0.1 "$new_commit" > "$fixture/signal-failure.log" 2>&1; then exit 1; fi
assert_state old
rm "$fixture/fail-signal"

touch "$fixture/fail-health"
if bash "$script" v1.0.1 "$new_commit" > "$fixture/health-failure.log" 2>&1; then exit 1; fi
assert_state old
[[ $(git -C "$fixture/deploy/app" rev-parse HEAD) == "$old_commit" ]]
rm "$fixture/fail-health"

bash "$script" v1.0.1 "$new_commit" > "$fixture/success.log" 2>&1
assert_state new
[[ $(cat "$fixture/deploy/deploy-backup/commit") == "$old_commit" ]]
[[ $(cat "$fixture/deploy/deploy-backup/app/version") == old ]]

bash "$script" v1.0.0 "$old_commit" > "$fixture/second-success.log" 2>&1
assert_state old
[[ $(cat "$fixture/deploy/deploy-backup/commit") == "$new_commit" ]]
[[ $(cat "$fixture/deploy/deploy-backup/app/version") == new ]]
[[ $(find "$fixture/deploy" -maxdepth 1 -name 'deploy-backup' | wc -l) == 1 ]]
[[ -z $(find "$fixture/deploy" -maxdepth 1 \( -name '.release.*' -o -name '.deploy-backup.*' \) -print) ]]
printf 'Deployment checks passed: tag validation, build failure, cancellation, schema rollback, persistent data, and single-backup replacement.\n'
