# Finance OS — build plan (small phases)

This is the **implementation sequence**. Product rules, formulas, and screens live in `01` / `02`; the database lives in `03`. This file only answers *what we build next, how small it is, and how you approve it*.

| File | Role |
|---|---|
| `01_Architecture_and_Technical_Plan.md` | Vision, data model, formulas, screens-as-product |
| `02_Screens_and_UX_Plan.md` | Phone screens, navigation, interaction rules |
| `03_Database_SQLite.md` | System of record: SQLite on the laptop (later VPS). **Wins on storage.** |
| `personal_finance_app_architecture_flow.svg` | One-page spine diagram |
| **`plan.md` (this file)** | Phase-by-phase build order for AI + your review |
| `phases/PNN.md` | What shipped in phase N (written when that phase is implemented) |

If this file and `01`/`02` disagree on **product behaviour**, `01`/`02` win. If they disagree on **what to build in which order**, this file wins. If they disagree on **where data lives / the database / the server**, `03_Database_SQLite.md` wins (it supersedes Dexie, IndexedDB, and Supabase as the system of record).

No code until you approve this plan and say to start **Phase 1**.

---

## How we work

1. **One phase at a time.** Do not start phase *n+1* until you have used phase *n* and said it is OK.
2. **Only that phase.** No “while we’re here” extra screens, refactors, or cloud setup.
3. **A phase can have modules.** If a phase is still too big in practice, we stop after a module, you review, then finish the rest.
4. **You review like a user, not like a PR.** Click / run the listed checks. If a number is wrong vs the sheet, that is a fail even if the UI looks fine.
5. **Engine before pretty UI.** Wrong math in a polished screen is worse than an ugly correct number.
6. **Live Excel stays untouched.** The new app *reads* copies of your workbooks for import into SQLite. It does not write `Finance-Mng-V2.xlsx`. The existing Toolkit phone form can keep appending to Excel until Gate A.
7. **Personal data stays off git.** `app/data/` (dev SQLite), `fixtures/` (real xlsx copies), and the production file `~/finance-data/finance.sqlite` are gitignored. Tests in git use a small synthetic set or an in-memory SQLite.
8. **Phase summary file (every phase).** When a phase is implemented — before asking you to review — write `phases/PNN.md` (zero-padded, e.g. `phases/P01.md`). Do this after **every** phase, including small engine phases. The file must include:
   - What shipped (modules + notable files)
   - How to run / what to click
   - Tests or checks that were run, and the result
   - Explicitly out of scope / not done
   - What you should try in order to approve
   Do not skip this file. Do not dump the recap only in chat.

After you approve a phase, the next chat should be: *“do Phase N”* — not a recap of the whole product. Read `phases/PNN.md` if you need what landed.

### After every phase (summary file)

Path: `phases/PNN.md` with `NN` matching the phase number (`P01`, `P02`, …).

This is mandatory process, not optional documentation. The implementing session writes it as the last step of the phase, then stops. You review the app (and that file) before the next phase starts.

---

## What this app replaces

You have **two Excel files** doing one life:

1. **Budget / expense OS** — `/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx`  
   Ledger in, then: this-month pace, budget remaining, CC due, free cash after commitments, recurring + one-time plans, next 6 months, reconciliation.
2. **Investment allocator** — `/home/himanshu/Downloads/Investment_Portfolio_Allocation_Tracker.xlsx`  
   “I have ₹X left this month — where does it sit, and if it sits in investments, how does the long-term plan split it?”

The app is **one product** on a **phone browser** (PWA), talking to **your laptop as the server** over Tailscale (VPS later). Same spine as the SVG:

```
Add / import  →  Ledger (only source of truth)
                      + plans & settings
                           ↓
              Calculation engine
              (balances, pace, free cash, 6-month forecast)
                           ↓
              Allocation waterfall
              Emergency Fund → Savings buffer → Investment
                           ↓
              Goals          Invest plan (SIP + dip)          Portfolio
                           ↓
                    AI research (last, not now)
```

### Sheet → app (short)

| Today | App |
|---|---|
| Ledger | Ledger + Quick Add |
| Configuration | Accounts, Categories, Settings |
| Monthly Budget | Plan → Budget (only the cap is typed) |
| Reconciliation | Accounts → Reconcile |
| Planned Expenses | Plan → Recurring / One-time / Inflows / Forecast |
| Simple + Detailed dashboards | Home (and later Wealth overview) |
| Config milestones | **Dropped.** Replaced by three buckets with targets + fill rules |
| Goal Fund | Goals (priority, timeline, “can I afford it now?”) |
| Investing | Invest plan: SIP % / dip %, assets, theme engine, dip priority |
| Gold row | Imported **inactive**; you delete it. Default plan has no gold. |
| *(new)* | Portfolio + net-worth history |

