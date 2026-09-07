# Index — UI source in this pack

**Dump file:** `04_SOURCE.txt` (60 files, 12 440 lines, ~406 KB).  
**App root:** `toolkit/finance/new proper web app/app/`  
**Generated from live source.** Paths below are `app/...` as they appear in git.

Legend for **Touch**:

| Tag | Meaning |
|---|---|
| **visual** | Classes, layout, copy-as-chrome — primary edit target |
| **chrome** | Shell / sheet / toast / keypad — change look, keep API of the component |
| **class-helper** | Pure functions that **return Tailwind class strings** — OK to change the strings |
| **logic+ui** | Screen that fetches data **and** renders — change JSX/classes only |
| **logic** | Behaviour/labels/parsing — do **not** change control flow; class-returning helpers inside are OK |

Tests (`*.test.ts`) are **not** in the dump. They live next to the files and often assert behaviour, not pixels. If you rename a class a test snapshots, note it.

---

## 1. Entry / tokens / PWA

| Path | Lines | Touch | Role |
|---|---:|---|---|
| `app/index.html` | 36 | visual | Document shell, `theme-color` light `#f4f1e8` / dark `#12140f`, viewport-fit, PWA meta |
| `app/src/index.css` | 69 | **visual (start here)** | Tailwind v4 `@theme` + CSS variables + `body` + `.privacy-blur` |
| `app/src/main.tsx` | 14 | leave | React mount + service worker register |
| `app/src/App.tsx` | 83 | leave | Router. Do not add/remove routes |
| `app/public/manifest.webmanifest` | 32 | visual | `background_color` `#f4f1e8`, `theme_color` `#215c45` |
| `app/public/sw.js` | 13 | leave | Pass-through SW so Chromium will install the PWA |

Icons (not dumped; binary): `app/public/favicon.svg`, `app/public/icons/*`.

---

## 2. Shared chrome (reuse on every tab)

| Path | Lines | Touch | Role |
|---|---:|---|---|
| `app/src/ui/AppShell.tsx` | 118 | chrome | 480 px column, header “Finance OS”, scroll `main`, FAB +, 5-tab bar, toast, Quick Add sheet |
| `app/src/ui/screens.tsx` | 9 | leave | Re-exports Home/Ledger/More/Plan/Wealth |
| `app/src/ui/tabs.ts` | 13 | leave | Tab paths + labels Home / Ledger / Plan / Wealth / More |
| `app/src/ui/icons.tsx` | 212 | visual | Stroke icons, `currentColor` |
| `app/src/ui/BottomSheet.tsx` | 73 | chrome | Dim overlay `bg-black/40`, grabber, Close, `bg-sheet`, tall vs max-height |
| `app/src/ui/Toast.tsx` | 25 | chrome | Top pill `bg-ink` / `text-app`, 3.5 s |
| `app/src/ui/Keypad.tsx` | 45 | chrome | 3-col keys `bg-app` + “+” row; used by Quick Add and money settings |
| `app/src/ui/FetchError.tsx` | 24 | chrome | Laptop-down copy + Retry `bg-accent` |
| `app/src/ui/PlaceholderScreen.tsx` | 23 | visual | Unused leftover phase placeholder |
| `app/src/ui/InstallBanner.tsx` | 94 | chrome | A2HS card |
| `app/src/ui/Privacy.tsx` | 86 | chrome | `<Amount>` wraps numbers; adds `.privacy-blur` |
| `app/src/ui/LockGate.tsx` | 82 | logic+ui | Shows lock overlay; keep gate behaviour |
| `app/src/ui/LockScreen.tsx` | 102 | chrome | PIN dots + keypad `bg-sheet` |
| `app/src/ui/NetWorthSparkline.tsx` | 39 | visual | SVG stroke `text-accent` |

---

## 3. Product screens (look lives in the TSX)

