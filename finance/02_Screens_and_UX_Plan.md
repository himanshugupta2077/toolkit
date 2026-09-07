# Personal Finance OS — Screens & UX Plan (mobile browser first)

*Companion to `01_Architecture_and_Technical_Plan.md`. Every screen below maps to the engine functions in section 5 of that document. Storage is `03_Database_SQLite.md` (SQLite on the laptop/VPS; the phone is a client).*

---

## 1. Design principles for a phone-browser app

| Principle | Concretely |
|---|---|
| **One-thumb operation** | Bottom tab bar (5 tabs), primary actions in the lower third, no top-left hamburger. |
| **Entry in ≤ 10 seconds** | Global floating "+" opens Quick Add as a bottom sheet from every tab; amount keypad first; recent categories as chips. |
| **Numbers first, charts second** | Every screen leads with 1–3 big numbers; charts collapse under them. Charts are optional on a 390 px screen. |
| **Bottom sheets, not pages, for edits** | Add/edit forms slide up; the context (list) stays visible behind. Full pages only for detail views. |
| **No horizontal scroll ever** | Tables become card rows; 6-month forecast is a vertical list of month cards, with a bar chart on top. |
| **Explain every derived number** | Tap any computed figure → "How is this calculated?" sheet with the formula and inputs. Same spirit as your sheet's tip cells. |
| **Ledger untouchable by accident** | Balances are never editable; delete is swipe → confirm; adjustments require a note. |
| **Offline-tolerant** | Reads from cache instantly; writes queue with a small "syncing…" pill. |
| **Privacy** | Blur numbers toggle (long-press the net-worth card); PIN/biometric on open. |
| **PWA** | Add-to-home-screen prompt on second visit; standalone mode hides the browser bar; safe-area padding for notches. |

Viewport target: 360–430 px wide. Text ≥ 14 px; tap targets ≥ 44 px. Dark mode follows the system.

---

## 2. Navigation map

```
Bottom tabs:  [Home]  [Ledger]  [Plan]  [Wealth]  [More]
                               (+) floating button → Quick Add sheet (all tabs)

Home
 ├─ Pace detail (sheet)
 ├─ CC due detail → Account detail
 ├─ Free-to-allocate breakdown (sheet)
 ├─ Allocate this month → Wealth ▸ Allocate
 └─ Confirm proposed recurring (sheet)

Ledger
 ├─ Filters (sheet)
 ├─ Transaction detail (page) → Edit (sheet)
 └─ Search

Plan
 ├─ Budget (this month + history) → Edit cap (sheet)
 ├─ Recurring → Add/Edit (sheet)
 ├─ One-time → Add/Edit (sheet)
 ├─ Expected inflows → Add/Edit (sheet)
 └─ 6-month forecast (page)

Wealth
 ├─ Overview (net worth, buckets, portfolio value)
 ├─ Allocate (waterfall run)
 ├─ Buckets (rules editor)
 ├─ Goals → Goal detail → Add contribution
 ├─ Invest ▸ Plan · This month's SIP · Dip reserve · Themes
 └─ Portfolio → Holding detail · Net-worth history

More
 ├─ Accounts → Account detail → Reconcile
 ├─ Categories
 ├─ Settings (salary, budget default, EF months, essentials, notifications)
 ├─ Import / Export
 ├─ AI insights (future)
 └─ About / lock
```

Deep links: `/home`, `/ledger?month=2026-09`, `/plan/forecast`, `/wealth/allocate`, `/wealth/goals/:id`, `/more/accounts/:id/reconcile`.

---

## 3. Screen specifications

Format for each screen: **Purpose · Layout (top→bottom) · Interactions · States · Engine inputs**.

### 3.1 Onboarding & import (first run only)

**Purpose** — get the two spreadsheets in, verify balances, land on Home.