---

## Frozen product rules

These are not up for grabs during a random phase. Change them only on purpose.

1. **Ledger is the only place money moves.** No screen lets you type a balance.
2. **Amount is always positive.** Direction is **From → To**.
3. **Planning never posts to the ledger.** Recurring / one-time / expected inflows only affect forecast and free cash.
4. **Include-in-budget** is per transaction; category supplies the default.
5. **Free to allocate** already nets commitments (same definition as the live sheet after the Sep 2026 fix):

   ```
   committed = CC due
             + max(0, this-month planned Loan/EMI − ledger EMIs this month)
             + planned one-time next 30 days (status = Planned)
   free      = liquid − max(0, budget remaining) − committed
   ```

   Expected inflows are **shown, not added**. Lifestyle recurring that already sits inside the budget cap is **not** subtracted again.

6. **Waterfall, not milestones.** Surplus fills **Emergency Fund** until target, then **Savings buffer** until target, then **everything left → Investment**. You can edit names, targets, order, and fill rules in the app.
7. **Near-term goals stay out of the market.** Goals fund from the Savings bucket (FD / hard cash), not from the Investment bucket.
8. **AI proposes, you confirm.** Nothing from AI (or from auto-recurring) writes a ledger row without a tap.
9. **IST dates**, amounts stored as **integer paise**.

---

## Defaults for the old “open decisions”

Locked for v1 so we can build. You can change any of these later in Settings / bucket editor — we will not block Phase 1 on them.

| Decision | Default |
|---|---|
| Opening-balance date | Keep sheet openings (Aug-only start on accounts). Ledger history from 2026-07-25 stays. No backfill older than the sheet. |
| Savings buffer target | **₹10,000** hard cash (from the investment sheet “Hard Cash in Saving Account” / ICICI). Editable. |
| Emergency Fund target | **6 × trailing 3-month essentials** (in-budget spend in essentials categories + rent + EMIs). Until we have 3 months, use months we have. Also editable as a fixed ₹. |
| Goals funding | Savings bucket only. A goal cannot pause EF filling in v1. |
| Auto-propose recurring | **Off** by default. |
| Users | Single user. No household model. |
| Salary used in “next month” | Settings value (**₹1,40,000** from Oct 2026 on Configuration). That is *not* the ₹83,167 currently hitting the ledger. |
| Gold | Inactive; weights re-normalised across remaining assets. |
| Theme engine | Below ₹20,000 monthly invest → only AI Infrastructure among *themes* (core assets still get their SIP share). ₹20,000+ → all themes. |
| SIP / dip | 70% / 30%, editable, must sum to 100%. |

Account → bucket seed after import:

| Account | Bucket |
|---|---|
| FD | Emergency Fund |
| ICICI Savings | Savings buffer |
| Mutual Fund | Investment |
| HDFC Savings, Cash, Wallet | *unassigned liquid* (counts as liquid / free cash, not as a filled bucket until you say otherwise) |

---

## Stack (v1)

Chosen so a phase stays small. The **laptop is the server** from Phase 9. A VPS is a **late** phase, not a foundation. Details: `03_Database_SQLite.md`.

| Layer | Choice | When |
|---|---|---|
| UI | React + TypeScript + Vite, Tailwind, phone-first (360–430px; desktop = same layout centred at 480px) | Phase 1 |
| Engine | Pure TS functions in `src/engine/` (no I/O). Vitest. Same functions the UI **and** the server call. | Phases 2–8 |
| Data | **SQLite file on the server** (`better-sqlite3` + Drizzle). Browser holds nothing you would miss. | Phase 9 |
| Server | **Hono on Node**, serves `dist/` + `/api`; runs the same `src/engine/` | Phase 9 |
| Client data | **TanStack Query** talking to `/api` (no Dexie, no `src/store/`) | Phase 9 / screens |
| Charts | Recharts, only when a screen needs one | Home / Forecast / Portfolio |
| PWA | vite-plugin-pwa, add-to-home-screen | Phase 17 |
| Import | SheetJS **server-side** (upload → parse → insert in one transaction) | Phases 10–11 |
| Backend / cloud | **Not needed.** Same SQLite file on a VPS is “more than this laptop”. Supabase optional forever. | Phase 24 = VPS move |
| AI | Last | Phase 26 |

Dev SQLite: `app/data/finance.sqlite` (gitignored). Production: `~/finance-data/finance.sqlite` (outside the repo). Phone over Tailscale hits the laptop; laptop asleep → app down (accepted, same as Toolkit).

