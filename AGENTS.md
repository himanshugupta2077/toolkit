# Toolkit — AI operating manual

This file is for an AI that will **manage and change this repo**. Read it before editing. Human setup and feature docs: `README.md`. Finance sheet details: `finance/README.md` and `finance/ai_docs/`.

Repo: private `himanshugupta2077/toolkit`.  
Local path: `/home/himanshu/Documents/project-tool-scripts-whatnot/toolkit`.

This is **not** a public product. It is Himanshu’s personal phone → laptop toolkit on Tailscale.

---

## What this is

One FastAPI process (`server.py` / `./run.sh`) serves a phone-sized PWA (`index.html`) plus a few extra pages. The phone opens `https://msi.tailf7a628.ts.net/` (Tailscale Serve → port 8000).

| App | Where | What it does |
|---|---|---|
| Home | `index.html` tiles | Launcher |
| Audio notes | `index.html` + `/api/notes` | Record → ffmpeg → Faster Whisper → `data/notes/` |
| Finance | `index.html` + `finance/` | Form / voice / receipt → **one** Ledger row |
| Food | `/food` + `food/` | Kitchen items, logs, meal plans |
| CFA | `/cfa` + `cfa/` | Study tracker (state in `data/cfa/`) |
| AI usage | `index.html` + `ai_usage.py` | Token/cost log in `data/ai/` |
| Heart | `index.html` + `heart/` | Private locked module — leave the lock alone unless the user is changing that flow |
| Queue alerts | `/api/queue/*` | Push/SSE alerts for a local ChatGPT queue on `:3847` |

Python env: `whisper/.venv`. Start with `./run.sh` (uses that interpreter by **relative path** so a moved checkout still works).

---

## Non-negotiables

1. **Change only what was asked.** Minimal diffs. No drive-by refactors, no “while I’m here” dashboard rebuilds.
2. **Personal data stays off git.** `data/`, `whisper/.venv/`, `.env`, `heart/results.jsonl` are gitignored. Do not force-add them. Do not commit API keys, VAPID private keys, push subscriptions, receipts, audio, or notes.
3. **Live finance workbook is outside this repo:** `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx`. Surgical edits only (rules below). LibreOffice may have it open — say so if a write can fail.
4. **Do not leave a long-running server** for the user unless they asked. Prefer `./run.sh` as the command they run. Default port **8000**.
5. **Do not invent a full dashboard recreate** (`--patch-live`) for a small sheet/UI request.
6. Prefer existing modules (`finance/sync.py`, `food/store.py`, `cfa/store.py`) over new parallel write paths.

---

## Layout

```
toolkit/
├── AGENTS.md                 ← this file (AI rules)
├── README.md                 ← human setup
├── index.html                ← main PWA (home + notes + finance + heart + AI)
├── server.py                 ← FastAPI: static UI + all /api/*
├── app_log.py                ← colored tags + data/logs/activity.jsonl
├── ai_usage.py               ← DeepSeek usage log
├── run.sh                    ← start with whisper/.venv + env defaults
├── manifest.webmanifest      ← PWA name: Toolkit
├── sw.js                     ← web push / lock-screen notifications
├── finance/                  ← Ledger append, AI parse, workbook template
│   ├── sync.py               ← one-row Ledger + JSONL
│   ├── ai_parse.py           ← DeepSeek voice/text/receipt → JSON
│   ├── ai_docs/              ← model prompt docs (hot-reload on mtime)
│   ├── build_workbook.py     ← blank template, or --patch-live if asked
│   └── import_statements.py  ← bulk bank import (user-driven)
├── food/                     ← /food UI + store + meal AI
├── cfa/                      ← /cfa UI + store
├── heart/                    ← private media catalog (results.jsonl gitignored)
├── data/                     ← runtime only (gitignored)
└── whisper/
    ├── transcribe.py         ← standalone CLI (web app does not call this)
    └── .venv/                ← fastapi, faster-whisper, openpyxl, …
```

