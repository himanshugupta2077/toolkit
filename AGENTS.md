# AI agent rules — tailscale-stuff

These rules always apply when working in this repo. Prefer them over older chat habits or memory that said “dashboard design lives only in Python + full `--patch-live`.”

---

## Finance workbook — surgical updates only (mandatory)

Live workbook: `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx`

### Golden rule

**Change only what the user asked for.**  
Never rebuild whole dashboard sheets, whole workbooks, or unrelated cells as a side effect of a small request.

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

Allowed **only** with clear user language, e.g.:

- “rebuild dashboards”
- “run patch-live”
- “recreate Simple/Detailed from Python”
- “reset dashboards to template”

Before running, state that this **replaces** Simple + Detailed dashboard sheets and can wipe manual LibreOffice tweaks.

Command (when authorized):

```bash
./whisper/.venv/bin/python finance/build_workbook.py --patch-live
```

- Keeps Ledger and most other data.
- Still **recreates** Simple + Detailed dashboards from Python.

Default `build_workbook.py` (no flag) writes the **blank template** `finance/Finance Mng.xlsx` — never treat that as the live book.

### Source of truth (by concern)

| Concern | Source of truth |
|---|---|
| Transaction history | **Ledger** in `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx` (+ `data/finance/entries.jsonl` log) |
| User’s current dashboard layout / copy / charts | **Live xlsx** (until they ask to sync Python) |
| Blank template / intentional full rebuild | `finance/build_workbook.py` |
| Phone / future voice entries | `finance/sync.py` append path — one entry at a time |
| Bank statement bulk load | `finance/import_statements.py` (user-driven; review Ledger after) |

### Related scripts (do not misuse)

| Script | Use for | Not for |
|---|---|---|
| `finance/sync.py` | Append **one** validated Ledger row + JSONL | Dashboard redesign |
| `finance/import_statements.py` | Bulk statement import into Ledger | Dashboard UI tweaks |
| `finance/build_workbook.py` | Blank template **or** explicit `--patch-live` full dashboard recreate | Everyday small sheet edits |

Human-oriented finance docs: `finance/README.md`.

---

## Finance voice → AI → Ledger (implemented)

Path: Finance tab **🎙** → minimal Finance voice UI (record / send / discard) →
Whisper → DeepSeek `deepseek-v4-flash` (thinking **disabled**) → JSON →
`finance/sync.py` **append one row** with **Source=`ai`**. On success, phone opens
**this month's transactions** (new row highlighted). Form entries use **Source=`manual`**.

- AI reference docs: `finance/ai_docs/` (`SHEET_OVERVIEW.md`, `PARSE_TASK.md`, `EXAMPLES.md`)
- Parser: `finance/ai_parse.py` — never rebuilds dashboards
- Env: `DEEPSEEK_API_KEY` (optional `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`)
- Ledger column **M Source**: `manual` | `ai`

Audio Notes is transcript-only (no Update ledger control).

## Finance receipt photo → AI → Ledger (implemented)

Path: Finance **📷** → multi-image upload + optional text/voice note →
`POST /api/finance/receipt` → DeepSeek (vision `image_url` or OCR fallback) →
JSON → `sync.add_entry` **exactly one row** (`Source=ai`).

- Docs: `IMAGE_PARSE.md`, `IMAGE_EXAMPLES.md` (+ sheet overview)
- Env: optional `DEEPSEEK_RECEIPT_MODE=auto|vision|ocr`
- Surgical only; never rebuilds dashboards

---

## General project norms

- Prefer minimal diffs; don’t drive-by refactor unrelated files.
- Keep phone → server → local data paths working (`server.py`, `run.sh`, `whisper/`).
- Do not commit secrets or env with webhook keys.
- If something can fail because LibreOffice has the xlsx open, say so clearly.

---

## Quick checklist before any finance sheet write

- [ ] Did the user ask for **this exact** change only?
- [ ] Am I editing the live file surgically (not recreating whole sheets)?
- [ ] Am I avoiding `--patch-live` unless they explicitly authorized a full rebuild?
- [ ] Will Ledger / Configuration / other sheets stay untouched unless requested?
- [ ] Did I report only what actually changed?