The architecture doc’s `packages/engine` + `apps/web` split is a possible **later** layout. We stay **one package** with `src/engine/` + `server/` so Phase 9 is not a monorepo yak-shave. Formulas do not change.

### Folder

```
new proper web app/
  plan.md                      ← this file
  01_Architecture_...md
  02_Screens_and_UX_Plan.md
  03_Database_SQLite.md        ← SQLite schema, API, backup, VPS
  app/                         ← the actual project (git-friendly path, no spaces)
    package.json               ← scripts: client, server, both
    src/engine/                ← pure calc + tests (unchanged)
    src/api/                   ← typed fetch + TanStack Query hooks (from Phase 9)
    src/import/                ← xlsx *client* helpers only (file picker, progress)
    src/ui/                    ← screens + components
    src/dev/                   ← kitchen sink / fixture dump (dev only)
    server/                    ← Hono + Drizzle + repos (from Phase 9)
      db/                      ← client, schema, migrations
      repo/                    ← ledger, accounts, plans, buckets, …
      routes/                  ← /api/*
      import/                  ← SheetJS parsers (Phases 10–11)
    data/                      ← gitignored; finance.sqlite in dev
  fixtures/                    ← gitignored copies of your real xlsx + json dumps
```

Empty `app/src/store/` from Phase 1 is deleted in Phase 9 (replaced by `server/` + `src/api/`).

Existing Toolkit (`index.html`, `finance/sync.py`, live xlsx) is **out of scope** for every phase unless a phase explicitly says otherwise.

---

## Snapshot numbers (for engine tests)

These are **historical checks** from the live book around 3–4 Sep 2026 and the investment xlsx. After you spend more, live Home will differ; frozen fixtures must keep matching.

**Finance-Mng (LibreOffice-evaluated copy, early Sep 2026):**

| Metric | Value |
|---|---|
| Sep budget cap | ₹31,000 |
| Sep income | ₹83,167 |
| Sep budget expenses | ₹26,401.04 |
| Sep remaining | ₹4,598.96 |
| Sep investments | ₹20,000 |
| Sep rent (ledger) | ₹10,800 |
| Liquid | ₹25,031.25 |
| HDFC CC due | ₹702.16 |
| ICICI CC due | ₹328.04 |
| Total CC due | ₹1,030.20 |
| FD | ₹20,000 |
| Net worth | ₹44,001.05 |
| Remaining EMI (MacBook SmartEMI) | ₹38,200 |
| Planned one-time 30d (then) | ₹7,500 |
| Committed cash | ₹46,730.20 |
| Free to allocate | **−₹26,297.91** (honest: liquid cannot cover EMI + near-term plans) |
| Sep recurring total | ₹63,327 (Loan ₹38,200 + Lifestyle ₹25,127) |
| Oct recurring total | ₹49,327 |
| Dec recurring total | ₹51,127 (includes himanshu-gupta.com ₹1,800) |
| Ledger rows | 156 (2026-07-25 → 2026-09-03) |

**Investment sheet (as filed):** surplus ₹11,500; hard cash ₹10,000; SIP 70% / dip 30%; assets include Gold 10% (we will drop); theme threshold ₹20,000; goals: German Exams, Germany Relocation, MacBook Air, iPhone (last two have blank targets).

When Phase 10 imports **today’s** live file, the approval test is “app balances = that file”, not these frozen Sep-4 figures.

---

## Phase map

Do top to bottom. Checkboxes are for us to tick when you approve.

### Track A — Foundation

- [ ] **P1** App shell (tabs, phone chrome, empty screens)
- [ ] **P2** Types, paise, ledger validation

### Track B — Engine (tests, almost no UI)

- [ ] **P3** Balances, liquid, CC due, net worth
- [ ] **P4** Budget pace + month summary
- [ ] **P5** Recurring due, one-time windows, remaining EMI
- [ ] **P6** Free cash, next-month estimate, 6-month forecast
- [ ] **P7** Allocation waterfall
- [ ] **P8** Investment split + goal affordability

### Track C — Data on the server

- [x] **P9** Server + SQLite store (Hono, schema, `loadBooks`, `/api`)
- [x] **P10** Import Finance-Mng xlsx via `/api/import/finance` + balance match report
- [x] **P11** Seed buckets, invest plan, goals (investment xlsx via `/api/import/invest`)

### Track D — Daily money (replace sheet 1)

- [x] **P12** Quick Add
- [x] **P13** Ledger list / detail / edit / delete
- [ ] **P14** Accounts + Reconcile
- [ ] **P15** Home
- [ ] **P16** Plan tab (budget, recurring, one-time, inflows, forecast)
- [ ] **P17** Categories, Settings, PWA, privacy blur

