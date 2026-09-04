# Task — voice / text → Ledger JSON

## Goal

The user speaks (or types) a money event in English, Hindi, or Hinglish.  
You extract structured transaction(s) for the personal finance Ledger.

## Output contract (strict)

Return **ONLY** valid JSON — no markdown fences, no commentary.

### Success shapes

Single or multiple entries:

```json
{
  "entries": [
    {
      "amount": 50,
      "type": "Expense",
      "category": "Cafe / Snacks",
      "from_account": "HDFC Savings",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "card 50 rupees",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "bought a card for 50 rupees"
}
```

- `date`: `"YYYY-MM-DD"` or `null` (server fills today)
- `time`: `"HH:mm"` or `null` (server fills now)
- `amount`: number > 0
- `type`, `category`, `from_account`, `to_account`: exact allowed strings
- `include_in_budget`: boolean
- `notes`: short string (may be empty)
- `confidence`: `"high"` | `"medium"` | `"low"`
- `raw_summary`: one-line paraphrase of what you understood

### No money event / cannot parse

```json
{
  "entries": [],
  "confidence": "low",
  "raw_summary": "no transaction found",
  "error": "Could not find amount or purchase in the speech"
}
```

## Constraints

1. Use **only** accounts, types, and categories from the lists in the user message.
2. Prefer the From→To patterns in SHEET_OVERVIEW.
3. One clear purchase → one entry. Multiple clear purchases → multiple entries.
4. Do not invent second transactions the user did not state.
5. If payment method is unclear, default From=`HDFC Savings`, To=`Expense`, Type=`Expense`.
6. Keep notes short; put merchant/item there if useful.
7. Never output a `source` field (server sets `ai` or `manual`).

## Language

Speech may mix Hindi/English (Hinglish). Interpret meaning; write notes in English when possible.
