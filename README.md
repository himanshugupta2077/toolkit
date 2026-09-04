# Audio Notes over Tailscale

Personal **phone → laptop** audio notes app.

Record speech on your phone (or desktop), upload it securely over your **Tailscale** network, convert it to clean audio on the laptop, run **Faster Whisper** (GPU), and save a transcript as a note you can browse later.

---

## What this is

| Piece | Role |
|--------|------|
| Phone / browser | UI: record mic audio, pick model, toggle translate, list notes |
| Tailscale Serve | HTTPS on your tailnet so the phone can open the app + use the mic |
| `server.py` | FastAPI: static UI + upload API + ffmpeg convert + Whisper + note storage |
| `faster-whisper` | Local speech-to-text on the laptop (default: CUDA / RTX 3060) |
| `data/` | All recordings + transcripts stay on **your machine** |

This is **not** a public cloud service. Traffic stays on your Tailscale network. Audio and notes are files under `data/` on the laptop.

---

## Features

### Web app
- **Home** — two symbol tiles (🎙 notes · ₹ finance)
- **Audio Notes** — big record / stop button, timer, level meter
- **Update ledger** switch on the recorder — after Whisper, DeepSeek fills **one Ledger row**
- **Finance mic** (header) — opens recorder with Update ledger already on
- **Safe recording** — MediaRecorder chunks checkpointed to IndexedDB every second
- **Upload progress** — XHR progress bar while sending audio to the laptop
- **Model picker** — `tiny` · `base` · `small` · `medium` · `large-v3`
- **Translate toggle**
  - **Off (default):** transcribe *what you said* (English / Hindi / Hinglish as spoken)
  - **On:** Whisper `translate` task → English text
- **Saved Notes** — list, open, play original audio, copy transcript, delete
- **Re-transcribe** — re-run the same saved audio with a different model / translate mode
- Preferences remembered in the browser (`localStorage`)

### Server pipeline
1. Accept browser audio (usually `.webm` Opus from Chrome)
2. **Atomic save** of original file under `data/audio/`
3. **ffmpeg** convert → **16 kHz mono PCM WAV** (Whisper’s preferred input)
   - Light loudness normalization for quiet phone mics
4. Run **faster-whisper** (`transcribe` or `translate`)
5. Save note as JSON + plain `.txt` under `data/notes/`
6. Return transcript to the web UI

Original browser audio is kept even if transcription fails.

---

## AI agent rules

See **[AGENTS.md](./AGENTS.md)** — especially finance sheet updates:

- surgical edits only on `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx`
- no full dashboard rebuild (`build_workbook.py --patch-live`) unless explicitly requested

## Project layout

```
tailscale-stuff/
├── README.md                 ← this file
├── AGENTS.md                 ← AI rules (surgical finance sheet updates, etc.)
├── index.html                ← full web app (UI + recorder + notes + finance)
├── server.py                 ← FastAPI backend
├── app_log.py                ← colored terminal tags + activity JSONL log
├── run.sh                    ← start server with whisper venv + env defaults
├── finance/
│   ├── sync.py               ← Ledger append + JSONL (source=manual|ai)
│   ├── ai_parse.py           ← DeepSeek voice/text → entry JSON
│   ├── ai_docs/              ← model reference (sheet + task + examples)
│   └── (blank template only; live book is under Documents/Finance/)
├── data/
│   ├── audio/                ← original uploads (.webm/…) + converted (.wav)
│   ├── notes/                ← {id}.json metadata + {id}.txt plain transcript
│   ├── finance/entries.jsonl ← phone/AI entry log
│   └── logs/activity.jsonl   ← pipeline activity (upload/ffmpeg/whisper/finance…)
└── whisper/
    ├── transcribe.py         ← standalone CLI (original simple script)
    └── .venv/                ← Python env: faster-whisper, fastapi, openai, etc.
```

### Finance AI (DeepSeek)

```bash
export DEEPSEEK_API_KEY='sk-...'   # or put in .env (gitignored)
./run.sh
```