**Gate A — you stop opening Finance-Mng for day-to-day capture and dashboards.** Excel can remain a backup export.

### Track E — Surplus → plan (replace sheet 2)

- [ ] **P18** Wealth overview + bucket rule editor
- [ ] **P19** Allocate run (preview → confirm → ledger transfers)
- [ ] **P20** Goals
- [ ] **P21** Invest plan editor, SIP split, dip reserve
- [ ] **P22** Portfolio + net-worth history

**Gate B — both Excel files retired for normal use.**

### Track F — Later (not until you ask)

- [ ] **P23** Export xlsx/csv/json + `VACUUM INTO` backup + nightly timer
- [ ] **P24** VPS move (optional)
- [ ] **P25** Automation (recurring proposals, reminders, statement import)
- [ ] **P26** AI (NL add, fund research, dip alerts, monthly review)

---

## Track A — Foundation

### Phase 1 — App shell

**Goal.** A phone-shaped app that opens, with the five tabs from the UX plan, and nothing behind them yet.

**Modules**

1. Vite + React + TS + Tailwind + Vitest scaffold under `app/`
2. Router + bottom tab bar: Home · Ledger · Plan · Wealth · More
3. Floating `+` that opens a placeholder sheet (“Quick Add — Phase 12”)
4. Short `app/README.md`: how you run it (`cd app && npm run dev`)

**Out of scope.** Engine, data, real screens, PWA install prompt, dark-theme polish beyond “follow system”, Supabase.

**Summary file.** `phases/P01.md` (written when this phase is implemented).

**You approve when**

- Tabs switch. Safe-area padding looks fine on a phone-width window (~390px).
- `+` opens a bottom sheet and closes.
- `npm test` runs (empty/passing).
- Desktop is the same UI centred, not a different layout.

---

### Phase 2 — Types, money, ledger validation

**Goal.** One shared language for money and a transaction that cannot be saved in an illegal shape.

**Modules**

1. `Money` as integer paise; format as `₹1,40,000.00` (Indian grouping)
2. Domain types: account, category, ledger entry, month (`YYYY-MM`), IST date helpers
3. `validateLedgerEntry` — Type Guide from `01` §4.2 / sheet rules:
   - amount > 0, from ≠ to
   - income: from is virtual employer/external
   - expense: to is virtual Expense
   - cc_payment: to is a liability / credit card
   - investment: to group is fd or investment
   - adjustment: category Reconciliation (or equivalent)

**Out of scope.** Computing balances; UI keypad.

**You approve when**

- Unit tests cover each type’s happy path + the illegal From/To cases.
- ₹ rounding: `1150.5` rupees → `115050` paise, displays `₹1,150.50`.

---

## Track B — Engine

Every function is `(data, today) → result`. No SQLite, no HTTP, no React. Tests in `src/engine/*.test.ts`. A tiny **dev dump page** (`/dev/engine`) may print JSON so you can eyeball numbers without a debugger — optional, not a product screen. The engine does not import Drizzle.

### Phase 3 — Balances

**Modules**

1. Asset balance = opening + Σ to − Σ from  
   Liability due = opening + Σ from − Σ to
2. Liquid = Σ where `include_liquid`
3. CC due / utilisation / available (limit − due)
4. Net worth = Σ include_net_worth assets − Σ include_net_worth liabilities

**You approve when**

- Synthetic fixture: two accounts, a few txs, balances match by paise.
- After P10 we re-run this against the live import (must match Reconciliation calculated to ₹1). For now, synthetic is enough.

---

### Phase 4 — Budget pace + month summary

**Modules**

1. `budgetPace(month)` — cap, spent (`in_budget` expenses), remaining, used %, elapsed %, safe/day, pace band (on track / watch / over)
2. `monthSummary(month)` — income, non-budget exp, investments, EMIs, rent, CC payments, est. savings  
   Rent/EMIs are **displayed** separately; they are **not** subtracted twice from savings.

**You approve when**

- Synthetic month: known cap and spends → remaining and safe/day exact.
- Pace: used% ≤ elapsed% → on track; within +10pp → watch; else over.
- Empty month: remaining = cap, not an error.

---

### Phase 5 — Recurring, one-time, remaining EMI

**Modules**

1. `recurringDue(month, kind)` — active + start/end overlap; yearly counts **only in anniversary month** (never ÷12); blank kind infers EMIs → Loan/EMI else Lifestyle (same as the sheet helpers)
2. `oneTimeWindow(days)` — status Planned only
3. `committedEmiRemaining` = due Loan/EMI this month − ledger category EMIs this month (floor at 0)