| Path | Lines | Touch | Screen |
|---|---:|---|---|
| `app/src/ui/HomeScreen.tsx` | 465 | logic+ui | `/home` — pace hero, action cards, CC, free cash, 2×3 tiles, 6-month bars, recent |
| `app/src/ui/LedgerScreen.tsx` | 403 | logic+ui | `/ledger` — month switcher, search, filters sheet, day groups, amount colours |
| `app/src/ui/LedgerDetailScreen.tsx` | 329 | logic+ui | `/ledger/:id` — detail, edit, duplicate, delete (red) |
| `app/src/ui/LedgerEditSheet.tsx` | 423 | logic+ui | Edit sheet inside BottomSheet |
| `app/src/ui/QuickAddSheet.tsx` | 607 | logic+ui | Global + sheet: type chips, amount, From/To, category, keypad, Save |
| `app/src/ui/PlanScreen.tsx` | 974 | logic+ui | `/plan` — Budget / Recurring / One-time / Inflows / Forecast + local `PaceBar` |
| `app/src/ui/PlanFormSheets.tsx` | 639 | logic+ui | Cap / recurring / one-time / inflow forms |
| `app/src/ui/WealthScreen.tsx` | 286 | logic+ui | `/wealth` — net worth, bucket rings, assets/liabilities, goals strip, invest, allocate CTA |
| `app/src/ui/AllocateScreen.tsx` | 452 | logic+ui | `/wealth/allocate` — waterfall rows, confirm |
| `app/src/ui/BucketEditorScreen.tsx` | 402 | logic+ui | `/wealth/buckets` — rules + colour field |
| `app/src/ui/GoalsScreen.tsx` | 199 | logic+ui | `/wealth/goals` — list + pills |
| `app/src/ui/GoalDetailScreen.tsx` | 343 | logic+ui | `/wealth/goals/:id` |
| `app/src/ui/GoalFormSheet.tsx` | 131 | logic+ui | Add/edit goal sheet |
| `app/src/ui/InvestScreen.tsx` | 540 | logic+ui | `/wealth/invest` — SIP/dip, assets, theme, dip reserve |
| `app/src/ui/InvestSheets.tsx` | 235 | logic+ui | Invest sub-sheets |
| `app/src/ui/PortfolioScreen.tsx` | 295 | logic+ui | `/wealth/portfolio` — value, drift, holdings, FDs |
| `app/src/ui/HoldingDetailScreen.tsx` | 254 | logic+ui | `/wealth/portfolio/:id` |
| `app/src/ui/MoreScreen.tsx` | 38 | visual | `/more` — three rows in a grouped list |
| `app/src/ui/AccountsScreen.tsx` | 180 | logic+ui | `/more/accounts` |
| `app/src/ui/AccountDetailScreen.tsx` | 283 | logic+ui | `/more/accounts/:id` |
| `app/src/ui/AccountFormSheet.tsx` | 359 | logic+ui | Add/edit account |
| `app/src/ui/ReconcileScreen.tsx` | 246 | logic+ui | `/more/accounts/:id/reconcile` |
| `app/src/ui/CategoriesScreen.tsx` | 207 | logic+ui | `/more/categories` |
| `app/src/ui/CategoryFormSheet.tsx` | 115 | logic+ui | Add/edit category |
| `app/src/ui/SettingsScreen.tsx` | 452 | logic+ui | `/more/settings` — Money + Security |

---

## 4. Helpers (mostly logic; a few class strings)

Change **only** functions that return CSS classes, unless a label is purely visual (it isn’t — leave copy).