**Layout**
1. Welcome card: "Bring your two sheets" — two file pickers (Finance, Investment). Or "Start fresh".
2. Import progress list: Accounts ✓ · Categories ✓ · Ledger (1,004 rows) ✓ · Plans ✓ · Investment plan ✓ · Goals ✓.
3. **Validation card** per account: "Sheet says ₹24,639.14 · App calculates ₹24,639.14 ✓". Any mismatch shows in red with "Open ledger for this account".
4. "Set up your three buckets" mini-wizard: EF target (months or ₹), Savings buffer target, confirm Investment = remainder.
5. Set PIN / enable biometrics. → Home.

**Interactions** — tapping a mismatch opens the Ledger pre-filtered. Skipping validation is allowed but the Home shows an "Unverified import" banner until every account is reconciled once.

---

### 3.2 Home (default tab)

**Purpose** — the Simple Dashboard, in the order you actually read it: *Am I on pace? What's due? What's free?*

**Layout**
1. **Header row**: "September 2026 · 25 days left" · privacy-blur eye icon · sync pill.
2. **Pace card** (hero)
   - Big number: **Safe to spend today ₹1,240 / day**
   - Sub-line: Budget remaining ₹18,600 of ₹31,000 · Used 40% · Month 20% elapsed
   - Thin two-tone progress bar (used vs elapsed marker). Colour: green on track / amber watch / red over pace.
   - Tap → **Pace detail sheet**: budget spent list by category (top 5 + "all"), formula explainer.
3. **Action cards** (only shown when relevant, horizontally stacked as full-width cards, not a carousel)
   - "Allocate this month — ₹22,400 free" → Wealth ▸ Allocate
   - "3 recurring payments to confirm" → Confirm sheet (checkbox list, one Save)
   - "HDFC Credit Card due in 4 days — ₹40,121" → Account detail
   - "ICICI Savings not reconciled in 21 days" → Reconcile
4. **Upcoming credit-card bills** card: one row per liability account (name, due, utilisation %). Total CC due. Tap row → Account detail.
5. **Free to allocate** card
   - Big number **₹22,400**
   - Collapsible breakdown (matches your sheet exactly):
     Liquid savings ₹61,300 · − Budget still reserved ₹18,600 · − CC due ₹40,121 · − EMI remaining this month ₹0 · − One-time next 30 d ₹29,000 = **₹22,400**
   - Greyed line: "Expected inflows if received: +₹31,600"
   - Second number: **Est. free next month ₹…** with its own breakdown (− next EMI + salary − next budget).
   - Tap → sheet with formula text and links to each input.
6. **This month** mini-grid (2 × 3 tiles): Income · Budget exp · Non-budget exp · Investments · EMIs + rent · Est. savings. Tap tile → Ledger filtered.
7. **Next 6 months** compact: stacked bar (Loan/EMI · Lifestyle · Investment) per month + total row. Tap → Plan ▸ Forecast.
8. **Recent transactions** (last 5) → Ledger.

**States** — empty month: pace card shows "No spending yet — ₹1,033 / day"; server unreachable (laptop asleep): error + retry, not a stale cache (v1 does not promise offline reads); import unverified: banner.

**Engine** — `budgetPace`, `ccDue`, `freeToAllocate`, `nextMonthEstimate`, `monthSummary`, `forecast(6)`.

---

### 3.3 Quick Add (bottom sheet, global "+")

**Purpose** — record a movement in under 10 seconds; mirror the From → To model without making it feel like accounting.

**Layout**
1. **Type segmented control**: Expense · Income · Transfer · CC payment · Refund · Invest · (Adjust hidden under "more")
2. **Amount** — large numeric field, auto-focused, custom keypad with ".", "+" (quick sum, e.g. 120+80), "×".
3. **From → To row** — two account chips. Defaults per type:
   - Expense: From = last-used payment account, To = *Expense* (hidden; shows category instead)
   - Income: From = *Employer*, To = HDFC Savings
   - Transfer: both real accounts
   - CC payment: From = savings, To = credit card
   - Refund: From = *Expense*, To = account
   - Invest: From = savings, To = FD / Mutual Fund (+ optional holding: asset, units, NAV)
   Tapping a chip opens an account picker sheet (recent first).