**You approve when**

- Fixture cloned from Planned Expenses behaviour: a yearly domain in December is 0 in September; SmartEMI with end Feb 2027 is due Sep–Feb; inactive or ended rent is 0 after end.
- One-time Completed/Cancelled excluded.

---

### Phase 6 — Free cash + forecast

**Modules**

1. `freeToAllocate` + breakdown lines (liquid, budget reserved, CC, remaining EMI, one-time 30d)
2. `nextMonthEstimate` = free − next month Loan/EMI + salary − next month cap  
   (CC is already inside today’s free; do not subtract CC again)
3. `forecast(6)` + `projectedLiquid` with toggle **assume inflows arrive = off**

**You approve when**

- On the **frozen Sep-2026 fixture**, free cash sign and the committed-cash recipe match the sheet definition (negative is allowed and required if the fixture is that snapshot).
- Next-month line uses settings salary, not last ledger income.
- Forecast month cards can list *which* recurring rows make up a kind (needed later for the Forecast screen).

---

### Phase 7 — Allocation waterfall

**Modules**

1. Bucket model: priority, target rule (fixed ₹ | months of essentials | none), fill mode (until target | % | fixed | remainder)
2. `runWaterfall(surplus, buckets, currentBalances)`
3. Seed three buckets (EF, Savings, Investment) with the defaults in the table above
4. Guardrails: exactly one remainder bucket; % sum ≤ 100

**You approve when**

- Example: surplus ₹20,000, EF room ₹12,400, Savings room ₹10,000 → EF 12,400, Savings 7,600, Investment 0.
- Example: both targets full → all surplus to Investment.
- Surplus 0 or negative → all zeros, no throw.
- Dragging/overriding a line is **not** in this phase (that is P19 UI). Pure function only.

---

### Phase 8 — Investment split + goal affordability

**Modules**

1. `splitInvest(amount, plan)` — sip pool, dip credit, active assets (core ∪ allowed themes), normalised weights, rupee rounding remainder → largest weight
2. Theme tiers (₹20k threshold)
3. `goalAffordability` — funded, remaining, available_now = bucket balance − remaining of higher-priority goals, status pills as in `02` §3.6.4
4. Gold not in the default active list; if present, `active=false` and others re-normalise

**You approve when**

- ₹1,150 at 70/30 with gold **off** and below theme threshold: dip ₹345; SIP goes to core + AI Infrastructure only; other themes ₹0.
- Two goals, Savings ₹10,000: higher-priority remaining ₹8,000 → lower goal available_now ₹2,000.
- Affordable now / on track / behind labels match the formula in `01` §5.10.

---

## Track C — Data on the server

Schema, PRAGMAs, backup, API list, and VPS notes: `03_Database_SQLite.md`. Tables land **by phase**, not all at once.

### Phase 9 — Server + SQLite store

**Goal.** The engine runs on real records in a SQLite file on the laptop, reachable from the phone over Tailscale, still without product UI.

**Modules**

1. `server/` with Hono: serves `dist/` and `/api/health`; `npm run dev` runs Vite + server together; Vite proxies `/api` → `http://127.0.0.1:8787`.
2. Drizzle schema + first migration: accounts, categories, settings, ledger_entries (soft delete), month_budgets, recurring_plans, one_time_plans, expected_inflows, buckets, meta. WAL + foreign keys on. Delete empty `src/store/`.
3. Repo helpers + `loadBooks(db, today)` returning the engine’s `Books` type.
4. `GET /api/books`, `POST /api/ledger` (runs `validateLedgerEntry`), `GET /api/month/:yyyymm`.
5. `VACUUM INTO` backup script (`npm run db:backup`) + `GET /api/export.sqlite`.
6. Dev page `/dev/store`: counts, “add one dummy expense”, “wipe” (dangerous, red, confirm by typing `wipe`).
7. Thin `src/api/` fetch helpers the dev page uses. Product screens still wait.

**Out of scope.** Import, auth beyond the tailnet, PWA install prompt, any product screen, IndexedDB.

**Summary file.** `phases/P09.md`.

**You approve when**

- Restarting the server **and** clearing browser site data keeps the dummy row — it is in `finance.sqlite`, not the phone.
- Adding a dummy expense from the phone over Tailscale changes `GET /api/month/2026-09` `budgetSpent`.
- `data/backups/` gets a file from `npm run db:backup`, and opening it with `sqlite3` shows the row.
- Wipe requires typing the word `wipe`.

---

### Phase 10 — Import Finance-Mng

**Goal.** Your budget workbook is imported into SQLite. This is the first time numbers must match **your** file.

