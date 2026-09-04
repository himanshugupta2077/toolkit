# Task — receipt / screenshot → single Ledger JSON

## Goal

The user uploads one or more **images** of a purchase (receipt, UPI success screen,
order confirmation, bank SMS screenshot, etc.) plus an optional **note**
(typed text and/or voice transcript). The note may be **empty** — that is normal;
extract everything you can from the image(s) alone.

You extract **exactly one** structured Ledger row for that money event.

## Output contract (strict)

Same JSON shape as `PARSE_TASK.md` — **ONLY** valid JSON, no markdown fences.

### Hard rule: one row

- Always return **at most one** object in `entries`.
- Multiple images are angles / pages of the **same** purchase — not multiple rows.
- If the note mentions one amount and images show another, prefer the **note** for
  amount / account / category when clear; use images for merchant, date, and gaps.
- Never invent a second transaction.

### Success

```json
{
  "entries": [
    {
      "amount": 249,
      "type": "Expense",
      "category": "Food delivery",
      "from_account": "HDFC Savings",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "Zomato: chicken biryani, coke",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹249 Zomato UPI from HDFC"
}
```

### Cannot parse

```json
{
  "entries": [],
  "confidence": "low",
  "raw_summary": "no transaction found",
  "error": "Could not find amount or purchase in images/note"
}
```

## How to read inputs

1. **Images** — read amounts (₹ / Rs / INR), **app/merchant brand**, line items,
   UPI ref, payment method, date/time, card last-4 if useful.
2. **User note** — highest priority for intent (category, which account, “cash”,
   “personal”, corrections). May be empty.
3. **OCR text** (if provided) — noisy fallback; trust digits that match the images.

## Notes field (important)

`notes` must be useful on the phone list — **not** vague labels like "Grocery order".

Format: `Merchant: item1, item2, item3` (English, concise, max ~200 chars).

| Detect brand in image/OCR | Put in notes as |
|---|---|
| Blinkit / grofers | `Blinkit: …` |
| Zepto | `Zepto: …` |
| Amazon / Amazon Fresh / Amazon Pay | `Amazon: …` |
| Swiggy / Instamart | `Swiggy: …` / `Instamart: …` |
| Zomato | `Zomato: …` |
| Flipkart / BigBasket / Jiomart / Myntra | that brand name |
| GPay / PhonePe / Paytm UPI to a payee | payee/merchant name |

Rules for items:
- Prefer product names from the order summary / bill (short forms OK).
- If many items: list the main ones, then `+N more` if needed.
- If only a merchant is visible (no line items): `Blinkit` or `Stationary Mart` is fine.
- Never leave notes empty when a merchant or items are visible.
- Do not dump order IDs, addresses, or full payment refs into notes unless nothing else is known.

## Defaults (same as voice)

- Unclear payment method → From=`HDFC Savings`, To=`Expense`, Type=`Expense`
- Card payment screens → prefer matching Credit Card account when clear
- Use only allowed types / categories / accounts from the user message
- `date` / `time`: from image when clear, else `null` (server fills now)
- Never output `source`

## Language

Hindi / English / Hinglish on screens and in the note. Notes field in English when possible.
