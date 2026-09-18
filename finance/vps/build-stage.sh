#!/usr/bin/env bash
# Build a Node 22 / linux-x64 / glibc tree for the finance VPS.
# Run on the laptop. Do not npm-build on the 1 GiB droplet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../app" && pwd)"
STAGE="${1:-$HOME/stage/finance}"
NODE22_ABI=127
SQLITE_VER="$(python3 -c "import json; print(json.load(open('$ROOT/package-lock.json'))['packages']['node_modules/better-sqlite3']['version'])")"
PREBUILD="https://github.com/WiseLibs/better-sqlite3/releases/download/v${SQLITE_VER}/better-sqlite3-v${SQLITE_VER}-node-v${NODE22_ABI}-linux-x64.tar.gz"

mkdir -p "$STAGE"
chmod 700 "$STAGE"

echo "build UI + server on laptop"
(
  cd "$ROOT"
  npm run build
)

echo "stage JS + lockfile + migrations → $STAGE"
rm -rf "$STAGE/dist" "$STAGE/dist-server" "$STAGE/node_modules" "$STAGE/server"
mkdir -p "$STAGE/server/db"
cp -a "$ROOT/dist" "$ROOT/dist-server" "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/"
cp -a "$ROOT/server/db/migrations" "$STAGE/server/db/migrations"

echo "production node_modules (omit dev)"
(
  cd "$STAGE"
  npm ci --omit=dev
)

echo "swap better-sqlite3 for Node 22 linux-x64 prebuild v${SQLITE_VER}"
tmp="$(mktemp -d)"
curl -fsSL "$PREBUILD" | tar -xz -C "$tmp"
addon="$(find "$tmp" -name 'better_sqlite3.node' | head -1)"
if [[ -z "$addon" ]]; then
  echo "prebuild tarball had no .node file" >&2
  exit 1
fi
install -D -m 644 "$addon" "$STAGE/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
rm -rf "$tmp"
file "$STAGE/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

if [[ -f "$ROOT/data/finance.sqlite" ]]; then
  mkdir -p "$STAGE/../finance-data"
  (
    cd "$ROOT"
    FINANCE_DB="$ROOT/data/finance.sqlite" \
    FINANCE_BACKUP_DIR="$STAGE/../finance-data" \
      npx tsx server/db/backup.ts
  )
  latest="$(ls -1t "$STAGE/../finance-data"/finance-*.sqlite | head -1)"
  cp -a "$latest" "$STAGE/../finance-data/finance.sqlite"
  echo "db snapshot $latest"
fi

echo "stage $STAGE"
du -sh "$STAGE" "$STAGE/node_modules"