**Modules**

1. Client: file picker + progress. Upload multipart xlsx to `POST /api/import/finance`.
2. Server parses Configuration (accounts, flags, groups, categories, default budget, salary).
3. Server parses Ledger (Excel serial/date → ISO; Source=`excel`; blank Include-in-budget → category default).
4. Server parses Monthly Budget caps; Planned Expenses (recurring + one-time; Kind, Active, Start/End); Reconciliation actuals / last-checked as first reconcile records.
5. Insert **in one transaction**. Idempotent via `source_hash` unique index so you can re-run while Excel is still in use.
6. **Validation report** as JSON + a simple UI: per account, sheet calculated vs engine, ✓ or red.

**Out of scope.** Writing back to Excel. Investment xlsx (that is P11). Starting fresh with empty books (a “skip import” button is OK).

**You approve when**

- You pick the live (or a copy of) `Finance-Mng-V2.xlsx` and upload it.
- Every real account matches to **₹1**.
- Recurring Sep Loan/EMI includes MacBook SmartEMI ₹38,200 if that row is still active in the file you imported.
- Restarting the server keeps the import (it is in SQLite).
- A mismatch is clickable (will deep-link to Ledger in P13; for now a filtered list or raw rows is enough).

---

### Phase 11 — Seed investment side

**Modules**

1. Migration for invest / goal tables as in `03` §5.1 (only what this phase needs).
2. Create the three buckets; map FD / ICICI / Mutual Fund as in the defaults table.
3. Upload investment xlsx to `POST /api/import/invest`, or type the invest plan: 70/30, assets, theme tiers, dip priority; Gold inactive. One transaction.
4. Import goals (names; blank targets stay blank and the UI will ask later).
5. Mini confirmation: “EF target = … · Savings target = ₹10,000 · Investment = remainder”.

**You approve when**

- Wealth is still empty UI, but `/dev/engine` (or a one-screen summary from `/api/books`) shows bucket current balances from tagged accounts (FD should show the imported FD balance).
- Changing a target in this seed wizard is persisted in SQLite (survives server restart).

---

## Track D — Daily money

Phone UI rules from `02` apply from here: one-thumb, bottom sheets, no horizontal scroll, balances not editable. Screens read/write through `/api` with TanStack Query. Optimistic update on Quick Add; on failure, the toast says “not saved” and the row disappears.

### Phase 12 — Quick Add

**Modules**

1. Bottom sheet from global `+`
2. Type segmented control (Adjustment under “more”)
3. Amount field + numeric keypad (`.` and `+` for quick sum)
4. From → To chips with type defaults (Expense hides virtual Expense, shows category instead)
5. Category chips (recent + all by group); sets `in_budget` default
6. Date (Today / Yesterday / pick), note, Save / Save & add another
7. Optimistic `POST /api/ledger` → numbers from the response (or refetch). On failure: toast “not saved”, row disappears.

**Out of scope.** Natural-language parse, link-to-goal/plan, holding units/NAV.

**You approve when**

- You can log “₹240 eating outside on HDFC CC” in a few taps. It appears via `/api` and is still there after a server restart / clearing site data. Pace numbers change if Home exists; if not, `/dev` summary changes.
- Illegal From/To shows an inline hint, not a silent save.

---

### Phase 13 — Ledger screen

**Modules**

1. Month switcher, day-grouped list, in/out/budget strip
2. Search + filter sheet (type, account, category, in-budget, source)
3. Detail page: edit (sheet), duplicate, delete with confirm
4. Swipe delete / duplicate if easy; skip swipe if it eats the phase

**You approve when**

- Imported 150+ rows scroll without dying (virtualise if needed).
- Edit a note, refresh the phone, it stays (SQLite, not the browser).
- Delete is soft; balances move; you cannot “edit the balance”.

---

### Phase 14 — Accounts + Reconcile

**Modules**

1. More → Accounts, grouped (Savings, Cash, Credit card, FD, Investment, Virtual)
2. Account detail: calculated balance, limit/utilisation, filtered ledger
3. Add / edit / archive (archive only if entries exist — never delete)
4. Reconcile sheet: calculated vs actual → `POST /api/reconcile` (one SQLite transaction: stamp, or **Find missing** / **Add adjustment** with note required)

**You approve when**

- You reconcile HDFC Savings against the bank number. Difference 0 stamps today. Difference ≠ 0 creates an Adjustment ledger row and the gap closes.
- New account with liquid=TRUE increases Home liquid (or `/dev` liquid) without code changes to Home.

---

### Phase 15 — Home

The Simple Dashboard, in the order you actually read it.

**Modules**