- Model: `deepseek-v4-flash`, thinking **disabled**
- Ledger **Source** column: `manual` (form) / `ai` (voice path)
- See `finance/README.md` and `finance/ai_docs/`

---

## Requirements

### Laptop
- Arch (or any Linux) with:
  - Python 3.10+ (project uses 3.14 in the existing venv)
  - **ffmpeg** on `PATH` (`ffmpeg -version`)
  - **NVIDIA GPU + CUDA** recommended (RTX 3060 works with `device=cuda`)
  - **Tailscale** installed and logged in
- Python packages (already in `whisper/.venv` if you set it up earlier):
  - `faster-whisper`
  - `fastapi`
  - `uvicorn`
  - `python-multipart`
  - torch / CUDA stack as needed by faster-whisper

### Phone
- Tailscale app, **same tailnet** as the laptop
- Modern browser (Chrome / Safari) with mic permission
- Access to the laptop’s Tailscale HTTPS URL

### Why not `python -m http.server`?
Static `http.server` only serves files. It **cannot** accept uploads or run Whisper. Always use `server.py` / `./run.sh`.

### Why Tailscale Serve (HTTPS)?
Browser microphone APIs require a **secure context** (HTTPS or localhost).  
`tailscale serve` gives you HTTPS on the tailnet, e.g.:

```text
https://msi.tailf7a628.ts.net/
```

---

## Quick start

### 1. One-time: Python env (if missing)

```bash
cd ~/project-tool-scripts-whatnot/tailscale-stuff
python -m venv whisper/.venv
source whisper/.venv/bin/activate
pip install faster-whisper fastapi uvicorn python-multipart
# GPU stack: follow faster-whisper / PyTorch docs for your CUDA version
```

Confirm ffmpeg:

```bash
ffmpeg -version
```

### 2. Start the Audio Notes server

```bash
cd ~/project-tool-scripts-whatnot/tailscale-stuff
./run.sh
```

Defaults:
- Host `0.0.0.0`, port **8000**
- Model **medium**
- Device **cuda**
- Preload default model in background

You should see logs like:

```text
Audio Notes server → http://0.0.0.0:8000
Data directory     → …/data
Whisper            → medium on cuda
```

### 3. Expose over Tailscale (second terminal)

```bash
sudo tailscale serve 8000
```

Leave both processes running.

Example serve output:

```text
Available within your tailnet:
https://msi.tailf7a628.ts.net/
|-- proxy http://127.0.0.1:8000
```

Your hostname may differ (`tailscale status`).

### 4. Open on the phone

1. Phone on Tailscale (same account / tailnet)
2. Browser → `https://<your-machine>.tail….ts.net/`
3. Badge should say **Mobile**
4. Allow microphone when prompted

### 5. Record a note

1. **Audio Notes**
2. Optional title
3. Pick **Whisper model** (e.g. medium)
4. Leave **Translate to English** off for Hinglish / as-spoken
5. Tap the red button → speak → tap again to stop
6. **Upload & transcribe**
7. Wait for convert + Whisper → transcript appears
8. Later: **Saved Notes**

---

## Everyday usage

### As-spoken (default — recommended for you)

- Translate: **Off**
- Whisper writes what it hears (English words English; Hindi often Devanagari; mixed = mixed)
- This matches the spirit of the original `whisper/transcribe.py` CLI

### English translation mode

- Translate: **On**
- Whisper task = `translate` → English text from other languages  
- Use when you *want* translation, not when you want a faithful Hinglish transcript

### Re-transcribe an old note

Open a saved note → change model / translate → **Re-transcribe with these settings**.  
Uses the original audio on disk; no re-recording.

### Delete

Note detail → **Delete** removes JSON, TXT, original audio, and converted WAV (when present).

---

## Whisper models

Quality roughly:

```text
tiny < base < small < medium < large-v3
```

| Model | Rough tradeoff |
|--------|----------------|
| `tiny` | Fastest, weakest accuracy |
| `base` | Fast, OK for short clear speech |
| `small` | Good balance |
| `medium` | **Default** — better accuracy; fine on RTX 3060 |
| `large-v3` | Best quality; slowest; most VRAM |

