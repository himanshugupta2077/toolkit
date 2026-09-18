# Finance OS

Phone-first personal finance app. Replaces two Excel workbooks. This folder is the Vite app; product rules live in the parent `plan.md`.

Toolkit serves it at **`/finance`**. `./run.sh` from the toolkit root builds (if needed), starts FastAPI on 8000, and spawns this API on `127.0.0.1:8787`. The previous xlsx phone UI is at `/old-finance`.

## Run

**Normal:** from toolkit root, `./run.sh`, then open `/finance`.

Dev (this folder only):

```bash
npm install
npm run dev
```

That starts Vite (5173) and the Hono API (8787). The UI base path is `/finance/`, so open `http://127.0.0.1:5173/finance/`. Vite proxies `/finance/api` (and `/api`) to the API.

- **`npm run dev` uses `data/finance.sqlite`** — the live books (Excel import). Default path is the same as `npm start`.
- **Sandbox copy** is `data/finance-dev.sqlite`. Recreate it with `npm run db:dev` (VACUUM INTO from live, then a labelled ₹2,00,000 income). Run against it with `FINANCE_DB=./data/finance-dev.sqlite npm run dev`. Both files are gitignored.

Desktop is the same UI, centred at 480px.

### Install as an app (Android Chrome / Brave)

Install from the toolkit HTTPS origin at **`/finance`** (the Tailscale URL `./run.sh` prints). HTTP cannot be a standalone app.

1. Delete the old home-screen shortcut (that one is a browser bookmark).
2. Open the HTTPS URL, wait a second for the service worker.
3. Chrome: menu → **Install app** (or **Add to Home screen** if it still says that). Brave: **Add to Home screen**.
4. Open the new icon. It should be fullscreen — no browser address bar.

If it still opens in the browser, the old shortcut is still there, or you installed from HTTP.

## Quick Add (Phase 12)

Floating **+** on every product tab opens the sheet. Choose **Form**, **Type**, or **Speak**. Form is the manual row (amount field, From/To, category, date, note, **Save**). Type sends a sentence to DeepSeek (`POST /api/finance-os/parse`) then `POST /api/ledger` with `source=ai`. Speak records audio, saves a Voice note, parses the transcript the same way, then posts the row. After save, Ledger, Home pace, and this-month budget spent should move.

## Home (Phase 15)

`/` and `/home` are the Simple Dashboard: pace, credit-card due, free to allocate (with the sheet breakdown), this-month tiles, a 6-month strip, last 5 transactions. Numbers come from `GET /api/home` (same engine as `/dev/store`). Negative free cash is red and says **committed beyond liquid**. Tiles open Ledger with a filter. Allocate is visible when free is positive and opens `/wealth/allocate`.

## Wealth (Phase 18)

`/wealth` is net worth, a sparkline from daily snapshots, the three bucket cards (fill vs target, tagged accounts), and assets vs liabilities. Emergency Fund fill uses **FD** (and any other account tagged to that bucket). Gear → `/wealth/buckets` edits order, target rule, fill mode, and linked accounts. **Portfolio** → `/wealth/portfolio` is holdings, allocation drift, and FD maturity. The live example uses today's free-to-allocate surplus. Changing a Savings target updates the rings and the example split and does **not** post ledger rows.

## Allocate (Phase 19)

`/wealth/allocate` is the monthly ritual. Surplus starts as today's free-to-allocate (editable with a reason). The waterfall shows the three bucket rows; you can type an amount and pick From → To (e.g. HDFC Savings → FD). If Investment > 0, a read-only SIP / dip preview appears (Edit plan → `/wealth/invest`). **Confirm** writes Transfer/Investment ledger rows plus the run in one SQLite transaction (`source=allocation`). Confirmed runs are not rewritten — a later allocate is a new run. Negative free cash hides the CTA (same “Committed beyond liquid” copy as Home). Confirming an Investment line also credits the dip reserve.

## Invest (Phase 21)

`/wealth/invest` is the plan editor. SIP/dip sliders must sum to 100. Assets have %, kind, dip priority, active, and an instrument note. **Save version** inserts a new plan (`effective_from=today`); old allocation runs keep the old version. Theme engine tiers are editable. This month’s SIP list uses the last confirmed investment amount (or a what-if). Dip reserve shows balance + history. **Deploy** writes Investment ledger rows, and a holding txn when that asset is already tracked and has a NAV.

## Portfolio (Phase 22)

`/wealth/portfolio` is current value, invested cost, gain, allocation drift vs the current plan (rebalance hint when a weight is more than 5 percentage points off), holdings (units, avg cost, last NAV, value, gain), and FDs with optional maturity. Tap a holding to **Update NAV** (manual) or **Record buy**. Opening Wealth or Portfolio writes today’s net-worth snapshot if it is missing; **Snapshot** and a confirmed Allocate run upsert today’s point. Manual NAV is marked to market on the linked account (ledger cost replaced by current value), so net worth moves. Schema version **6**.

## Ledger (Phase 13)

`/ledger` is the month list: day groups, In / Out / Budget strip, search, filters. Tap a row for detail → **Edit** (sheet), **Duplicate** (to today), **Delete** (confirm, soft). There is no balance field. Rows live in SQLite (`GET/PATCH/DELETE /api/ledger`).

## Categories, Settings, PWA (Phase 17)

More → **Categories**: grouped list, default include-in-budget switch, add / rename / archive. Merge can wait. Changing the switch does **not** rewrite old ledger rows.

More → **Settings → Money**: default monthly budget, expected salary, salary day, emergency-fund months, essentials (for the EF target). Changing the default budget only fills months that do not already have a cap row.

**Privacy:** Home eye icon blurs amounts. Settings can turn “blur by default” on. Numbers still compute; they are just hidden.

**PIN / phone unlock:** Settings → Security. PIN is a second layer on this phone. The API front door is the tailnet (`Tailscale-User-Login` when behind `tailscale serve`). The server refuses `HOST=0.0.0.0` without Tailscale auth unless you set `FINANCE_ALLOW_UNAUTH=1`.

**Install:** second visit shows Add to Home Screen. Entries still hit `/api` on the laptop — nothing you would miss is stored in the phone. If the laptop sleeps, the app is down.

```bash
# Optional production bind (never on a public interface without auth)
FINANCE_REQUIRE_TAILSCALE=1 FINANCE_TAILNET_USER=you@github HOST=127.0.0.1 PORT=8787 npm start
```

## Store (Phase 9–11)

With `npm run dev` running, open `/dev/store` (counts, dummy expense, **Import Finance-Mng**, wipe). Wipe only runs if you type `wipe`.

Import: choose a copy of `Finance-Mng-V2.xlsx`. Tick **Wipe existing rows first** if dummy expenses would throw balances off. The report compares each account’s engine balance to the sheet formula (opening + ledger) and must match to ₹1. Re-import without wipe skips ledger rows that already have a `source_hash`.

```bash
npm run db:backup    # VACUUM INTO data/backups/finance-….sqlite
```

Production-style (after `npm run build`):

```bash
FINANCE_DB=/home/himanshu/finance-data/finance.sqlite PORT=8787 npm start
```

Then `tailscale serve 8787` if you want the phone on the built UI + API together.

## Test

```bash
npm test
```

## Build

```bash
npm run build
```