1. Header (month, days left) + **Pace** card (safe/day, remaining, used vs elapsed bar)
2. **CC due** card (one row per credit-card account)
3. **Free to allocate** card + collapsible breakdown + est. free next month + grey “if inflows received”
4. This-month 2×3 tiles (income, budget exp, …) tapping through to Ledger filters
5. Compact 6-month strip (tap target for P16 Forecast)
6. Last 5 transactions
7. Action cards only when relevant (unverified import, unreconciled, negative free cash). Allocate CTA can be a dead button until P19.

**You approve when**

- After P10 import, Home’s big numbers match the engine (which already matched the sheet).
- Negative free cash is red and explains “committed beyond liquid”.
- Tapping a derived number can wait for a full explainer sheet in P16/P17, but the breakdown for free cash must be visible here.

---

### Phase 16 — Plan tab

**Modules** (reviewable one by one)

1. **Budget** — cap (edit + “apply to future”), spent, remaining, category bars, month list
2. **Recurring** — kind chips, active switch, add/edit sheet, monthly fixed cost header
3. **One-time** — 30/90/total, Planned/Completed/Cancelled, add/edit
4. **Inflows** — expected, not counted; empty state is fine
5. **Forecast** — 6 month cards + stacked bar; “which rows make up Loan/EMI in Nov?”

**You approve when**

- Turning a recurring row Active=FALSE updates Home free cash / forecast immediately.
- Completing a one-time in the plan does **not** invent a ledger row (that happens when you Quick Add and link — linking can be a small extra if time; otherwise Complete just flips status, and we add “mark paid → Quick Add” in a follow-up module).
- Yearly scooty insurance does not smear across 12 months.

---

### Phase 17 — Categories, Settings, PWA, privacy

**Modules**

1. Categories: list, default-in-budget switch, add / rename / archive (merge can wait)
2. Settings → Money: default budget, salary, salary day, EF months, essentials categories
3. Privacy blur toggle on Home numbers
4. PWA: installable, standalone, safe-area
5. Tailnet front door: when behind `tailscale serve`, trust `Tailscale-User-Login`; PIN / biometric lock from `02` §3.7.3 as a second layer. Never bind `0.0.0.0` on a public interface without auth.
6. Empty/error copy pass on the screens that exist. **Offline reads are not promised** (laptop asleep = app down, same as Toolkit). A later phase may add a read cache if you ever want it.

**You approve when**

- You can install to phone home screen and add an expense (it hits `/api`, not the phone’s storage).
- Changing default budget affects a future month with no cap row yet.
- Blur hides amounts; they still compute.

**Gate A.** Daily capture + pace + plans + reconcile live in the app. You may keep Excel open as a read-only comfort blanket. We still do **not** write the xlsx.

---

## Track E — Surplus → plan

### Phase 18 — Wealth overview + buckets

**Modules**

1. Net worth hero (sparkline later in P22)
2. Three bucket cards with fill vs target
3. Assets vs liabilities lists
4. Bucket rule editor: order, target rule, fill mode, linked accounts, live example with today’s surplus

**You approve when**

- EF fill % uses FD (and any other tagged accounts).
- Editing Savings target from 10k → 30k updates the rings and the example split, without posting ledger rows.

---

### Phase 19 — Allocate run

**Modules**

1. Surplus input = free to allocate, editable with reason
2. Waterfall preview (the three rows)
3. If Investment > 0, show SIP / dip split (read-only preview; editor is P21)
4. Confirm → `POST /api/allocation/:id/confirm`: one SQLite transaction writes Transfer/Investment ledger entries (you pick From account, e.g. HDFC Savings → FD) plus the run record — all land or none
5. History of past runs; confirmed runs are not rewritten (amendments = new adjusting entries)

**You approve when**

- Confirming “₹12,400 to EF” adds a ledger Investment/Transfer, FD balance up, free cash down, run stored as confirmed.
- Negative free cash: Allocate is hidden or disabled with the same explanation as Home.

---

### Phase 20 — Goals

**Modules**

1. List sorted by priority (reorder)
2. Add/edit: name, target, date, bucket (default Savings)
3. Status pills from engine
4. Detail: remaining, “affordable now and why”, contributions
5. Fund now → Quick Add prefilled as transfer + contribution link  
   Manual contribution without a bank move is allowed (with a note)

**You approve when**

- With Savings ₹10,000 and a ₹8,000 goal, it says affordable now; a second ₹8,000 goal does not.
- Funding writes a contribution; hitting target → Achieved.
- Blank-target imported goals prompt you to fill a number.

---

### Phase 21 — Invest plan + SIP + dip

**Modules**

