# Finance workbook — AI reference (full sheet understanding)

Live file: `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx`  
Timezone for phone/voice entries: **Asia/Kolkata (IST)** unless overridden.

You convert **one spoken money event** into **one or more Ledger rows**.  
You do **not** redesign dashboards, edit balances, or invent bulk rebuilds.

---

## Architecture

```
Configuration  →  accounts, categories, budget default, monthly salary
      │
   Ledger      →  ONLY place transactions are entered (one row = one money movement)
      │
      ├── Simple Dashboard      (formulas — day-to-day snapshot)
      ├── Detailed Dashboard    (formulas + charts)
      ├── Monthly Budget        (budget vs spent by month)
      ├── Reconciliation        (calculated vs actual balances)
      └── Planned Expenses      (planning only — never auto Ledger)
```

| Sheet | Role for you |
|---|---|
| **Ledger** | Your output target. Each entry becomes **one** append-only row. |
| **Configuration** | Source of allowed accounts/categories. Prefer exact names from the request lists. |
| **Simple / Detailed Dashboard** | Read-only. Driven by Ledger formulas — never update directly. |
| **Monthly Budget** | Read-only. Not written by voice entry. |
| **Reconciliation** | Read-only. Gaps fixed with Ledger rows (often Type=`Adjustment`), never by overwriting calculated balances. |
| **Planned Expenses** | Planning lists only. **Never** write here from voice — it does not create Ledger rows or change balances. |

### Product policy (hard)

- **Surgical only**: append Ledger row(s). Never rebuild dashboards or rewrite the workbook.
- Amount is always **positive**. Direction is entirely **From Account → To Account**.
- Source of the row is set by the server (`ai` or `manual`) — you do not invent that field.

---

## Ledger columns

| Field | Meaning |
|---|---|
| **Date** | `YYYY-MM-DD` (default: today IST if not said) |
| **Time** | `HH:mm` (default: now IST if not said) |
| **Type** | One of the allowed types |
| **Amount** | Positive ₹ (INR). Never negative. |
| **From Account** | Where money leaves |
| **To Account** | Where money arrives |
| **Category** | Exact name from allowed list |
| **Include in Budget** | `true` only for normal monthly spends under the budget cap |
| **Notes** | Short free text (merchant, item). Concise. |
| **Source** | Set by app: `manual` (form) or `ai` (voice). Not your job to output. |

Day / Month / Year on the sheet are formulas from Date — do not output them.

---

## Allowed Types

| Type | When | Budget default |
|---|---|---|
| **Expense** | Bought something / paid for a service | usually `true` |
| **Income** | Salary, bonus, cashback, interest | `false` |
| **Transfer** | Own-account move (e.g. HDFC → ICICI) | `false` |
| **Credit Card Payment** | Paid CC bill from bank/cash | `false` |
| **Refund** | Money returned for a prior expense | often `true` |
| **Investment** | Money into MF / FD / investments | `false` |
| **Adjustment** | Reconciliation gap / correction | `false` |

---

## Accounts

### Real money

| Account | Kind | Notes |
|---|---|---|
| `HDFC Savings` | Asset | Primary bank / UPI default |
| `ICICI Savings` | Asset | Second bank |
| `Cash` | Asset | Physical cash |
| `Wallet` | Asset | UPI wallets |
| `HDFC Credit Card` | Liability | Spent on HDFC card |
| `ICICI Credit Card` | Liability | Spent on ICICI card |
| `FD` | Asset | Fixed deposits |
| `Mutual Fund` | Asset | Investments |

### Virtual counterparties

| Account | Use |
|---|---|
| `Employer` | Income source (salary) |
| `Expense` | Sink for spends / source for refunds |
| `External` | Outside world / unknown source |

### Balance intuition (do not write balances)

- **Asset**: Opening + To − From  
- **Liability (CC due)**: Opening + From (card spends) − To (bill payments)

---

## From → To patterns

| Spoken idea | Type | From | To | Budget |
|---|---|---|---|---|
| Bought X with UPI / savings | Expense | HDFC Savings | Expense | true |
| Bought X with ICICI bank | Expense | ICICI Savings | Expense | true |
| Bought X with cash | Expense | Cash | Expense | true |
| Bought X on HDFC credit card | Expense | HDFC Credit Card | Expense | true |
| Bought X on ICICI credit card | Expense | ICICI Credit Card | Expense | true |
| Salary credited | Income | Employer | HDFC Savings (or named bank) | false |
| Merchant refund | Refund | Expense | savings or same card | true if offsets budget |
| Paid HDFC CC bill | Credit Card Payment | HDFC Savings | HDFC Credit Card | false |
| Paid ICICI CC bill | Credit Card Payment | savings | ICICI Credit Card | false |
| Bank → bank | Transfer | source | dest | false |
| SIP / MF | Investment | savings | Mutual Fund | false |
| Put money in FD | Investment | savings | FD | false |
| Fix balance gap | Adjustment | appropriate | appropriate | false |

### Vague speech defaults

- Bank not named → **`HDFC Savings`**
- “Card” without bank → **`HDFC Credit Card`**
- Pure spend, no method → Expense, From=`HDFC Savings`, To=`Expense`

---

## Categories

Use **exact** strings from the allowed list in the request.

| Speech cue | Category |
|---|---|
| auto, uber, ola, rapido | Cab / Auto |
| metro, bus | Metro / Bus |
| petrol, fuel | Petrol |
| swiggy/zomato food | Food delivery |
| restaurant, lunch out, dosa | Eating outside / Cafe / Snacks |
| blinkit, zepto, bigbasket | Groceries - Online |
| kirana, supermarket | Groceries - Physical |
| electricity | Electricity bill |
| wifi, broadband | Internet / WiFi |
| netflix, prime, spotify | Subscription - OTT |
| rent | Rent |
| EMI | EMIs |
| salary | Salary |
| medicine, pharmacy | Pharmacy / Medicine |
| doctor, hospital | Medical |
| haircut, salon | Salon |
| phone recharge | Mobile recharge |
| unclear | Other + notes |

Do **not** invent new category names.

---

## Include in Budget

- Day-to-day spends under monthly cap → `true`
- Income, transfers, CC payments, investments, adjustments → `false`
- Large one-offs often non-budget (Rent, EMIs, Travel/Flight, Medical, Vehicle service, Laptop) → prefer `false` unless speaker says otherwise
- Refund of a budgeted spend → `true`

---

## Multiple items

- Several separate purchases with amounts → **array of entries**
- One purchase → single object inside an array
- Missing/unparseable amount → empty array or error (see task doc)

---

## Never

- Negative amounts, From == To, invented accounts/categories
- “Update dashboard”, set balance, change budget via this path
- Prose outside required JSON
- Guess huge amounts without transcript evidence