**`base` is not better than `small`.** Bigger models (further right) are generally better and slower.

First use of a model downloads weights (Hugging Face). Later loads are local.  
The server keeps **one** model in memory while a job is running. After the job, it
**releases the GPU** after a short keep-alive window so local LLMs (or anything else)
can use VRAM. Switching models also unloads the previous one first.

### GPU sharing (Whisper ↔ local AI)

| Behavior | How |
|----------|-----|
| Fast while recording/transcribing | Job uses CUDA as before |
| Back-to-back notes stay warm | Default `WHISPER_KEEP_ALIVE_SEC=45` — model stays loaded briefly |
| Free GPU for a local 3B–10B model | After idle keep-alive, Whisper unloads + `empty_cache` |
| Free GPU **right now** | `POST /api/whisper/unload` (or set keep-alive to `0`) |

---

## Environment variables

Set when starting the server (or export before `./run.sh`):

| Variable | Default | Meaning |
|----------|---------|---------|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8000` | HTTP port (must match `tailscale serve`) |
| `WHISPER_MODEL` | `medium` | Default model if UI doesn’t send one |
| `WHISPER_DEVICE` | `cuda` | `cuda` or `cpu` |
| `WHISPER_COMPUTE` | *(auto)* | Pin CTranslate2 compute type; empty = VRAM-safe ladder per model |
| `WHISPER_LANGUAGE` | *(empty)* | Force source language (`en`, `hi`, …). Empty = auto-detect. Prefer empty for Hinglish |
| `WHISPER_PRELOAD` | `0` | `1` = load default model at startup; `0` = load on first note (doesn’t hog GPU at boot) |
| `WHISPER_KEEP_ALIVE_SEC` | `45` | Seconds to keep model warm after a job. `0` = unload immediately. Negative = never auto-unload |

Examples:

```bash
# CPU only
WHISPER_DEVICE=cpu ./run.sh

# Faster default model
WHISPER_MODEL=small ./run.sh

# Free GPU immediately after every note (local LLM always has room)
WHISPER_KEEP_ALIVE_SEC=0 ./run.sh

# Old behavior: keep Whisper on GPU forever
WHISPER_KEEP_ALIVE_SEC=-1 WHISPER_PRELOAD=1 ./run.sh

# Different port
PORT=9000 ./run.sh
# then: sudo tailscale serve 9000
```

Per-request **model** and **translate** from the UI override the default model / task.  
`WHISPER_LANGUAGE` still applies as a global language lock if set (usually leave unset).

---

## Data on disk

### Audio — `data/audio/`

| File | Meaning |
|------|---------|
| `{note_id}.webm` (or `.m4a`, …) | Original browser upload (kept for playback + re-run) |
| `{note_id}.wav` | 16 kHz mono PCM used by Whisper |

### Notes — `data/notes/`

| File | Meaning |
|------|---------|
| `{note_id}.json` | Full metadata: transcript, segments, model, task, timing, … |
| `{note_id}.txt` | Human-readable title + transcript |

Example JSON fields:

```json
{
  "id": "99f2cade56c5",
  "title": "Note 2026-08-04 15:30",
  "created_at": "2026-08-04T15:30:00+00:00",
  "status": "ready",
  "audio_file": "99f2cade56c5.webm",
  "wav_file": "99f2cade56c5.wav",
  "transcript": "…",
  "language": "hi",
  "model": "medium",
  "task": "transcribe",
  "translate": false,
  "processing_seconds": 2.4,
  "segments": [{ "start": 0.0, "end": 3.2, "text": "…" }]
}
```

Backup = copy `data/`. Nothing is sent to a third-party API by this app.

---

## How recording safety works

### On the phone
1. `getUserMedia` captures mic (echo cancel / noise suppress / auto gain)
2. `MediaRecorder` at ~128 kbps, preferably Opus in WebM
3. Every **1 second**, a chunk is written to **IndexedDB** (draft recovery if the tab dies mid-record)
4. On stop, final blob is assembled for upload
5. Leaving the page while recording triggers a browser “are you sure?” warning

### On the laptop
1. Upload written with **temp file + fsync + rename** (atomic)
2. ffmpeg conversion to WAV (retry without loudnorm if needed)
3. Whisper runs only on the WAV
4. Note JSON / TXT written atomically
5. If Whisper crashes, original audio remains in `data/audio/`

---

## Why WebM is converted

Chrome often produces WebM/Opus with:
- Missing duration metadata (`Duration: N/A`)
- 48 kHz Opus instead of Whisper’s comfortable 16 kHz mono PCM

Feeding raw `.webm` to Whisper can yield poor / truncated transcripts.  
The server always runs:

```text
browser audio → ffmpeg → 16 kHz mono WAV → faster-whisper
```

---

## HTTP API

Base URL when local: `http://127.0.0.1:8000`  
On phone: `https://<tailscale-host>/`

