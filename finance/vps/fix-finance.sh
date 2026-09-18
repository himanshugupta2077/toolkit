#!/bin/bash
# Repair after the first bootstrap: point Node at the live DB, fix git, Serve.
# sudo /home/toolkit/stage/fix-finance.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

ENV=/etc/finance.env
LIVE=/var/lib/finance/finance.sqlite
STAGE=/home/toolkit/stage

ensure_kv() {
  local file=$1 key=$2 val=$3
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

if [[ ! -f $ENV ]]; then
  echo "missing $ENV" >&2
  exit 1
fi
if [[ ! -f $LIVE ]]; then
  echo "missing live db $LIVE" >&2
  exit 1
fi

ensure_kv "$ENV" HOST 127.0.0.1
ensure_kv "$ENV" PORT 8787
ensure_kv "$ENV" SERVE_UI 1
ensure_kv "$ENV" NODE_ENV production
ensure_kv "$ENV" FINANCE_REQUIRE_TAILSCALE 1
ensure_kv "$ENV" FINANCE_DB /var/lib/finance/finance.sqlite
ensure_kv "$ENV" FINANCE_BACKUP_DIR /var/lib/finance/backup
# never enable this
sed -i '/^FINANCE_ALLOW_UNAUTH=/d' "$ENV"

echo "finance.env keys:"
grep -E '^[A-Z_]+=' "$ENV" | sed 's/=.*$/=…/' 

if [[ -f $STAGE/vps-helpers/hourly-github-backup.sh ]]; then
  install -m 0755 "$STAGE/vps-helpers/hourly-github-backup.sh" /usr/local/sbin/finance-github-backup
fi

chown -R finance:finance /var/lib/finance
chmod 0750 /var/lib/finance
chmod 0600 "$LIVE" || true
install -d -m 0700 -o finance -g finance /var/lib/finance/backup /var/lib/finance/.ssh /var/lib/finance/github-backup

runuser -u finance -- env HOME=/var/lib/finance \
  git config --global --add safe.directory /var/lib/finance/github-backup || true

systemctl restart finance.service

ok=0
for _ in $(seq 1 30); do
  if ss -lnt | grep -q '127.0.0.1:8787'; then
    ok=1
    break
  fi
  sleep 0.4
done

if [[ $ok -ne 1 ]]; then
  echo "still not listening on 127.0.0.1:8787" >&2
  systemctl --no-pager --full status finance.service || true
  journalctl -u finance -n 60 --no-pager || true
  exit 1
fi

echo "listening on 127.0.0.1:8787"
runuser -u finance -- /usr/local/sbin/finance-github-backup || true

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
echo "local health: curl -sS http://127.0.0.1:8787/api/health"
