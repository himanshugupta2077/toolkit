#!/usr/bin/env bash
# Start the Audio Notes server (replaces: python -m http.server 8000)
set -euo pipefail
cd "$(dirname "$0")"

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

# Finance phone form → data/finance/entries.jsonl + Documents/Finance/Finance-Mng-V2.xlsx Ledger
# export FINANCE_TZ=Asia/Kolkata
# export FINANCE_WORKBOOK='/absolute/path/to/other.xlsx'  # optional override of default

# Voice → DeepSeek → Ledger (Update ledger toggle / Finance mic). Thinking disabled.
# export DEEPSEEK_API_KEY='sk-...'
# export DEEPSEEK_MODEL='deepseek-v4-flash'   # default
# export DEEPSEEK_BASE_URL='https://api.deepseek.com'

# Colored [upload]/[ffmpeg]/[whisper]… tags (app_log.py). Disable: APP_LOG_COLOR=0 or NO_COLOR=1
# export APP_LOG_COLOR=1
# Optional: put key in a gitignored local file and source it:
if [[ -f ./.env ]]; then
  # shellcheck disable=SC1091
  set -a
  source ./.env
  set +a
fi

echo "Starting Home Apps on ${HOST}:${PORT}"
echo "Finance → local log + xlsx Ledger (/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx)"
if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "Finance AI → DeepSeek ${DEEPSEEK_MODEL:-deepseek-v4-flash} (thinking off)"
  echo "Food AI → same key (meal composition; skipped once the kitchen knows the food)"
else
  echo "Finance AI → disabled (set DEEPSEEK_API_KEY for Update ledger)"
  echo "Food AI → disabled (set DEEPSEEK_API_KEY to profile new meals)"
fi
echo "Then in another terminal (if not already running):"
echo "  sudo tailscale serve ${PORT}"
echo "Open on phone: https://msi.tailf7a628.ts.net/"
exec python server.py
