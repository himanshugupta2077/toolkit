# Application — what Finance OS is

Personal, single-user **phone-browser PWA**. It replaces two Excel workbooks with one app:

1. **Budget / expense OS** — was `Finance-Mng-V2.xlsx` (ledger, monthly budget, pace, CC due, free cash, plans, reconcile).
2. **Investment allocator** — was `Investment_Portfolio_Allocation_Tracker.xlsx` (where leftover cash sits: emergency fund → savings buffer → investments, then SIP vs dip).

Not a public product. Owner uses it on a phone over Tailscale against a laptop server.

## Stack (v1, as built)

| Layer | Choice |
|---|---|
| UI | React 19 + TypeScript + Vite 8 + Tailwind CSS v4 |
| Data fetching | TanStack Query |
| Routing | react-router-dom, phone column in `AppShell` |
| API | Hono on Node (`app/server`), proxied `/api` → `:8787` |
| Store | SQLite on the laptop (`better-sqlite3` + Drizzle). **Not** IndexedDB as source of truth |
| Engine | Pure TS in `app/src/engine/` — UI must not reimplement formulas |
| Install | PWA (`manifest` + pass-through `sw.js`) |

Dev: from `app/`, `npm run dev` → UI `http://127.0.0.1:5173` (desktop is the same UI, centred at 480 px). Phone: Tailscale Serve on 5173.

## Spine (what the screens are for)

```
Add / import  →  Ledger (only place money moves)
                     + plans & settings
                          ↓
                 Calculation engine
                 (balances, pace, free cash, 6-month forecast)
                          ↓
                 Allocation waterfall
                 Emergency Fund → Savings buffer → Investment
                          ↓
                 Goals    Invest plan (SIP + dip)    Portfolio
```

## Frozen product rules (do not “simplify” in the UI)

These are **behaviour**. Visual redesign must still express them.

1. **Ledger is the only place money moves.** No screen lets you type a balance.
2. **Amount is always positive.** Direction is **From → To**.
3. **Planning never posts to the ledger.** Recurring / one-time / expected inflows only affect forecast and free cash.
4. **Include-in-budget** is per transaction; category supplies the default. Tiny **B** badge on ledger rows.
5. **Free to allocate** already nets commitments (liquid − budget remaining − CC due − remaining EMI − planned one-time next 30 days). Expected inflows are **shown, not added**.
6. **Waterfall, not milestones.** Surplus fills Emergency Fund until target, then Savings buffer, then remainder → Investment.
7. **Near-term goals fund from Savings**, not from the Investment bucket.
8. **AI proposes, you confirm** (AI not built yet). Nothing auto-writes a ledger row without a tap.
9. Dates are **IST**. Amounts stored as **integer paise**, shown as ₹ with Indian grouping (`formatInr`).

Negative free cash is a **first-class state**: red, copy **“Committed beyond liquid”**, Allocate CTA hidden.

## Navigation (built)

Bottom tabs, always:

**Home · Ledger · Plan · Wealth · More**

Floating **+** on every product tab → **Quick Add** bottom sheet (amount keypad first).

| Tab | What the user comes for |
|---|---|
| **Home** | Am I on pace? What’s due? What’s free? This-month tiles, 6-month strip, last 5 txns |
| **Ledger** | Month list of movements. Search, filters, detail → edit / duplicate / delete (soft) |
| **Plan** | Budget cap, recurring, one-time, expected inflows, 6-month forecast. **Never posts ledger** |
| **Wealth** | Net worth, three buckets, goals, invest plan, portfolio, monthly allocate ritual |
| **More** | Accounts, categories, settings (money + PIN/blur) |

Deep pages hang off tabs (account detail, reconcile, goal detail, holding detail, bucket editor). Back is usually a text link (“Accounts”, “Wealth”), not a system back bar.

## Screen map (what should stay findable)

```
Bottom tabs:  [Home]  [Ledger]  [Plan]  [Wealth]  [More]
                               (+) → Quick Add sheet

Home
 ├─ Pace detail (sheet)
 ├─ Credit-card row → Account detail
 ├─ Free-to-allocate breakdown (inline expand)
 ├─ Allocate this month → Wealth ▸ Allocate
 └─ Recent → Ledger detail

Ledger
 ├─ Filters (sheet)
 ├─ Transaction detail (page) → Edit (sheet)
 └─ Search

Plan  (chips: Budget · Recurring · One-time · Inflows · Forecast)
 ├─ Edit cap (sheet)
 ├─ Add/Edit recurring, one-time, inflow (sheets)
 └─ Forecast kind drill-in (sheet)

Wealth
 ├─ Allocate
 ├─ Buckets editor (gear)
 ├─ Goals → Goal detail
 ├─ Invest
 └─ Portfolio → Holding detail

More
 ├─ Accounts → Account detail → Reconcile
 ├─ Categories
 └─ Settings (salary, budget default, EF months, PIN, blur)
```

## Important UX principles (product, not decoration)

From the screens plan — keep these **even if** you restyle:

| Principle | Concretely |
|---|---|
| One-thumb | Bottom tabs, primary actions in the lower third, no hamburger |
| Entry in ≤ 10 s | + → keypad first, recent category chips |
| Numbers first | 1–3 big numbers; charts are small |
| Sheets for edits | Add/edit slide up; lists stay behind |
| No horizontal **page** scroll | Tables are card rows. Chip rows may scroll |
| Explain derived numbers | Pace / free cash have breakdowns (sheet or expand) |
| Ledger safe | Balances not editable; delete is confirm (swipe is **specified** but **not implemented**) |
| Privacy | Eye on Home blurs amounts; optional blur-by-default; PIN lock |
| PWA | Standalone, safe-area, theme-color |

Viewport target: **360–430 px**. Desktop = same column, `max-w-[480px]`.

## What is built vs specified but missing

Useful so you do not “restore” features that were never coded.

| Specified in UX plan | In the app today |
|---|---|
| Swipe ledger row delete / duplicate | **No** — tap into detail, buttons |
| Drag-to-reorder goals / dip priority | **No** — buttons / fields |
| Animated waterfall fill | Static rows |
| Long-press multi-select ledger | **No** |
| Natural-language Quick Add | **No** |
| Notifications | **No** |
| AI insights | **No** |
| Offline cache of reads | **No** — laptop down = error + Retry |
| Recharts | **Not used** — CSS bars + one SVG sparkline |

Do **not** implement missing features in this pass. You may make the existing tap/confirm/expand **clearer**.

## Copy you must not rewrite for “brand voice”

Product meaning lives in short sentences. Restyle around them; do not clever-rewrite:

- “Planning never posts to the ledger.”
- “Committed beyond liquid”
- “Safe to spend today …”
- “Expected, not counted” / “Free to allocate ignores these until they land in the ledger.”
- “Type the number from the bank app. Do not edit the calculated balance.”
- “Can't reach the laptop. It may be asleep — nothing is stored on this phone.”
- “Buckets, not a typed balance.”

Error/retry chrome: `FetchError` + `copy.ts`.

## Audience and tone of the UI

One person, daily capture on a phone, rupee amounts, serious money. Not a consumer fintech marketing page. Prefer **calm, dense, readable** over illustration, gradients, or extra icons. The owner already said the current look is **muddy and hard to see** — fix that, do not add more colour for its own sake.