`data/` is created at runtime. Never treat it as source.

---

## How to run (when the user wants the app)

```bash
cd /home/himanshu/Documents/project-tool-scripts-whatnot/toolkit
./run.sh
```

Defaults: `HOST=0.0.0.0`, `PORT=8000`, `WHISPER_MODEL=medium`, `WHISPER_DEVICE=cuda`.  
Then (already typical): `sudo tailscale serve 8000`.

Local `.env` is sourced by `run.sh` if present (gitignored). Needed for finance/food AI: `DEEPSEEK_API_KEY`. Optional: `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_RECEIPT_MODE`, `FINANCE_WORKBOOK`, `WHISPER_*`.

Python for one-off scripts:

```bash
./whisper/.venv/bin/python finance/sync.py   # etc.
```

Do **not** use system Python. `run.sh` exists because `source whisper/.venv/bin/activate` can break after the directory is moved.

---

## Source of truth

| Concern | Source of truth |
|---|---|
| App code / UI | This git repo |
| Transaction history | **Ledger** in `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx` (+ `data/finance/entries.jsonl`) |
| Current dashboard layout / copy / charts | **Live xlsx** (until the user asks to sync Python) |
| Blank finance template / intentional full rebuild | `finance/build_workbook.py` |
| Notes, audio, receipts, food, CFA, usage | `data/` on disk (not git) |
| Heart catalog | `heart/` on disk |

---

## Code change habits

- Match surrounding style. Short factual comments only when the constraint is non-obvious.
- Phone UI is one large `index.html` (plus `food/index.html`, `cfa/index.html`). Surgical DOM/JS edits; don’t rewrite the file for a one-line fix.
- After UI/layout/state changes, verify the flow the user would use (and sibling views that share that state). If you cannot open a browser, say so and use the closest substitute (`curl` against a server the user already has running — do not start one just to screenshot).
- New API routes live in `server.py` next to the existing `/api/...` handlers.
- If LibreOffice has the finance xlsx open, an external write can fail or look stale until reload.

---

## Finance workbook — surgical updates only (mandatory)

Live workbook: `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx`

**Change only what the user asked for.** Never rebuild whole dashboard sheets, whole workbooks, or unrelated cells as a side effect of a small request.

The user edits the sheet in LibreOffice (layout, copy, remove charts, drop helper text, etc.). A full rebuild **undoes those minor changes**. That is a defect, not a feature.

### Do

| Request type | Correct action |
|---|---|
| “Remove this label / chart / section” | Open the live xlsx with openpyxl; delete/clear **that** object or range only; save. |
| “Change this formula / metric” | Edit **only** the target cell(s) on the live file. |
| “Add one expense / one ledger row” | Append via `finance/sync.py` `add_entry` / `append_to_workbook`, or an equivalent **one-row** write. |
| “Fix category X” | Patch the specific config/validation/row needed — not all sheets. |
| “Sync Python from my sheet” | **Only when the user asks:** reverse-sync `finance/build_workbook.py` to match the live xlsx so a future intentional rebuild won’t wipe layout. |
| “Full rebuild” / “patch-live” / “recreate dashboards” | **Only when the user explicitly requests it.** Then run `build_workbook.py --patch-live` and warn that dashboard sheets will be recreated. |

### Do not

- Run `./whisper/.venv/bin/python finance/build_workbook.py --patch-live` (or equivalent full dashboard recreate) for small UI/copy/chart/formula tweaks.
- Call `populate_simple_dashboard` / `populate_detailed_dashboard` / `_recreate_sheet` / `_clear_sheet` on the live file unless the user asked for a **full** dashboard rebuild.
- Overwrite `Simple Dashboard` or `Detailed Dashboard` wholesale after the user has customized them.
- “Helpfully” re-apply Python dashboard templates after a one-line fix.
- Touch Ledger rows the user did not ask to change.
- Overwrite calculated Reconciliation values; fix gaps with Ledger rows (or Adjustment), never by clobbering calculated balances.