### `GET /`

Serves `index.html`.

### `GET /api/health`

```json
{
  "ok": true,
  "whisper_model": "medium",
  "whisper_device": "cuda",
  "loaded_model": "medium",
  "available_models": ["tiny", "base", "small", "medium", "large-v3"],
  "notes_count": 5
}
```

### `GET /api/options`

UI defaults and model labels for the dropdown.

### `GET /api/notes`

```json
{ "notes": [ /* newest first */ ] }
```

### `GET /api/notes/{id}`

Single note JSON.

### `POST /api/notes` (multipart form)

| Field | Type | Description |
|-------|------|-------------|
| `audio` | file | Required recording blob |
| `title` | string | Optional |
| `model` | string | `tiny`…`large-v3` |
| `translate` | string | `true` / `false` |
| `client_id` | string | Optional browser id |

Response: full note object (includes `transcript`).

### `POST /api/notes/{id}/retranscribe` (multipart form)

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Model to load for this run |
| `translate` | string | `true` / `false` |

Reuses existing `audio_file` on disk.

### `DELETE /api/notes/{id}`

Deletes note + audio files.

### `GET /api/audio/{filename}`

Streams a file from `data/audio/` (playback in UI). Path traversal blocked.

---

## Curl examples

```bash
# Health
curl -s http://127.0.0.1:8000/api/health | jq

# Upload a local file as a note
curl -s -X POST http://127.0.0.1:8000/api/notes \
  -F "audio=@whisper/audio.mp3" \
  -F "title=CLI test" \
  -F "model=medium" \
  -F "translate=false" | jq

# Re-transcribe with translation ON
curl -s -X POST http://127.0.0.1:8000/api/notes/NOTE_ID/retranscribe \
  -F "model=medium" \
  -F "translate=true" | jq

# List notes
curl -s http://127.0.0.1:8000/api/notes | jq
```

---

## Standalone CLI (original script)

Unchanged simple path for files already on disk:

```bash
cd ~/project-tool-scripts-whatnot/tailscale-stuff
source whisper/.venv/bin/activate
python whisper/transcribe.py -i whisper/audio.mp3 -m medium
# CPU:
python whisper/transcribe.py -i whisper/audio.mp3 -m base --cpu
```

The web app does **not** call this script; it uses the same library (`faster-whisper`) inside `server.py`, plus ffmpeg convert + note storage.

---

## Architecture (end-to-end)

