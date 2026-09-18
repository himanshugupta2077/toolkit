#!/usr/bin/env bash
# Laptop → VPS: copy Toolkit source to ~/stage/toolkit (no secrets, no Heart catalog, no venv).
# Heart results.jsonl + media/: bash vps/push-heart.sh (separate, live dest).
# Run on the laptop from the toolkit repo. Uses the DigitalOcean key over Tailscale IPv4.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${TOOLKIT_VPS_HOST:-100.86.221.101}"
USER="${TOOLKIT_VPS_USER:-toolkit}"
KEY="${TOOLKIT_VPS_KEY:-$HOME/.ssh/DigitalOcean_droplet}"
DEST="${USER}@${HOST}:~/stage/toolkit/"

if [[ ! -f $ROOT/server.py ]]; then
  echo "run from the toolkit repo (missing server.py)" >&2
  exit 1
fi

ssh_opts=(
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o ProxyCommand=none
  -i "$KEY"
)

echo "rsync $ROOT → $DEST"
ssh "${ssh_opts[@]}" "${USER}@${HOST}" 'mkdir -p ~/stage/toolkit ~/bin'
rsync -az --delete \
  -e "ssh ${ssh_opts[*]}" \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'data/' \
  --exclude 'whisper/.venv/' \
  --exclude 'heart/media/' \
  --exclude 'heart/results.jsonl' \
  --exclude 'node_modules/' \
  --exclude 'finance/app/node_modules/' \
  --exclude 'finance/app/data/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '*.xlsx' \
  "$ROOT/" "$DEST"

echo
echo "staged. On the VPS (sudo password):"
echo "  sudo /home/toolkit/stage/toolkit/vps/bootstrap-toolkit.sh"
echo "  # later deploys:"
echo "  sudo toolkit-deploy && sudo toolkit-serve"
echo
echo "Paste keys into /etc/toolkit.env if bootstrap just created it:"
echo "  sudo nano /etc/toolkit.env"
echo "  sudo systemctl restart toolkit"