### How to apply a small sheet change

1. Read / inspect the **live** `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx` (and only the relevant sheet/cells).
2. Implement the **minimum** openpyxl (or equivalent) edit for the request.
3. Save atomically if possible (write temp → replace), same spirit as `finance/sync.py`.
4. If LibreOffice may have the file open, warn: close or reload after external write.
5. Optionally update `finance/build_workbook.py` **only if**:
   - the user asked to keep Python in sync, **or**
   - the change is a durable template rule they want on future blank builds — and still **do not** re-run full `--patch-live` unless they asked.
6. Summarize **exactly** what cells/sheets changed — nothing else.

### Explicit full rebuild (exception)

Allowed **only** with clear user language, e.g. “rebuild dashboards”, “run patch-live”, “recreate Simple/Detailed from Python”, “reset dashboards to template”.

Before running, state that this **replaces** Simple + Detailed dashboard sheets and can wipe manual LibreOffice tweaks.

```bash
./whisper/.venv/bin/python finance/build_workbook.py --patch-live
```

- Keeps Ledger and most other data.
- Still **recreates** Simple + Detailed dashboards from Python.

Default `build_workbook.py` (no flag) writes the **blank template** `finance/Finance Mng.xlsx` — never treat that as the live book.

### Scripts (do not misuse)

| Script | Use for | Not for |
|---|---|---|
| `finance/sync.py` | Append **one** validated Ledger row + JSONL | Dashboard redesign |
| `finance/import_statements.py` | Bulk statement import into Ledger | Dashboard UI tweaks |
| `finance/build_workbook.py` | Blank template **or** explicit `--patch-live` | Everyday small sheet edits |
| `finance/ai_parse.py` | Voice/text/receipt → JSON (then `sync.add_entry`) | Workbook rebuilds |

---

## Finance pipelines (already implemented)

**Voice:** Finance tab 🎙 → Whisper → DeepSeek `deepseek-v4-flash` (thinking **disabled**) → JSON → `sync.add_entry` with `Source=ai`. Success: this month’s transactions, new row highlighted. Form entries: `Source=manual`. Audio Notes is transcript-only (no ledger write).

**Receipt photo:** Finance 📷 → `POST /api/finance/receipt` → vision or OCR fallback → **exactly one** Ledger row (`Source=ai`).

- Prompt docs: `finance/ai_docs/` (`SHEET_OVERVIEW.md`, `PARSE_TASK.md`, `EXAMPLES.md`, `IMAGE_PARSE.md`, `IMAGE_EXAMPLES.md`). They hot-reload when mtimes change.
- Env: `DEEPSEEK_API_KEY`; optional `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_RECEIPT_MODE=auto|vision|ocr`.

Never rebuild dashboards from these paths.

---

## Other write paths

| Area | Append / store | Notes |
|---|---|---|
| Notes | `data/notes/{id}.json` + `.txt`, audio under `data/audio/` | Don’t rewrite history the user didn’t ask to change |
| Food | `food/store.py` → `data/food/` | AI meal profile uses the same DeepSeek key |
| CFA | `cfa/store.py` → `data/cfa/state.json` | |
| AI usage | `ai_usage.py` → `data/ai/usage.jsonl` | |
| Activity log | `app_log.py` → `data/logs/activity.jsonl` | |

---

## Git

- Private GitHub: `https://github.com/himanshugupta2077/toolkit`
- Default branch: `main`
- Do not commit secrets or `.env`
- If you add a new runtime data dir, gitignore it (or keep it under `data/`)

---

## Quick checklist before any finance sheet write

- [ ] Did the user ask for **this exact** change only?
- [ ] Am I editing the live file surgically (not recreating whole sheets)?
- [ ] Am I avoiding `--patch-live` unless they explicitly authorized a full rebuild?
- [ ] Will Ledger / Configuration / other sheets stay untouched unless requested?
- [ ] Did I report only what actually changed?