```text
┌─────────────────┐     Tailscale HTTPS      ┌──────────────────────────┐
│  Phone browser  │ ───────────────────────► │  laptop: tailscale serve │
│  index.html     │                          │  :443 → 127.0.0.1:8000   │
│  MediaRecorder  │                          └────────────┬─────────────┘
└────────┬────────┘                                       │
         │ upload .webm                                   ▼
         │                              ┌──────────────────────────────┐
         └─────────────────────────────►│  server.py (FastAPI/uvicorn) │
                                        │  POST /api/notes             │
                                        └──────────────┬───────────────┘
                                                       │
                         1. save data/audio/{id}.webm  │
                         2. ffmpeg → {id}.wav          │
                         3. faster-whisper             │
                         4. save data/notes/{id}.json  │
                                                       ▼
                                        ┌──────────────────────────────┐
                                        │  RTX 3060 / CUDA (or CPU)    │
                                        └──────────────────────────────┘
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| “Cannot reach API” | Still using `python -m http.server` | Use `./run.sh` / `server.py` |
| Mic blocked / no permission | Not HTTPS | Use Tailscale Serve URL, not bare `http://IP:8000` from phone |
| Phone can’t open site | Tailscale off / wrong network | Open Tailscale app; check `tailscale status` on both devices |
| Empty / garbage transcript on WebM | (old) raw WebM to Whisper | Ensure current `server.py` (ffmpeg → WAV) |
| Everything becomes English | Translate **On**, or old forced `language=en` | Translate **Off**; leave `WHISPER_LANGUAGE` unset |
| CUDA / OOM errors | Model too large for VRAM | UI → `small` or `base`; or `WHISPER_DEVICE=cpu` |
| First request very slow | Model download / cold load | Wait once; or `WHISPER_PRELOAD=1` / longer `WHISPER_KEEP_ALIVE_SEC` |
| `ffmpeg` convert failed | Missing ffmpeg or corrupt audio | Install ffmpeg; re-record |
| 404 favicon | Harmless | Ignore |
| Stale UI on phone | Cached `index.html` | Hard refresh / close tab |

### Useful checks

```bash
# Server alive?
curl -s http://127.0.0.1:8000/api/health

# ffmpeg OK?
ffmpeg -version

# Tailscale status
tailscale status
tailscale serve status

# GPU
nvidia-smi
```

### Inspect a recording

```bash
ffprobe data/audio/SOMEID.webm
ffprobe data/audio/SOMEID.wav
cat data/notes/SOMEID.txt
```

---

## Security notes

- App is reachable by **any device on your tailnet** that can open the Serve URL.
- There is **no login** on the web app itself — Tailscale identity is the access control.
- Do not expose port 8000 to the public internet; prefer Tailscale Serve only.
- Notes may contain sensitive speech — treat `data/` like private documents.
- This project is a personal tooling setup, not a multi-tenant product.

---

## Typical daily workflow

```bash
# Terminal 1 — laptop
cd ~/project-tool-scripts-whatnot/tailscale-stuff
./run.sh

# Terminal 2 — laptop
sudo tailscale serve 8000

# Phone
# https://msi.tailf7a628.ts.net/
# Audio Notes → record → upload → read transcript
```

Stop: **Ctrl+C** in both terminals (or stop Serve however you prefer).

---

## Configuration cheat sheet

| Goal | What to set |
|------|-------------|
| Best default quality | Model `medium`, translate off |
| Max quality | Model `large-v3` (if VRAM allows) |
| Faster notes | Model `small` or `base` |
| Hinglish as spoken | Translate **off** |
| Force English translation | Translate **on** |
| No GPU | `WHISPER_DEVICE=cpu ./run.sh` |
| Backup everything | Copy `data/` folder |
| Wipe all notes | Delete contents of `data/audio` and `data/notes` (server running optional) |

---

## Changelog (project evolution)

1. Static HTML via `python -m http.server` + Tailscale Serve  
2. Replaced with FastAPI `server.py` (upload + Whisper + notes)  
3. Mobile UI + MediaRecorder + IndexedDB draft safety  
4. ffmpeg 16 kHz WAV conversion (fixes bad WebM transcripts)  
5. Default model quality path: base → small → **medium**  
6. Removed forced English language (was translating Hinglish)  
7. UI: **model select** + **translate on/off** + re-transcribe with settings  

---

## Related files

| File | Purpose |
|------|---------|
| `server.py` | Production web + API + convert + Whisper |
| `index.html` | Entire frontend |
| `run.sh` | Convenient launcher |
| `whisper/transcribe.py` | Standalone CLI for local files |
| `data/` | Runtime storage (git-ignore if you version the repo) |

---

## License / ownership

Personal project on your machine. Use only on systems and networks you control, with audio you are allowed to process.