| Path | Lines | Touch | Visual hooks |
|---|---:|---|---|
| `app/src/ui/copy.ts` | 23 | leave | Laptop-down error strings |
| `app/src/ui/home.ts` | 245 | leave | Pace labels, tiles, forecast bar math (not colours) |
| `app/src/ui/ledger.ts` | 320 | class-helper | **`amountClass`**: in emerald / out red / transfer muted |
| `app/src/ui/plan.ts` | 254 | class-helper | **`chipClass`**, **`paceDotClass`** |
| `app/src/ui/quickAdd.ts` | 447 | leave | Amount keypad state machine, type defaults |
| `app/src/ui/accounts.ts` | 115 | leave | Groups, stale-reconcile days |
| `app/src/ui/wealth.ts` | 166 | leave | Ring % math, captions; colour passed through |
| `app/src/ui/allocate.ts` | 115 | leave | Waterfall captions |
| `app/src/ui/goals.ts` | 151 | class-helper | **`pillClass`** emerald/teal/amber/stone |
| `app/src/ui/invest.ts` | 258 | leave | SIP % captions |
| `app/src/ui/portfolio.ts` | 69 | leave | Sparkline point math |
| `app/src/ui/categories.ts` | 68 | leave | Grouping |
| `app/src/ui/privacy.ts` | 22 | leave | sessionStorage blur flag |
| `app/src/ui/install.ts` | 30 | leave | When to show A2HS |
| `app/src/ui/lock.ts` | 108 | leave | PIN / WebAuthn |

**Duplicated visual helpers (fix together if you tokenise them):**

- `chipClass` in `plan.ts`, `LedgerScreen.tsx`, `QuickAddSheet.tsx` (same string)
- `bandFill` / `PaceBar` in `HomeScreen.tsx` **and** `PlanScreen.tsx`

---

## 5. Intentionally omitted from `04_SOURCE.txt`

Do not restyle these unless the implementing AI later asks.

| Area | Path | Why omitted |
|---|---|---|
| Calculation engine | `app/src/engine/*` | Pure money math |
| HTTP client | `app/src/api/*` | Fetch wrappers |
| Server / SQLite | `app/server/*` | API + DB |
| Dev tools | `app/src/dev/EnginePage.tsx`, `StorePage.tsx` | Internal import/wipe UI |
| Tests | `app/src/**/*.test.ts(x)` | Behaviour |
| Build output | `app/dist/`, `app/dist-server/` | Generated |
| Product specs | parent `01_*.md`, `02_*.md`, `plan.md` | Summarised in `02_APP.md` / `03_UI_CURRENT.md` |

---

## 6. Routes (do not add/remove)

| Path | Screen |
|---|---|
| `/` | Redirect → `/home` |
| `/home` | HomeScreen |
| `/ledger` | LedgerScreen |
| `/ledger/:entryId` | LedgerDetailScreen |
| `/plan` | PlanScreen (`?tab=` budget\|recurring\|one-time\|inflows\|forecast) |
| `/wealth` | WealthScreen |
| `/wealth/allocate` | AllocateScreen |
| `/wealth/buckets` | BucketEditorScreen |
| `/wealth/goals` | GoalsScreen |
| `/wealth/goals/:goalId` | GoalDetailScreen |
| `/wealth/invest` | InvestScreen |
| `/wealth/portfolio` | PortfolioScreen |
| `/wealth/portfolio/:holdingId` | HoldingDetailScreen |
| `/more` | MoreScreen |
| `/more/accounts` | AccountsScreen |
| `/more/accounts/:accountId` | AccountDetailScreen |
| `/more/accounts/:accountId/reconcile` | ReconcileScreen |
| `/more/categories` | CategoriesScreen |
| `/more/settings` | SettingsScreen |
| `/dev/store`, `/dev/engine` | Out of product shell — ignore |

---

## 7. How to find a look in the dump

Search `04_SOURCE.txt` for `FILE: app/src/ui/HomeScreen.tsx` (and so on). The next block until the following `FILE:` header is the whole file.

High-leverage searches:

- `--page` / `--accent` — tokens
- `rounded-2xl border border-line bg-sheet` — default card
- `min-h-11` — tap target
- `bg-accent text-accent-fg` — primary button / selected chip
- `text-red-700` / `bg-emerald-` / `bg-amber-` — untokenised semantics
- `chipClass` / `amountClass` / `pillClass` / `paceDotClass` / `bandFill`
