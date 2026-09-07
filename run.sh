#!/usr/bin/env bash
# Start Toolkit + Tailscale Serve. Ctrl+C stops both (and the finance Node child).
# Invokable as `toolkit` from anywhere (symlink in ~/.local/bin).
set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}")")" && pwd)"
cd "$ROOT"

# Use the venv interpreter by path. `source activate` hardcodes the path from
# `python -m venv` creation time, so a moved checkout prepends a missing dir
# and `python` becomes system Python (no openpyxl / fastapi).
VENV_DIR="./whisper/.venv"
PYTHON="$VENV_DIR/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  echo "Missing whisper venv python at $PYTHON"
  echo "Create it and install: faster-whisper fastapi uvicorn python-multipart openpyxl"
  exit 1
fi
export VIRTUAL_ENV="$(cd "$VENV_DIR" && pwd)"
export PATH="$VIRTUAL_ENV/bin:$PATH"
# CTranslate2 dlopens libcublas.so.12 at transcribe time. Pip CUDA wheels put
# those libs under site-packages/nvidia/*/lib, which is not on the default path.
nvidia_lib_dirs=()
while IFS= read -r d; do
  nvidia_lib_dirs+=("$d")
done < <(find "$VIRTUAL_ENV/lib" -type d -path '*/site-packages/nvidia/*/lib' 2>/dev/null | sort)
if ((${#nvidia_lib_dirs[@]})); then
  extra="$(IFS=:; echo "${nvidia_lib_dirs[*]}")"
  export LD_LIBRARY_PATH="${extra}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8000}"
# Quality: tiny < base < small < medium < large-v3  (bigger = better, slower)
# medium is better than small; use WHISPER_MODEL=small if VRAM is tight
export WHISPER_MODEL="${WHISPER_MODEL:-medium}"
# cuda if you have the 3060 drivers working; set WHISPER_DEVICE=cpu to force CPU
export WHISPER_DEVICE="${WHISPER_DEVICE:-cuda}"
# Don't hog VRAM at boot (local LLMs need the GPU too). Set to 1 for faster first note.
export WHISPER_PRELOAD="${WHISPER_PRELOAD:-0}"
# Keep model warm briefly after a job so back-to-back notes stay fast, then free GPU.
# 0 = unload immediately | negative = never unload | default 45s
export WHISPER_KEEP_ALIVE_SEC="${WHISPER_KEEP_ALIVE_SEC:-45}"
# Leave unset = auto-detect (Hinglish/Hindi/English as spoken, no translation).
# Only force if you want: WHISPER_LANGUAGE=en  or  WHISPER_LANGUAGE=hi
# export WHISPER_LANGUAGE=

# New finance OS (Node) is spawned by server.py on 127.0.0.1:8787 and served at /finance.
# Disable: FINANCE_OS=0. Port: FINANCE_OS_PORT=8787.
export FINANCE_OS_PORT="${FINANCE_OS_PORT:-8787}"
# Old phone ledger form remains at /old-finance (xlsx + data/finance/entries.jsonl).
# Finance phone form → data/finance/entries.jsonl + Documents/Finance/Finance-Mng-V2.xlsx Ledger
# export FINANCE_TZ=Asia/Kolkata
# export FINANCE_WORKBOOK='/absolute/path/to/other.xlsx'  # optional override of default

# Voice → DeepSeek → Ledger (Update ledger toggle / Finance mic). Thinking disabled.
# export DEEPSEEK_API_KEY='sk-...'
# export DEEPSEEK_MODEL='deepseek-v4-flash'   # default
# export DEEPSEEK_BASE_URL='https://api.deepseek.com'

# Tailscale Serve (phone HTTPS). Disable: TAILSCALE_SERVE=0
# export TAILSCALE_SERVE=1

# Colored [upload]/[ffmpeg]/[whisper]… tags (app_log.py). Disable: APP_LOG_COLOR=0 or NO_COLOR=1
# export APP_LOG_COLOR=1
# Optional: put key in a gitignored local file and source it:
if [[ -f ./.env ]]; then
  # shellcheck disable=SC1091
  set -a
  source ./.env
  set +a
fi

FINANCE_APP="./finance/app"
if [[ "${FINANCE_OS:-1}" != "0" && -d "$FINANCE_APP" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "Warning: node not on PATH — /finance will not start"
  elif [[ ! -f "$FINANCE_APP/dist-server/server/index.js" || ! -f "$FINANCE_APP/dist/index.html" ]]; then
    echo "Building Finance OS…"
    if [[ ! -d "$FINANCE_APP/node_modules" ]]; then
      (cd "$FINANCE_APP" && npm install)
    fi
    (cd "$FINANCE_APP" && npm run build)
  fi
fi

APP_PID=""
SERVE_OWNED=0
STOP_COUNT=0
CLEANING=0

tailnet_dns() {
  local json
  json="$(tailscale status --json 2>/dev/null)" || return 0
  python3 -c '
import json, sys
d = json.loads(sys.stdin.read() or "{}")
if d.get("BackendState") != "Running":
    raise SystemExit(0)
dns = ((d.get("Self") or {}).get("DNSName") or "").strip().rstrip(".")
if dns:
    print(dns)
' <<<"$json"
}

stop_leftover_finance() {
  if [[ "${FINANCE_OS:-1}" == "0" ]]; then
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${FINANCE_OS_PORT}/tcp" >/dev/null 2>&1 || true
  fi
}

stop_serve() {
  if [[ "$SERVE_OWNED" != 1 ]]; then
    return 0
  fi
  SERVE_OWNED=0
  echo "Stopping Tailscale Serve…"
  tailscale serve reset >/dev/null 2>&1 || true
}

stop_app() {
  local sig="${1:-INT}"
  if [[ -z "$APP_PID" ]]; then
    return 0
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    APP_PID=""
    return 0
  fi
  kill "-$sig" "$APP_PID" 2>/dev/null || true
}

cleanup() {
  if [[ "$CLEANING" == 1 ]]; then
    return 0
  fi
  CLEANING=1
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    echo "Stopping Toolkit…"
    stop_app INT
    local i
    for i in $(seq 1 20); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$APP_PID" 2>/dev/null; then
      echo "Toolkit still stopping — sending SIGTERM"
      stop_app TERM
      sleep 0.6
    fi
    if kill -0 "$APP_PID" 2>/dev/null; then
      echo "Force-killing Toolkit"
      stop_app KILL
      sleep 0.2
    fi
    wait "$APP_PID" 2>/dev/null || true
    APP_PID=""
  fi
  stop_leftover_finance
  stop_serve
}

on_stop() {
  STOP_COUNT=$((STOP_COUNT + 1))
  if [[ "$STOP_COUNT" -ge 2 ]]; then
    echo "Second Ctrl+C — force stop"
    stop_app KILL
    stop_leftover_finance
    stop_serve
    trap - INT TERM EXIT
    exit 130
  fi
  echo
  echo "Stopping Toolkit… (press again to force-kill)"
  exit 130
}

trap cleanup EXIT
trap on_stop INT
trap on_stop TERM

echo "Starting Toolkit on ${HOST}:${PORT}"
echo "  /finance      new finance app"
echo "  /old-finance  previous phone ledger → xlsx"
echo "  /food         kitchen"
echo "  /cfa          CFA tracker"
echo "Finance xlsx Ledger → /home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx"
if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "Finance AI → DeepSeek ${DEEPSEEK_MODEL:-deepseek-v4-flash} (thinking off)"
  echo "Food AI → same key (meal composition; skipped once the kitchen knows the food)"
else
  echo "Finance AI → disabled (set DEEPSEEK_API_KEY for Update ledger /old-finance)"
  echo "Food AI → disabled (set DEEPSEEK_API_KEY to profile new meals)"
fi

PHONE_URL=""
if [[ "${TAILSCALE_SERVE:-1}" == "0" ]]; then
  echo "Tailscale Serve → skipped (TAILSCALE_SERVE=0)"
elif ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale Serve → skipped (tailscale not on PATH)"
else
  DNS="$(tailnet_dns || true)"
  if [[ -z "$DNS" ]]; then
    echo "Tailscale Serve → skipped (tailscale is not running / not logged in)"
    echo "  Open the Tailscale app on this machine, then re-run ./run.sh"
  else
    if tailscale serve --bg --yes "${PORT}"; then
      SERVE_OWNED=1
      PHONE_URL="https://${DNS}"
      export TOOLKIT_PUBLIC_URL="$PHONE_URL"
      echo "Tailscale Serve → ${PHONE_URL}/  (this machine, HTTPS on your tailnet)"
    else
      echo "Tailscale Serve → failed (app still on http://127.0.0.1:${PORT}/)"
    fi
  fi
fi

echo "Local            → http://127.0.0.1:${PORT}/"
if [[ -n "$PHONE_URL" ]]; then
  echo "Phone            → ${PHONE_URL}/"
  echo "  Finance          ${PHONE_URL}/finance"
  echo "  Old finance      ${PHONE_URL}/old-finance"
  echo "  Food             ${PHONE_URL}/food"
  echo "  CFA              ${PHONE_URL}/cfa"
fi

# New session so the terminal Ctrl+C hits this script once; we then signal Python.
setsid "$PYTHON" server.py < /dev/null &
APP_PID=$!

status=0
wait "$APP_PID" || status=$?
APP_PID=""
exit "$status"