4. **Category** — 8 recent chips + "All" grid grouped by your category groups. Selecting sets the `in_budget` toggle to the category default.
5. **In budget** toggle with the tiny explainer "counts against ₹31,000 cap".
6. **Date** chip (Today · Yesterday · pick) · **Note** field (placeholder from last note in this category, e.g. "Swiggy food").
7. Optional row: **Link to** — a planned one-time (marks it Completed) · a goal (adds contribution) · a recurring plan (marks this month paid).
8. **Save** (primary, full width) · "Save & add another".

**Interactions**
- Validation from the Type Guide: wrong From/To for the type → inline hint, not a blocking error ("Refunds usually go *to* an account").
- After save: sheet closes, a toast shows "₹240 · Eating outside · Safe/day now ₹1,215" — the pace number updates live.
- Natural-language field (Phase 5): type "240 swiggy icici" → fields prefill.

---

### 3.4 Ledger (tab)

**Purpose** — the Ledger sheet, filterable, safe.

**Layout**
1. **Month switcher** (← September 2026 →) + search icon + filter icon (badge with active-filter count).
2. **Summary strip** for current filter: In ₹83,167 · Out ₹52,900 · Budget spend ₹12,400.
3. **Grouped list by day**: sticky day header ("Mon 1 Sep · ₹41,600 out"). Each row: category icon · note (or category) · account chip · amount (red out / green in / grey transfer) · tiny "B" badge if in-budget.
4. Infinite scroll upward into earlier months.

**Interactions**
- Tap row → **Transaction detail** page: all fields, "Edit", "Duplicate", "Delete" (swipe also works), "Why is this not in budget?" explainer, provenance (source, created/updated).
- Swipe left → Delete (confirm) · Swipe right → Duplicate to today.
- **Filters sheet**: type · account (from/to) · category / group · in-budget · amount range · has note · source. Save filter as a pill ("ICICI CC this cycle").
- Search matches note, category, account, amount.
- Long-press → multi-select → bulk recategorise / toggle in-budget.

**States** — no transactions this month: "Nothing yet. Add your first one" with big +.

---

### 3.5 Plan (tab) — sub-tabs: Budget · Recurring · One-time · Inflows · Forecast

#### 3.5.1 Budget
1. Month switcher.
2. Hero: **Cap ₹31,000** (pencil → edit sheet with "apply to future months too" toggle) · Spent · Remaining · Used % vs elapsed %.
3. **Spend by category** horizontal bars (this month, in-budget only), tap → Ledger filtered.
4. **Month-by-month** list (last 12 → future 6): Month · Cap · Income · Budget exp · Est. savings · a tiny pace dot. Tap → that month's Home-style summary.

