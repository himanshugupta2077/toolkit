# Finance AI docs

These files are loaded into the DeepSeek system prompt by `finance/ai_parse.py`
when **Update ledger** is on, `POST /api/finance/parse`, or receipt camera upload.

| File | Purpose |
|---|---|
| `SHEET_OVERVIEW.md` | Full workbook model: sheets, accounts, From→To, categories, budget rules |
| `PARSE_TASK.md` | Strict JSON output contract (voice / text) |
| `EXAMPLES.md` | Few-shot voice → JSON examples |
| `IMAGE_PARSE.md` | Receipt / multi-screenshot → **one** Ledger row |
| `IMAGE_EXAMPLES.md` | Few-shot image + note → JSON |

## Model settings

- **Provider:** DeepSeek (`https://api.deepseek.com`)
- **Model:** `deepseek-v4-flash` (override with `DEEPSEEK_MODEL`)
- **Thinking:** disabled (`extra_body.thinking.type = disabled`)
- **Key:** `DEEPSEEK_API_KEY`
- **Receipts:** OpenAI-compatible multimodal `image_url` (base64 data URLs).
  If the endpoint rejects images, OCR text (tesseract) is sent instead.
  Override mode with `DEEPSEEK_RECEIPT_MODE=auto|vision|ocr`.

## Write path (surgical)

Parse → validate → `finance/sync.py` `add_entry` → one Ledger row + JSONL line.  
**Source** column: `ai`. Phone form: `manual`.  
Receipt camera: **exactly one** row per request.  
Never runs `build_workbook.py --patch-live`.

Edit these docs to improve parsing; they hot-reload on next request when mtimes change.
