#!/bin/bash
# Point Tailscale Serve at toolkit (/) and keep finance (/finance). Funnel off.
# sudo /usr/local/sbin/toolkit-serve
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

# MagicDNS: toolkit.tailf7a628.ts.net (not finance.*)
tailscale set --hostname=toolkit
tailscale funnel reset || true
# Do not `serve reset` — that would drop /finance.
tailscale serve --bg --yes --https=443 --set-path=/finance http://127.0.0.1:8787
tailscale serve --bg --yes --https=443 --set-path=/ http://127.0.0.1:8000
echo
tailscale serve status
echo
echo "Funnel must stay off:"
tailscale funnel status || true
echo
echo "home:    https://toolkit.tailf7a628.ts.net/"
echo "finance: https://toolkit.tailf7a628.ts.net/finance/"
