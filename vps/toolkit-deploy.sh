#!/bin/bash
# Copy staged code to /opt/toolkit and restart the unit. Does not touch /etc/toolkit.env
# or /var/lib/toolkit. sudo /usr/local/sbin/toolkit-deploy
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

STAGE=/home/toolkit/stage/toolkit
LIVE=/opt/toolkit

if [[ ! -f $STAGE/server.py ]]; then
  echo "missing $STAGE/server.py — rsync the stage first" >&2
  exit 1
fi

install -d -m 0755 -o toolkit -g toolkit "$LIVE"
# New deps (e.g. webauthn) before swapping code, so a failed pip leaves the old process up.
if [[ -x $LIVE/.venv/bin/pip ]]; then
  sudo -u toolkit "$LIVE/.venv/bin/pip" install -q -r "$STAGE/vps/requirements-vps.txt"
fi
install -m 0755 "$STAGE/vps/toolkit-deploy.sh" /usr/local/sbin/toolkit-deploy
rsync -a --delete \
  --exclude '.venv/' \
  --exclude 'data/' \
  --exclude 'heart/media/' \
  --exclude 'heart/results.jsonl' \
  --exclude '.git/' \
  --exclude '.env' \
  "$STAGE/" "$LIVE/"
chown -R toolkit:toolkit "$LIVE"
# venv stays; recreate only if missing
if [[ ! -x $LIVE/.venv/bin/python ]]; then
  echo "missing $LIVE/.venv — run bootstrap-toolkit.sh first" >&2
  exit 1
fi

systemctl restart toolkit.service

ok=0
for _ in $(seq 1 30); do
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
echo "listening on 127.0.0.1:8000"
