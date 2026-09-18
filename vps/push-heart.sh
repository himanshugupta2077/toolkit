#!/usr/bin/env bash
# Laptop → VPS: copy the Heart catalog (gitignored results.jsonl + media/).
# Code deploys skip this on purpose; run this when /heart is empty or media changed.
# Resume-safe. No sudo. Live dest is /opt/toolkit/heart (what server.py reads).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${TOOLKIT_VPS_HOST:-100.86.221.101}"
USER="${TOOLKIT_VPS_USER:-toolkit}"
KEY="${TOOLKIT_VPS_KEY:-$HOME/.ssh/DigitalOcean_droplet}"
DEST_DIR="/opt/toolkit/heart"
RESULTS="$ROOT/heart/results.jsonl"
MEDIA="$ROOT/heart/media"

if [[ ! -f $ROOT/server.py ]]; then
  echo "run from the toolkit repo (missing server.py)" >&2
  exit 1
fi
if [[ ! -f $RESULTS ]]; then
  echo "missing $RESULTS" >&2
  exit 1
fi
if [[ ! -d $MEDIA ]]; then
  echo "missing $MEDIA" >&2
  exit 1
fi

ssh_opts=(
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o ProxyCommand=none
  -i "$KEY"
)

need=$(du -sb "$RESULTS" "$MEDIA" | awk '{s+=$1} END {print s}')
echo "rsync heart catalog → ${USER}@${HOST}:${DEST_DIR}/  ($(numfmt --to=iec --suffix=B "$need"))"

ssh "${ssh_opts[@]}" "${USER}@${HOST}" "mkdir -p '$DEST_DIR'"
free=$(ssh "${ssh_opts[@]}" "${USER}@${HOST}" "df -B1 --output=avail '$DEST_DIR' | tail -1" | tr -d ' ')
headroom=$((1500 * 1024 * 1024))
if [[ -z $free || $free -lt $((need + headroom)) ]]; then
  echo "not enough disk on VPS: need $need + ${headroom}B free, have ${free:-unknown}" >&2
  exit 1
fi
echo "vps free before copy: $(numfmt --to=iec --suffix=B "$free")"

echo "1/2 results.jsonl"
rsync -a --partial \
  -e "ssh ${ssh_opts[*]}" \
  "$RESULTS" \
  "${USER}@${HOST}:${DEST_DIR}/results.jsonl"

echo "2/2 media/ (long)"
rsync -a --partial --info=stats2 \
  -e "ssh ${ssh_opts[*]}" \
  "$MEDIA/" \
  "${USER}@${HOST}:${DEST_DIR}/media/"

echo
echo "copied. Catalog is live at /heart (no restart). Verify on the VPS:"
echo "  curl -sS http://127.0.0.1:8000/api/heart/catalog | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[\"total\"], d[\"analyzed\"])'"
echo "Later updates: bash vps/push-heart.sh"
echo "Code deploys (push-stage / toolkit-deploy) still skip this tree."