1. Plan editor: SIP/dip sliders (sum 100), assets (%, kind, dip priority, active, instrument note), add/remove
2. Saving a plan = **new version** (`effective_from=today`); old runs keep old version
3. Theme engine tiers
4. This month’s SIP list from last confirmed allocation (or a what-if amount)
5. Dip reserve balance + history + Deploy sheet (suggested split by dip priority, editable) → Invest ledger + holding txns if holdings exist, else ledger only

**You approve when**

- Turning Gold off re-normalises % and SIP rupees.
- Threshold: amount ₹10,000 → Automation & Robotics SIP ₹0; ₹25,000 → themes on.
- Deploy dip ₹N reduces reserve and adds ledger investment rows.

---

### Phase 22 — Portfolio + net worth history

**Modules**

1. Holdings list (units, avg cost, manual NAV, value, gain)
2. Allocation drift vs current plan (>5pp hint)
3. Net-worth history from **on-demand + daily-when-open** snapshots (nightly `VACUUM INTO` backup is Phase 23; snapshot cron can wait)
4. FDs as holdings with optional maturity

**You approve when**

- Manual NAV update changes current value and net worth.
- Snapshot after an allocate run shows a new point on the chart.
- Drift bars match holdings vs plan weights.

**Gate B.** You can allocate leftover money along the long-term plan, see goals, and see portfolio/net worth without the second Excel file.

---

## Track F — Later

Do not pull these forward “because they’re easy”.

### Phase 23 — Export / backup

There is now a place to put backups: the server disk.

1. `VACUUM INTO` (never raw `cp` of a live WAL file) → `data/backups/` and `GET /api/export.sqlite`
2. JSON + CSV + mirror-ish xlsx (ledger + config + plans) via `/api/export.*`
3. Server-start backup if last one is > 24 h or a migration is about to run
4. Nightly timer (systemd / cron 02:00): keep last 30 daily + 12 monthly; ideally a second disk / Syncthing folder
5. More → Data → “Download backup” on the phone

Restore: stop server, copy chosen `finance-….sqlite` over the live file, delete stale `-wal`/`-shm`, start. Verify `/api/health` and one reconcile.

**Out of scope.** Litestream / S3 (worth it once the VPS is the only copy). Supabase.

### Phase 24 — VPS move (optional)

Only if you want the app up when the laptop is asleep. Same SQLite file, same process, same engine. Not a rewrite. Not Supabase.

Steps (from `03` §10): provision a small Linux box → `npm ci && npm run build` → stop laptop, `npm run db:backup`, rsync the backup to `/var/lib/finance/finance.sqlite` → same systemd unit → join the tailnet and `tailscale serve` (private; preferred) or Caddy + basic auth on a domain. Point the phone at the new host. Reverse move is the same rsync the other way. Keep the laptop as the off-site backup target.

### Phase 25 — Automation

Recurring auto-**propose** (never silent post), CC/EMI/reconcile/pace notifications, bank/CC **file** import with dedupe. No bank passwords.

### Phase 26 — AI

Natural-language Quick Add prefill; fund briefs; dip alerts vs reserve; monthly review narrative. Structured JSON cards. Confirm to apply. Keys server-side. This is also where Toolkit voice/receipt ideas could land — **not** by bolting onto `index.html`.

---

## Explicitly not in this project (until a phase says so)

- Writing or rebuilding the live Excel dashboards
- Changing Toolkit `index.html` / `finance/sync.py` as the new UI
- Excel, JSON files, IndexedDB, or Dexie as the **system of record**
- Supabase / Postgres as a required backend (optional forever; SQLite on a VPS is enough)
- Bank scraping / UPI login
- Household / multi-user
- Milestone 1/2/3 as a state machine (deleted on purpose)
- Gold as a required asset
- Silent ledger posts
- A separate desktop layout
- Promising offline-on-the-phone while the laptop is the server
- Full design-system shopping (we add components when a phase needs them)

---

## Suggested review rhythm

You asked to keep phases small so one AI pass is reviewable. Practical size:

| You have | Do |
|---|---|
| 15–30 min | Approve P1 or a single engine phase (P2–P8) |
| One evening | P9 (server + SQLite) or a UI phase (P12–P17) on your phone over Tailscale |
| A weekend | Gate A: import live xlsx into SQLite, live with Home + Quick Add for a few days before Track E |

If an engine phase’s tests pass but you have not imported the real file yet, that is still an approve — P10 is the “my numbers” gate.

---

## Next message when you want to build

After you have used a phase and it is OK, say:

**`do Phase N`**

(or `start phase 1` for the first one). Read `phases/PNN.md` for what that phase already shipped.
