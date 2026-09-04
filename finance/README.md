# Finance Tracker

Phone UI → laptop server → **Ledger row** in `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx` (+ backup log in `data/finance/entries.jsonl`).

Open the workbook in **LibreOffice Calc**. After a phone save, **reload** the file in LibreOffice if it was already open (external writes are not live-updated). If save fails with “permission denied”, close the workbook in LibreOffice first.

## Workbook architecture

```
Configuration
    ├── Accounts (opening balances, credit limits)
    ├── Categories
    ├── Types
    └── Budget default + monthly salary
        │
      Ledger   ← only place you enter transactions
        │
        ├── Simple Dashboard   (day-to-day snapshot)
        ├── Detailed Dashboard (full snapshot + charts)
        ├── Monthly Budget     (budget vs spent by month)
        ├── Reconciliation     (calculated vs actual)
        └── Planned Expenses   (planning only — never Ledger)
```

### Sheets

| Sheet | Purpose |
|---|---|
| **Simple Dashboard** | Month pace, budget remaining, safe ₹/day, pace check, upcoming CC bills, free-to-allocate (savings − budget remaining), next-month free-to-allocate estimate, **planned expenses summary** |
| **Detailed Dashboard** | Full pace + this month + upcoming CC bills + free-to-allocate + next-month estimate + balances + net worth + 3 charts + **planned expenses summary** |
| **Ledger** | Universal journal: every income, expense, transfer, CC payment, investment, refund, adjustment |
| **Monthly Budget** | Per-month Budget (manual) + Income / Spent / Remaining / EMI / Rent / Investments (from Ledger) |
| **Reconciliation** | Calculated vs Actual; never overwrite calculated — add Ledger rows |
| **Planned Expenses** | **Planning only**: recurring (monthly/yearly) + upcoming one-time costs. Does **not** create Ledger entries, change balances, or affect Monthly Budget |
| **Configuration** | Accounts, categories, types, opening balances, credit limits, **default monthly budget**, **monthly salary** |

### Key dashboard metrics

| Metric | Formula (conceptually) |
|---|---|
| **Free to allocate** | Liquid savings (HDFC + ICICI + cash + wallets) − budget remaining this month. Does **not** subtract CC dues. |
| **Upcoming CC bills** | Outstanding due on HDFC + ICICI credit cards |
| **Est. free next month** | Free to allocate today − total CC dues + monthly salary − next month's budget |
| **Monthly fixed cost** | This month's recurring **cash due** (`Planned Expenses!P6`) — Active rows whose Start/End cover this month, split by Kind |
| **Next 6 months** | Cash due by month: Loan / EMI vs Lifestyle vs Investment (`Planned Expenses!L6:P12`) |
| **Upcoming one-time (30/90d)** | Sum of Planned one-time expenses with effective date in the window (planning only) |

### Ledger columns

| Column | Notes |
|---|---|
| Date / Time | Phone sends date; time is automatic (IST) |
| Day / Month / Year | Formulas from Date |
| Type | Income, Expense, Transfer, Credit Card Payment, Refund, Investment, Adjustment |
| Amount | Always **positive** |
| **From Account** | Where money leaves |
| **To Account** | Where money arrives |
| Category | Groceries, Rent, Salary, … |
| Include in Budget | TRUE for normal monthly spends |
| Notes | Free text |
| **Source** | `manual` = phone form; `ai` = voice → DeepSeek path |

## Voice → AI → Ledger

1. Finance screen → **🎙** (top right), or Audio → turn on **Update ledger**.
2. Record as usual → Whisper on the laptop → transcript.
3. DeepSeek (`deepseek-v4-flash`, **thinking disabled**) reads `finance/ai_docs/` + live
   types/accounts/categories → JSON → **one Ledger append** via `sync.py` (Source=`ai`).
4. Dashboards are **not** rebuilt — only a new Ledger row.

## Receipt photo → AI → Ledger

1. Finance screen → **📷** (top right).
2. Pick one or more screenshots (receipt / UPI / order). Optional typed **Note**
   and/or short **🎙** voice note (Whisper on the server).
3. **Update** → DeepSeek (multimodal `image_url` when the endpoint supports it;
   otherwise OCR + text) → **exactly one** Ledger row via `sync.add_entry`
   (Source=`ai`). Images stored under `data/finance/receipts/<id>/`.

```bash
export DEEPSEEK_API_KEY='sk-...'   # required for Update ledger
# optional: DEEPSEEK_MODEL=deepseek-v4-flash
# optional: DEEPSEEK_RECEIPT_MODE=auto|vision|ocr
./run.sh
```

Docs the model sees: `finance/ai_docs/SHEET_OVERVIEW.md`, `PARSE_TASK.md`,
`EXAMPLES.md`, plus `IMAGE_PARSE.md` / `IMAGE_EXAMPLES.md` for receipts.

Text-only test (no mic):

```bash
curl -s http://127.0.0.1:8000/api/finance/parse \
  -H 'Content-Type: application/json' \
  -d '{"text":"petrol 500 cash","save":true}'
```