#### 3.5.2 Recurring
1. Header numbers: **Monthly fixed cost ₹…** (this month's cash due) · Active count · Yearly commitments ₹….
2. Segment chips: All · Loan/EMI · Lifestyle · Investment · Inactive.
3. Cards: name · amount · frequency · next due · pay account · kind pill · Active switch. Ended plans (past end date) fold into "Ended".
4. "+ Add recurring" → sheet: name, category, frequency (monthly/yearly/weekly/every N months), amount, start, end (optional, "until I stop"), kind, pay-from account, auto-propose toggle, notes.

**Interactions** — toggling Active immediately updates fixed cost and forecast (matches "Active=FALSE excludes"). Card → detail with "Mark paid this month" (opens Quick Add prefilled) and history of linked ledger entries.

#### 3.5.3 One-time
1. Header numbers: **Next 30 days ₹…** · Next 90 days ₹… · Total planned ₹….
2. Segments: Planned · Completed · Cancelled.
3. Cards sorted by expected date: name · amount · date · priority pill (High/Med/Low) · pay account. Swipe → Complete (opens Quick Add prefilled, links entry) / Cancel.
4. "+ Add one-time".

#### 3.5.4 Expected inflows
1. Header: **Expected, not counted ₹…** with the explainer "Free to allocate ignores these until they land in the ledger."
2. Cards: name · amount · date · Liquid? pill · status. Swipe → Received (opens Quick Add as Income/Refund, links).

#### 3.5.5 Forecast (6 months)
1. Toggle: "Assume expected inflows arrive" (off by default).
2. **Stacked bar chart** — one bar per month, segments Loan/EMI · Lifestyle · Investment.
3. **Month cards** (vertical): Sep 2026 · Loan/EMI ₹40,121 · Lifestyle ₹24,027 · Investment ₹0 · **Total** · Projected liquid at month end ₹… (red if negative).
4. Footer: 6-month total row; "Which rows make up Loan/EMI in Nov?" → tapping any segment lists the contributing plans (your "audit a month there" helper).

**Engine** — `recurringDue`, `oneTimeWindow`, `forecast`, `projectedLiquid`.

---

### 3.6 Wealth (tab) — sub-tabs: Overview · Allocate · Goals · Invest · Portfolio

#### 3.6.1 Overview
1. **Net worth hero** ₹… with 30-day delta and a sparkline (long-press → blur).
2. **Three bucket cards** in priority order, each with a fill ring:
   - Emergency Fund ₹… / target ₹… (78%) · "≈ 4.7 of 6 months"
   - Savings buffer ₹… / ₹30,000
   - Investment ₹… (no target; shows invested cost and current value)
3. **Assets vs liabilities** two-column list (from Configuration flags). Tap → Accounts.
4. **Goals strip**: next 3 goals with status pill.
5. CTA: "Allocate this month" if a run is pending.

#### 3.6.2 Allocate (the monthly ritual)
1. **Surplus input**: prefilled **Free to allocate ₹22,400** with "why?" → breakdown sheet. Pencil → override amount + reason (kept in history).
2. **Waterfall preview** — three stacked rows animate filling left→right:
   - Emergency Fund: +₹12,400 → ₹… / target (room left ₹…)
   - Savings buffer: +₹10,000 → full ✓
   - Investment: +₹0 (or the remainder)
   Each row has a small "rule" caption (until target · fixed · % · remainder).
3. If Investment > 0: **"This month's SIP"** card expands — SIP pool ₹… / Dip reserve +₹… and per-asset order list.
4. **Confirm** → generates the transfer/investment ledger entries (listed for review with account pickers, e.g. "HDFC Savings → FD ₹12,400") → Save.
5. **History** accordion: past runs (month, surplus, per-bucket amounts, confirmed/edited).

**Interactions** — dragging a bucket amount (or typing) re-flows the rest; "Reset to plan" restores. Confirmed runs can be reopened and amended (edits create adjusting entries, never rewrite).

#### 3.6.3 Buckets (rule editor, reached from Overview → gear)
- Sortable list (drag handle) of buckets with: name, target rule (Months of essentials · Fixed ₹ · None), target value, fill mode (Until target · % of surplus · Fixed ₹ · Remainder), min monthly, linked accounts (multi-select), active, notes, colour.
- Live **example**: "With ₹20,000 surplus today this plan gives EF ₹…, Savings ₹…, Investment ₹…".
- Guardrail: exactly one bucket may be "Remainder"; percentages must sum ≤ 100%.

#### 3.6.4 Goals
1. Header: **Goals** · total remaining ₹… · "funded from Savings buffer" note.
2. Sorted by priority (drag to reorder). Card: name · target · funded ring · target date · **status pill**: *Affordable now* (green) / *On track* (teal) / *Behind — ₹X/mo needed* (amber) / *Saving* (grey) / *Achieved*.
3. "+ Add goal" sheet: name, target amount, target date (optional), priority, funding bucket (default Savings), notes, icon.
4. **Goal detail** page: big remaining number · "You could fund this today: yes/no and why" (available in bucket minus higher-priority goals) · contributions list · **Fund now** (opens Quick Add as Transfer/Invest with goal link) · **Add contribution manually** · Pause · Mark achieved · Edit.
5. Empty state copies your notes from the sheet: "German exams, Germany relocation, MacBook Air, iPhone".

**Engine** — `goalAffordability` per goal, recomputed on every ledger/allocation change.

#### 3.6.5 Invest — sub-sections as cards on one scrollable page
1. **Plan header**: version date · Monthly investing amount (from last run) ₹… · SIP 70% / Dip reserve 30% (tap → edit sliders that must sum to 100).
2. **Assets** list: name · target % · this month's SIP ₹ · kind pill (Core/Theme) · dip priority number · active. Drag to reorder dip priority. "+ Add asset" / swipe to remove (Gold goes here). Weights editor shows "sum = 100% ✓" live and offers "normalise".
3. **Theme engine** card: tiers list — "Below ₹20,000 → AI Infrastructure only" · "₹20,000+ → all themes". Edit threshold, add tier, choose allowed themes per tier. Shows which tier is active *now* and why.
4. **Dip reserve** card: balance ₹… · credits/debits history · **Deploy** button → sheet: amount, suggested split by dip priority (editable), creates Invest ledger entries + holding txns.
5. **Instrument notes** inline per asset ("Motilal Oswal Nasdaq 100 FoF").
6. Footer: "AI research (coming)" placeholder card.

Every save creates a new plan version; a "Compare with previous" toggle shows deltas.

#### 3.6.6 Portfolio
1. **Value hero**: current value ₹… · invested ₹… · gain ₹ / %.
2. **Allocation drift** bars: per asset actual % vs target % (from active plan) with a "rebalance hint" when drift > 5 pp.
3. **Holdings** list: asset · units · avg cost · last NAV (date) · value · gain. Tap → holding detail (transactions, "Update NAV" manual field; automatic in Phase 4/5).
4. **Net-worth history** line chart (from nightly snapshots) with 1M/3M/6M/1Y/All.
5. FDs shown as holdings with maturity date and a "matures in N days" reminder.

---

### 3.7 More (tab)

#### 3.7.1 Accounts
- Grouped by Account Group: Savings · Cash · Credit card · FD · Investment · Virtual (collapsed).
- Row: name · balance/due · flags (NW · Liquid) · last reconciled ("21 d ago" amber if > 14 d).
- "+ Add account": name, type, group, opening balance + date, credit limit, statement/due day, flags, bucket link, notes.

**Account detail**: balance hero · limit & utilisation (cards) · this-cycle spends · "Reconcile" button · ledger list filtered to this account · edit/archive.

**Reconcile sheet** (your HOW TO FIX A DIFFERENCE, as a flow):
1. Shows Calculated ₹… · input **Actual** (from bank app) · live Difference.
2. If 0 → "Mark reconciled today" ✓.
3. If ≠ 0 → two big buttons: **Find missing transaction** (Ledger filtered to this account since last reconciled, with the difference amount highlighted as a search hint) · **Add adjustment** (Quick Add prefilled: type Adjustment, amount = |difference|, direction auto, category Reconciliation, note required).
4. History list of past checks.

#### 3.7.2 Categories
- List grouped by Group; each row: name · default-in-budget switch · usage count. Add / rename / merge / archive. Merge re-tags ledger entries (with undo).

#### 3.7.3 Settings
- Money: default monthly budget, expected monthly salary, salary day, EF months, essentials categories (multi-select for EF target), currency format.
- Notifications: CC due (days before), EMI due, reconcile nudge (every N days), month-end allocation reminder, budget pace warning (when used % > elapsed % + 10).
- Security: PIN, biometrics, auto-lock, blur by default.
- Data: Export (.xlsx mirroring your two sheets, .csv, .json), Import, nightly backup status, "Delete everything".
- AI (future): enable, research cadence, which assets, API key managed server-side.

#### 3.7.4 AI insights (Phase 5)
- Feed of cards: Fund brief · Dip alert · Monthly review · Rebalance suggestion. Each with sources, "Apply" (opens the relevant prefilled sheet) or "Dismiss". Nothing auto-posts.

---

## 4. Component library (build once, reuse everywhere)

| Component | Used in | Notes |
|---|---|---|
| `BigNumber` | every hero | ₹ formatting, delta chip, blur-aware |
| `PaceBar` | Home, Budget | two markers: used % and elapsed % |
| `BreakdownSheet` | free cash, next-month, EF target, goal availability | rows of label · sign · amount · link to source |
| `AccountChip`, `CategoryChip` | Quick Add, filters, rows | recent-first pickers |
| `MonthSwitcher` | Ledger, Budget | swipe-able |
| `BucketRing` | Wealth overview, Allocate | fill % with target caption |
| `WaterfallRows` | Allocate, Buckets preview | animated fill |
| `StatusPill` | Goals, Plans, Accounts | one palette: green/teal/amber/red/grey |
| `StackedMonthBar` | Home, Forecast | Loan/EMI · Lifestyle · Investment |
| `SwipeRow` | Ledger, Plans | left delete / right quick action |
| `ExplainButton` (ⓘ) | every derived number | opens formula + inputs |
| `BottomSheet` | all forms | drag handle, keyboard-safe |
| `Toast` | after save | includes the updated pace number |

---

## 5. Interaction rules & edge cases

- **Editing a past month's transaction** re-computes that month and every later snapshot; a small "recomputed" toast appears.
- **Credit-card cycle** — "this cycle" uses `statement_day`; if unset, falls back to calendar month (as the sheet does).
- **Recurring end dates** — a plan whose `end` is passed stops counting the next day; the card moves to "Ended" (your rent-vacate case).
- **Yearly plans** count only in their anniversary month (never ÷12), exactly as the sheet.
- **Negative free-to-allocate** shows red with "You're committed beyond liquid cash by ₹…" and the Allocate card hides.
- **Allocation with 0 investment** still records the run so history is continuous.
- **Deleting an account with entries** is blocked; archive instead.
- **Two-device use** — last-write-wins on a field level; ledger inserts never conflict (UUIDs).
- **Time zone** — all dates in IST regardless of device locale.
- **Number entry** — Indian grouping (₹1,40,000) everywhere; lakh/crore abbreviations only on charts.

---

## 6. Notifications (opt-in, Phase 4)

| Trigger | Message | Deep link |
|---|---|---|
| CC due in N days | "HDFC CC ₹40,121 due 12 Sep" | Account detail |
| Month start | "₹22,400 free to allocate — run the waterfall?" | Wealth ▸ Allocate |
| Recurring proposals | "3 payments to confirm" | Confirm sheet |
| Pace | "Budget 60% used, month 40% elapsed" | Home ▸ Pace |
| Reconcile nudge | "ICICI Savings unchecked for 21 days" | Reconcile |
| Goal affordable | "German Exams is affordable now" | Goal detail |
| Dip alert (Phase 5) | "NASDAQ-100 −6% from 30-day high · reserve ₹4,900" | Invest ▸ Dip reserve |

---

## 7. Accessibility & performance targets

- Contrast ≥ 4.5:1; every status pill also has text, never colour alone.
- First load < 2 s on 4G; subsequent loads from cache < 300 ms.
- Ledger list virtualised; month aggregates from SQLite views / `src/engine/`, not client sums over the full history.
- All sheets reachable by keyboard for desktop use; desktop layout is simply the phone layout centred at 480 px max width (no separate design).

---

## 8. Suggested build order for screens

1. Quick Add + Ledger + Accounts (you can start recording on day one)
2. Home (pace, CC due, free to allocate)
3. Plan tabs + Forecast
4. Reconcile flow
5. Wealth ▸ Overview, Buckets, Allocate
6. Goals
7. Invest plan + SIP split + Dip reserve
8. Portfolio + net-worth history
9. Notifications, statement import
10. AI insights
