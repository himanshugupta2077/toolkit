#!/usr/bin/env bash
# Hourly VACUUM INTO + age-encrypted push to a private GitHub repo.
# Installed on the VPS. Secrets live in /etc/finance-backup.env (mode 600).
set -euo pipefail

ENV_FILE="${FINANCE_BACKUP_ENV:-/etc/finance-backup.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

DB="${FINANCE_DB:-/var/lib/finance/finance.sqlite}"
REPO_DIR="${FINANCE_BACKUP_GIT_DIR:-/var/lib/finance/github-backup}"
AGE_RECIPIENT="${FINANCE_BACKUP_AGE_RECIPIENT:-}"
SSH_KEY="${FINANCE_BACKUP_SSH_KEY:-/etc/finance-backup-deploy}"
AGE_BIN="${AGE_BIN:-age}"
LOCK="${FINANCE_BACKUP_LOCK:-/var/lib/finance/github-backup.lock}"

if [[ ! -f "$DB" ]]; then
  echo "no db yet: $DB" >&2
  exit 0
fi
if [[ -z "$AGE_RECIPIENT" ]]; then
  echo "FINANCE_BACKUP_AGE_RECIPIENT is not set" >&2
  exit 1
fi
if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "backup git dir missing: $REPO_DIR" >&2
  exit 1
fi

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "backup already running" >&2
  exit 0
fi

tmp="$(mktemp /tmp/finance-hourly.XXXXXX.sqlite)"
rm -f "$tmp"
trap 'rm -f "$tmp"' EXIT

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required" >&2
  exit 1
fi
sqlite3 "$DB" "VACUUM INTO '$tmp'"

umask 077
"$AGE_BIN" -r "$AGE_RECIPIENT" -o "$REPO_DIR/finance.sqlite.age" "$tmp"
rm -f "$tmp"
trap - EXIT

known="${FINANCE_BACKUP_KNOWN_HOSTS:-/var/lib/finance/.ssh/known_hosts}"
mkdir -p "$(dirname "$known")"
export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$known"
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-finance-vps}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-finance-backup@localhost}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

cd "$REPO_DIR"
git_ok=(git -c "safe.directory=$REPO_DIR")
"${git_ok[@]}" add finance.sqlite.age
if "${git_ok[@]}" diff --cached --quiet; then
  echo "no change"
  exit 0
fi
"${git_ok[@]}" commit -m "hourly $(date -u +%Y-%m-%dT%H:%M:%SZ)"
"${git_ok[@]}" push origin HEAD:main
echo "pushed"