### From → To examples

| Event | From | To |
|---|---|---|
| Salary | Employer | HDFC Savings |
| Groceries (UPI) | HDFC Savings | Expense |
| Groceries (card) | HDFC Credit Card | Expense |
| CC bill pay | HDFC Savings | HDFC Credit Card |
| Bank transfer | ICICI Savings | HDFC Savings |
| FD | HDFC Savings | FD |
| Refund to bank | Expense | HDFC Savings |
| Reconciliation gap | HDFC Savings | Expense (Type=Adjustment) |

### Balances (calculated only)

- **Asset** (savings, cash, FD, MF): `Opening + To − From`
- **Liability** (credit cards, as outstanding due): `Opening + From − To`
- Opening balances live only in **Configuration** (starting point).
- **Reconciliation**: enter Actual when you check the bank; fix gaps with Ledger rows (or `Adjustment`), never by editing the balance.

## Local setup

1. Workbook path (default): `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx`
2. Phone Finance form appends a new **Ledger** row on each submit.
3. Manual edits in LibreOffice still work — just reload after phone adds if the file was open.

```bash
# optional timezone for phone-form timestamps (default Asia/Kolkata)
export FINANCE_TZ=Asia/Kolkata
# optional: point at a different workbook copy
# export FINANCE_WORKBOOK='/path/to/other.xlsx'
./run.sh
```

## Phone form fields

| UI | Ledger |
|---|---|
| Amount | Amount |
| Type | Type |
| Category | Category |
| From / To | From Account / To Account |
| Include in budget | Include in Budget |
| Note | Notes |

Time is filled automatically. Type changes prefill sensible From/To and budget defaults (e.g. Income → Employer → HDFC Savings, budget off).

## Migrating from the old Transactions sheet

Old model used `Payment Method` + `Credit Card`. New model uses **From / To accounts**.

| Old | New |
|---|---|
| Sheet `Transactions` | Sheet `Ledger` |
| Payment=Saving Acc., Type=Expense | From=`HDFC Savings`, To=`Expense` |
| Payment=Credit Card, Card=HDFC | From=`HDFC Credit Card`, To=`Expense` |
| Type=Credit Card Bill Payment | Type=`Credit Card Payment`, From=savings, To=card |
| Type=Income, Payment=Saving Acc. | From=`Employer`, To=`HDFC Savings` |
| Starting balances on Config | Same idea: **Opening Balance** per account |

## AI / automation rules (mandatory)

**Agents must follow `../AGENTS.md` for all finance sheet work.**

Summary:

- Live file: `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx`.
- **Surgical updates only** — change exactly what was requested (one cell, one chart, one row).
- **Never** run a full dashboard rebuild for a small tweak; that wipes LibreOffice layout/copy/chart edits.
- Full recreate is allowed **only** when the user explicitly asks (“rebuild dashboards”, “patch-live”, etc.).
- Phone/form entries append **one Ledger row** via `sync.py`; they do not rebuild dashboards.

## Planned Expenses (planning only)

Independent planning sheet for recurring burn + upcoming one-time costs.

- **Does not** write Ledger rows, change balances, or affect Monthly Budget / Reconciliation.
- Summary anchors: `Planned Expenses!B5:B10` (monthly fixed, count, yearly, upcoming 30/90, total one-time).
- **Kind** (column K on the live book): `Loan / EMI` (must-pay) vs `Lifestyle` (negotiable everyday recurring) vs `Investment` (reserved). Blank Kind infers `EMIs` → Loan / EMI, else Lifestyle.
- **NEXT 6 MONTHS** table (`L6:P12`): cash due each month, respecting Active + Start/End. Yearly amounts count in the due month only (not yearly÷12). `B5` = this month's total (`P6`).
- Simple + Detailed dashboards show the summary **and** the 6-month split; phone UI reads the same metrics from `/api/finance/dashboard` → `planned` / `forecast_6m`.
- Edit yellow cells on **Planned Expenses**. Set **Active=FALSE** to exclude a recurring row. Set **End** so an EMI drops off after the last month.

Surgical create/refresh on the live workbook (does **not** rebuild dashboards wholesale):

```bash
./whisper/.venv/bin/python finance/build_workbook.py --planned-expenses
# Kind column + 6-month cash-due table on Planned Expenses and both dashboards
./whisper/.venv/bin/python finance/build_workbook.py --commitment-forecast
```

## Rebuild workbook / dashboards

```bash
# blank template (finance/Finance Mng.xlsx) — not the live book
./whisper/.venv/bin/python finance/build_workbook.py

# FULL rebuild of Simple + Detailed on the live file (keeps Ledger).
# Overwrites manual dashboard edits. Use only when you intentionally want that.
./whisper/.venv/bin/python finance/build_workbook.py --patch-live
```

## Import bank / CC statements

```bash
./whisper/.venv/bin/python finance/import_statements.py
```

Writes into `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx` (with a pre-import backup next to it). Review the Ledger after import.

## Phone-form log

Every phone submit is stored under `data/finance/entries.jsonl` so captures survive even if you never open the UI again.
