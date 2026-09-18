#!/bin/bash
# Run on the VPS as: sudo /home/toolkit/stage/bootstrap-finance.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

STAGE=/home/toolkit/stage
SRC="$STAGE/finance"
DB_SRC="$STAGE/finance.sqlite"
LIVE=/var/lib/finance/finance.sqlite

if [[ ! -f $SRC/dist-server/server/index.js ]]; then
  echo "missing $SRC/dist-server/server/index.js — rsync the stage first" >&2
  exit 1
fi

ensure_kv() {
  local file=$1 key=$2 val=$3
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

if [[ ! -f /etc/finance.env ]]; then
  echo "missing /etc/finance.env" >&2
  exit 1
fi
ensure_kv /etc/finance.env HOST 127.0.0.1
ensure_kv /etc/finance.env PORT 8787
ensure_kv /etc/finance.env SERVE_UI 1
ensure_kv /etc/finance.env NODE_ENV production
ensure_kv /etc/finance.env FINANCE_REQUIRE_TAILSCALE 1
ensure_kv /etc/finance.env FINANCE_DB /var/lib/finance/finance.sqlite
ensure_kv /etc/finance.env FINANCE_BACKUP_DIR /var/lib/finance/backup
sed -i '/^FINANCE_ALLOW_UNAUTH=/d' /etc/finance.env

install -d -m 0750 -o finance -g finance /var/lib/finance /var/lib/finance/backup
if [[ ! -f $LIVE ]]; then
  if [[ ! -f $DB_SRC ]]; then
    echo "missing first sqlite at $DB_SRC" >&2
    exit 1
  fi
  install -o finance -g finance -m 0600 "$DB_SRC" "$LIVE"
  echo "installed live db $LIVE"
else
  echo "live db already exists, not overwriting"
fi

/usr/local/sbin/finance-deploy

if [[ -x $STAGE/vps-helpers/age ]]; then
  install -m 0755 "$STAGE/vps-helpers/age" /usr/local/bin/age
fi
install -m 0755 "$STAGE/vps-helpers/hourly-github-backup.sh" /usr/local/sbin/finance-github-backup
install -m 0644 "$STAGE/vps-helpers/finance-github-backup.service" /etc/systemd/system/finance-github-backup.service
install -m 0644 "$STAGE/vps-helpers/finance-github-backup.timer" /etc/systemd/system/finance-github-backup.timer
install -o finance -g finance -m 0400 "$STAGE/vps-helpers/github-backup-deploy" /etc/finance-backup-deploy
install -d -m 0700 -o finance -g finance /var/lib/finance/.ssh /var/lib/finance/github-backup
install -o root -g finance -m 0640 /dev/null /etc/finance-backup.env
cat > /etc/finance-backup.env << 'EOF'
FINANCE_DB=/var/lib/finance/finance.sqlite
FINANCE_BACKUP_GIT_DIR=/var/lib/finance/github-backup
FINANCE_BACKUP_AGE_RECIPIENT=age13e3076guzszh5km5gt3vs58hjaae7xnrvhpekuen8wvvfqyxks2qch0w82
FINANCE_BACKUP_SSH_KEY=/etc/finance-backup-deploy
AGE_BIN=/usr/local/bin/age
GIT_AUTHOR_NAME=finance-vps
GIT_AUTHOR_EMAIL=finance-backup@localhost
EOF
chmod 0640 /etc/finance-backup.env
chown root:finance /etc/finance-backup.env

if [[ ! -d /var/lib/finance/github-backup/.git ]]; then
  runuser -u finance -- env \
    GIT_SSH_COMMAND="ssh -i /etc/finance-backup-deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/var/lib/finance/.ssh/known_hosts" \
    git clone git@github.com:himanshugupta2077/finance-db-backup.git /var/lib/finance/github-backup
fi

systemctl daemon-reload
systemctl enable --now finance-github-backup.timer
chown -R finance:finance /var/lib/finance
runuser -u finance -- env HOME=/var/lib/finance \
  git config --global --add safe.directory /var/lib/finance/github-backup || true
runuser -u finance -- /usr/local/sbin/finance-github-backup || true

ok=0
for _ in $(seq 1 30); do
  if ss -lnt | grep -q '127.0.0.1:8787'; then
    ok=1
    break
  fi
  sleep 0.4
done
if [[ $ok -ne 1 ]]; then
  echo "finance.service did not bind 127.0.0.1:8787" >&2
  systemctl --no-pager --full status finance.service || true
  journalctl -u finance -n 80 --no-pager || true
  exit 1
fi
tailscale serve reset || true
tailscale funnel reset || true
tailscale serve --bg --yes --https=443 --set-path=/finance http://127.0.0.1:8787
if ss -lnt | grep -q '127.0.0.1:8000'; then
  tailscale serve --bg --yes --https=443 --set-path=/ http://127.0.0.1:8000
fi
tailscale serve status
echo
echo "Funnel must stay off:"
tailscale funnel status || true

echo
echo "app: https://toolkit.tailf7a628.ts.net/finance/"
echo "decrypt backups on the laptop:"
echo "  age -d -i ~/.config/finance/backup.agekey -o finance.sqlite finance.sqlite.age"
