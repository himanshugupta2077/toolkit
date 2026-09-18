#!/bin/bash
# First-time Toolkit install next to the existing finance.service.
# sudo /home/toolkit/stage/toolkit/vps/bootstrap-toolkit.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

STAGE=/home/toolkit/stage/toolkit
LIVE=/opt/toolkit
DATA=/var/lib/toolkit
ENV=/etc/toolkit.env

if [[ ! -f $STAGE/server.py ]]; then
  echo "missing $STAGE/server.py — from the laptop run: bash vps/push-stage.sh" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip ffmpeg

install -d -m 0755 -o toolkit -g toolkit "$LIVE"
install -d -m 0750 -o toolkit -g toolkit "$DATA"

if [[ ! -f $ENV ]]; then
  if [[ -f $STAGE/vps/env.vps.sample ]]; then
    install -o root -g toolkit -m 0640 "$STAGE/vps/env.vps.sample" "$ENV"
    echo "wrote $ENV from sample — paste OPENAI_API_KEY and DEEPSEEK_API_KEY before relying on cloud AI"
  else
    echo "missing $STAGE/vps/env.vps.sample" >&2
    exit 1
  fi
fi

# Keep bind/profile even if the sample was copied earlier
ensure_kv() {
  local file=$1 key=$2 val=$3
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}
ensure_kv "$ENV" HOST 127.0.0.1
ensure_kv "$ENV" PORT 8000
ensure_kv "$ENV" TOOLKIT_PROFILE vps
ensure_kv "$ENV" TOOLKIT_REQUIRE_LOOPBACK 1
ensure_kv "$ENV" TOOLKIT_STT cloud
ensure_kv "$ENV" TOOLKIT_DATA "$DATA"
ensure_kv "$ENV" FINANCE_OS 0
ensure_kv "$ENV" FINANCE_OS_PORT 8787
ensure_kv "$ENV" TAILSCALE_SERVE 0
chmod 0640 "$ENV"
chown root:toolkit "$ENV"

rsync -a --delete \
  --exclude '.venv/' \
  --exclude 'data/' \
  --exclude 'heart/media/' \
  --exclude 'heart/results.jsonl' \
  --exclude '.git/' \
  --exclude '.env' \
  "$STAGE/" "$LIVE/"
chown -R toolkit:toolkit "$LIVE"

if [[ ! -x $LIVE/.venv/bin/python ]]; then
  sudo -u toolkit python3 -m venv "$LIVE/.venv"
fi
sudo -u toolkit "$LIVE/.venv/bin/pip" install -U pip
sudo -u toolkit "$LIVE/.venv/bin/pip" install -r "$LIVE/vps/requirements-vps.txt"

install -m 0755 "$STAGE/vps/toolkit-deploy.sh" /usr/local/sbin/toolkit-deploy
install -m 0755 "$STAGE/vps/toolkit-serve.sh" /usr/local/sbin/toolkit-serve
install -d -m 0755 -o toolkit -g toolkit /home/toolkit/bin
install -m 0755 "$STAGE/vps/toolkit-check.sh" /home/toolkit/bin/toolkit-check.sh
chown toolkit:toolkit /home/toolkit/bin/toolkit-check.sh
install -m 0644 "$STAGE/vps/toolkit.service" /etc/systemd/system/toolkit.service
if [[ -f $STAGE/vps/AGENTS.md ]]; then
  install -m 0644 "$STAGE/vps/AGENTS.md" /home/toolkit/AGENTS-TOOLKIT.md
  chown toolkit:toolkit /home/toolkit/AGENTS-TOOLKIT.md
fi

systemctl daemon-reload
systemctl enable --now toolkit.service

ok=0
for _ in $(seq 1 40); do
  if ss -lnt | grep -q '127.0.0.1:8000'; then
    ok=1
    break
  fi
  sleep 0.4
done
if [[ $ok -ne 1 ]]; then
  echo "toolkit.service did not bind 127.0.0.1:8000" >&2
  systemctl --no-pager --full status toolkit.service || true
  journalctl -u toolkit -n 80 --no-pager || true
  exit 1
fi

/usr/local/sbin/toolkit-serve

echo
echo "home:    https://toolkit.tailf7a628.ts.net/"
echo "finance: https://toolkit.tailf7a628.ts.net/finance/ (unchanged Node unit)"
echo "restart: sudo systemctl restart toolkit"
echo "stop:    sudo systemctl stop toolkit"
echo "env:     sudo nano /etc/toolkit.env   then   sudo systemctl restart toolkit"
