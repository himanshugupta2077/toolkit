# Finance OS — Database: SQLite on the server

*Companion to `01_Architecture_and_Technical_Plan.md`, `02_Screens_and_UX_Plan.md` and `plan.md`. Supersedes every mention of Dexie / IndexedDB as the system of record.*

---

## 1. Decision

**One SQLite file on the machine you call "the server" (laptop now, VPS later). The phone is a client. The browser holds nothing you would miss.**

| Store | Role in this app |
|---|---|
| `finance.sqlite` on the server | **System of record.** Every table in this document. |
| Browser (IndexedDB / cache) | At most a read cache for snappier loads. Wiping it loses nothing. Not used at all until a later phase decides it's worth it. |
| JSON / xlsx files | **Exports and backups only.** Downloadable dumps, never read back as truth. |
| Supabase / Postgres | Optional forever. Only if you ever want a managed cloud DB. |

Why SQLite specifically:

- **Single file.** Backup = copy the file. VPS move = copy the file. No daemon, no port, no password.
- **Real transactions.** "Confirm allocation run" writes 3–5 ledger rows plus a run record; either all land or none.
- **Real SQL.** Month aggregates, per-account balances and filters become `SELECT … GROUP BY`, not client-side loops over 1,000+ rows.
- **Fits one writer.** You are one person on one phone. SQLite's single-writer model is a feature here, not a limit.
- **Same engine.** `src/engine/` is `(records, today) → result`. It does not care where the records came from. Phases 2–7 stay exactly as approved.

---

## 2. Topology

```
Phone browser  ──HTTPS over Tailscale──▶  Server process (laptop now, VPS later)
                                          ├── serves the built UI  (dist/)
                                          ├── /api/*  (JSON over HTTP)
                                          ├── runs the engine on server-side records
                                          └── finance.sqlite  (+ -wal, -shm while running)
```

- **Now:** Toolkit `./run.sh` on this machine starts the app and Tailscale Serve; phone opens the MagicDNS HTTPS URL it prints.
- **Laptop asleep → app down.** Accepted, same as Toolkit today.
- **Later:** rsync `finance.sqlite` + the build to a VPS, run the same process, point Tailscale (or a domain + Caddy) there. Schema and code unchanged.

---

## 3. Runtime and libraries

| Concern | Choice | Why | Alternative |
|---|---|---|---|
| Server runtime | **Node ≥ 20** | Same TypeScript, same `src/engine/` imports | Bun (`bun:sqlite` built in; fine if you prefer) |
| SQLite driver | **`better-sqlite3`** | Synchronous, fastest Node driver, mature, WAL-friendly | `node:sqlite` (built into Node 22+, still stabilising) |
| Query layer | **Drizzle ORM** (`drizzle-orm/better-sqlite3`) + `drizzle-kit` | Schema is TypeScript, types flow to the API, migrations generated from schema diffs | Kysely (query builder only), or hand-written SQL + `PRAGMA user_version` migrations |
| HTTP | **Hono** | Tiny, TypeScript-first, runs on Node and later anywhere | Fastify, Express |
| Dev runner | `tsx watch server/index.ts` | No build step in dev | — |
| Client data | **TanStack Query** talking to `/api` | Caching, optimistic updates, retries | — |
| Import | **SheetJS on the server** (file upload → parse → insert) | Import must write to the DB, which lives on the server | — |

Decision rule: if a phase needs a query the ORM makes awkward (window functions, recursive month series), write raw SQL in a `.sql` string. Drizzle allows `sql\`…\``. Do not fight the tool.

---

## 4. Project layout change

Stay one package (no monorepo yet). Add a `server/` folder beside `src/`.

```
app/
  package.json            ← one package; scripts for client, server, both
  vite.config.ts          ← dev proxy: /api → http://127.0.0.1:8787
  drizzle.config.ts
  src/
    engine/               ← unchanged (pure functions + tests)
    ui/                   ← screens
    api/                  ← typed fetch helpers + TanStack Query hooks (replaces src/store/)
    import/               ← xlsx *client* helpers only (file picker, progress UI)
  server/
    index.ts              ← Hono app: static dist/ + /api routes
    db/
      client.ts           ← open DB, PRAGMAs, run migrations on boot
      schema.ts           ← Drizzle tables (section 5)
      migrations/         ← generated SQL, committed to git
    repo/                 ← one file per aggregate: ledger.ts, accounts.ts, plans.ts, buckets.ts …
    books.ts              ← loadBooks(db, today) → the `Books` object the engine already consumes
    routes/               ← ledger.ts, month.ts, cash.ts, allocation.ts, import.ts, export.ts …
    import/               ← SheetJS parsers (Phase 10–11), server-side
  data/                   ← gitignored; finance.sqlite lives here in dev
  fixtures/               ← gitignored xlsx copies (unchanged)
```

`tsconfig` gets a second project (`tsconfig.server.json`) that includes `server/**` and `src/engine/**` only. The engine is DOM-free, so it compiles on both sides.

`package.json` scripts:

```json
{
  "dev": "concurrently \"vite\" \"tsx watch server/index.ts\"",
  "build": "tsc -b && vite build && tsc -p tsconfig.server.json",
  "start": "node dist-server/index.js",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx server/db/migrate.ts",
  "db:backup": "tsx server/db/backup.ts",
  "test": "vitest"
}
```

---

## 5. Schema

Conventions (all frozen product rules carry over):

- `id TEXT PRIMARY KEY` — UUID v7 (time-ordered, sorts by creation) generated on the server.
- Money: `INTEGER` paise. Never `REAL`.
- Dates: `TEXT` ISO `YYYY-MM-DD` (IST civil date); months `TEXT` `YYYY-MM`; timestamps `TEXT` ISO-8601 UTC.
- Booleans: `INTEGER` 0/1.
- Every mutable table: `created_at`, `updated_at`. Ledger additionally `deleted_at` (soft delete; the engine's `loadBooks` filters `deleted_at IS NULL`).
- Foreign keys on, `ON DELETE RESTRICT` by default — you archive accounts and categories, you do not delete them.

### 5.1 Tables

```sql
-- Reference
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','virtual')),
  account_group TEXT NOT NULL CHECK (account_group IN ('savings','cash','credit_card','fd','investment','virtual')),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  opening_date TEXT NOT NULL,
  credit_limit INTEGER,
  include_net_worth INTEGER NOT NULL DEFAULT 1,
  include_liquid INTEGER NOT NULL DEFAULT 0,
  bucket_id TEXT REFERENCES buckets(id),
  statement_day INTEGER, due_day INTEGER,
  is_archived INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category_group TEXT NOT NULL,
  default_in_budget INTEGER NOT NULL DEFAULT 1,
  is_essential INTEGER NOT NULL DEFAULT 0,       -- feeds EF target
  sort INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE settings (                           -- single row, id = 1
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_budget INTEGER NOT NULL,
  monthly_salary INTEGER NOT NULL,
  salary_day INTEGER,
  ef_months INTEGER NOT NULL DEFAULT 6,
  updated_at TEXT NOT NULL
);

-- Ledger (system of record)
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL, time TEXT,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer','cc_payment','refund','investment','adjustment')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  from_account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id   TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  in_budget INTEGER NOT NULL,
  notes TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual','excel','statement','recurring_auto','allocation')),
  source_hash TEXT,                               -- idempotent xlsx import
  goal_id TEXT REFERENCES goals(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK (from_account_id <> to_account_id)
);
CREATE INDEX ix_ledger_date        ON ledger_entries(date) WHERE deleted_at IS NULL;
CREATE INDEX ix_ledger_from        ON ledger_entries(from_account_id, date) WHERE deleted_at IS NULL;
CREATE INDEX ix_ledger_to          ON ledger_entries(to_account_id, date)   WHERE deleted_at IS NULL;
CREATE INDEX ix_ledger_category    ON ledger_entries(category_id, date)     WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_ledger_hash ON ledger_entries(source_hash) WHERE source_hash IS NOT NULL;

CREATE TABLE month_budgets (
  month TEXT PRIMARY KEY,                          -- 'YYYY-MM'
  budget_cap INTEGER NOT NULL,
  note TEXT, updated_at TEXT NOT NULL
);

CREATE TABLE reconciliations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  checked_at TEXT NOT NULL,
  calculated_balance INTEGER NOT NULL,
  actual_balance INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('none','added_txn','adjustment')),
  adjustment_entry_id TEXT REFERENCES ledger_entries(id),
  notes TEXT
);

-- Planning (never posts to ledger)
CREATE TABLE recurring_plans (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','yearly','weekly','every_n_months')),
  every_n INTEGER,
  amount INTEGER NOT NULL,
  start_date TEXT, end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  kind TEXT CHECK (kind IN ('loan_emi','lifestyle','investment')),  -- NULL = infer (P5 rule)
  pay_from_account_id TEXT REFERENCES accounts(id),
  auto_propose INTEGER NOT NULL DEFAULT 0,
  last_proposed_month TEXT,
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE one_time_plans (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  expected_date TEXT NOT NULL, amount INTEGER NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
  status TEXT NOT NULL CHECK (status IN ('planned','completed','cancelled')),
  pay_from_account_id TEXT REFERENCES accounts(id),
  linked_entry_id TEXT REFERENCES ledger_entries(id),
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE expected_inflows (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  expected_date TEXT NOT NULL, amount INTEGER NOT NULL,
  is_liquid INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('expected','received','dropped')),
  linked_entry_id TEXT REFERENCES ledger_entries(id),
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Allocation
CREATE TABLE buckets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  priority INTEGER NOT NULL UNIQUE,
  target_rule TEXT NOT NULL CHECK (target_rule IN ('fixed','months_of_essentials','none')),
  target_amount INTEGER, target_months INTEGER,
  fill_mode TEXT NOT NULL CHECK (fill_mode IN ('until_target','percent','fixed','remainder')),
  fill_value INTEGER,                              -- paise, or basis points for percent
  min_monthly INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  colour TEXT, notes TEXT, updated_at TEXT NOT NULL
);

CREATE TABLE allocation_runs (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  surplus_input INTEGER NOT NULL,
  override_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed','confirmed')),
  created_at TEXT NOT NULL, confirmed_at TEXT
);
CREATE TABLE allocation_run_lines (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES allocation_runs(id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL REFERENCES buckets(id),
  proposed_amount INTEGER NOT NULL,
  confirmed_amount INTEGER,
  ledger_entry_id TEXT REFERENCES ledger_entries(id)
);

-- Goals
CREATE TABLE goals (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  target_amount INTEGER, target_date TEXT,
  priority INTEGER NOT NULL,
  funding_bucket_id TEXT NOT NULL REFERENCES buckets(id),
  status TEXT NOT NULL CHECK (status IN ('active','paused','achieved','dropped')),
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE goal_contributions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  date TEXT NOT NULL, amount INTEGER NOT NULL,
  ledger_entry_id TEXT REFERENCES ledger_entries(id),
  note TEXT
);

-- Investing (plan is versioned)
CREATE TABLE invest_plans (
  id TEXT PRIMARY KEY,
  effective_from TEXT NOT NULL,
  sip_bp INTEGER NOT NULL, dip_reserve_bp INTEGER NOT NULL,   -- basis points, sum 10000
  notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE invest_assets (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES invest_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('core','theme')),
  target_bp INTEGER NOT NULL,
  dip_priority INTEGER,
  instrument_note TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE invest_theme_tiers (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES invest_plans(id) ON DELETE CASCADE,
  below_amount INTEGER,                            -- NULL = top tier
  allowed_asset_ids TEXT NOT NULL                  -- JSON array
);
CREATE TABLE dip_reserve_ledger (
  id TEXT PRIMARY KEY, date TEXT NOT NULL,
  credit INTEGER NOT NULL DEFAULT 0, debit INTEGER NOT NULL DEFAULT 0,
  run_id TEXT REFERENCES allocation_runs(id),
  ledger_entry_id TEXT REFERENCES ledger_entries(id),
  note TEXT
);

-- Portfolio
CREATE TABLE holdings (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES invest_assets(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  last_nav INTEGER, last_nav_date TEXT,            -- NAV in paise
  updated_at TEXT NOT NULL
);
CREATE TABLE holding_txns (
  id TEXT PRIMARY KEY,
  holding_id TEXT NOT NULL REFERENCES holdings(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('buy_sip','buy_dip','sell','dividend')),
  units INTEGER NOT NULL,                          -- units × 10^6 (micro-units), integer
  nav INTEGER NOT NULL, amount INTEGER NOT NULL,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id)
);

-- History
CREATE TABLE snapshots (
  date TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id),
  balance INTEGER NOT NULL,
  PRIMARY KEY (date, account_id)
);
CREATE TABLE net_worth_daily (
  date TEXT PRIMARY KEY,
  assets INTEGER NOT NULL, liabilities INTEGER NOT NULL, liquid INTEGER NOT NULL,
  invested INTEGER NOT NULL, ef_balance INTEGER NOT NULL, savings_balance INTEGER NOT NULL
);

-- Ops
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- schema_version, last_backup, last_import_hash …
```

Tables land **by phase**, not all at once: Phase 9 creates `accounts … buckets`, `settings`, `meta`; Phase 11 adds invest tables; Phase 19 adds allocation runs; Phase 22 adds holdings/snapshots. Each is one migration file.

### 5.2 Views (read models the API returns directly)

```sql
CREATE VIEW v_account_balance AS
SELECT a.id, a.name, a.type, a.account_group, a.include_liquid, a.include_net_worth,
       a.opening_balance
       + COALESCE((SELECT SUM(amount) FROM ledger_entries e WHERE e.to_account_id   = a.id AND e.deleted_at IS NULL),0)
       - COALESCE((SELECT SUM(amount) FROM ledger_entries e WHERE e.from_account_id = a.id AND e.deleted_at IS NULL),0)
       AS asset_balance
FROM accounts a;
-- liability_due = −asset_balance for type='liability' (same formula, sign flipped); computed in repo.

CREATE VIEW v_month_ledger AS
SELECT substr(date,1,7) AS month, type, in_budget, category_id, SUM(amount) AS total
FROM ledger_entries WHERE deleted_at IS NULL
GROUP BY 1,2,3,4;
```

Views are for **listing and dashboards**. Anything with a frozen product rule (pace bands, free cash, waterfall) still goes through `src/engine/` so the tests remain the specification.

---

## 6. How the app uses the database

### 6.1 Opening the file

```ts
// server/db/client.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

const file = process.env.FINANCE_DB ?? './data/finance.sqlite';
const sqlite = new Database(file);
sqlite.pragma('journal_mode = WAL');      // readers never block the writer
sqlite.pragma('synchronous = NORMAL');    // safe with WAL, much faster
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
export const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: './server/db/migrations' });   // runs pending migrations on boot
```

One process, one connection, opened once. better-sqlite3 is synchronous, which is fine for one user and keeps repo code simple.

### 6.2 Request path

```
Phone tap → fetch('/api/ledger', POST) → Hono route
  → validateLedgerEntry(engine)  (same function Phase 2 shipped)
  → repo.ledger.insert(db, entry)         (one statement, or a transaction)
  → books = loadBooks(db, today)          (only what changed, or the whole snapshot — it's small)
  → engine.budgetPace(...), engine.freeToAllocate(...)
  → 201 { entry, pace, freeCash }         (client updates Home numbers from the response)
```

`loadBooks(db, today)` is the bridge: it selects accounts, categories, non-deleted ledger rows (optionally since a date), month budgets, plans, inflows, settings, buckets, and returns the exact `Books` shape the Phase 6 tests already use. **The engine never imports Drizzle.**

### 6.3 Writes that must be atomic

```ts
// server/repo/allocation.ts
export const confirmRun = (runId: string, lines: ConfirmedLine[]) =>
  db.transaction((tx) => {
    for (const line of lines) {
      const entryId = insertLedger(tx, { type: line.bucketGroup === 'fd' ? 'investment' : 'transfer',
        amount: line.amount, from: line.fromAccountId, to: line.toAccountId,
        category: 'Investment', inBudget: 0, source: 'allocation' });
      tx.update(allocationRunLines).set({ confirmedAmount: line.amount, ledgerEntryId: entryId })
        .where(eq(allocationRunLines.id, line.id)).run();
    }
    tx.update(allocationRuns).set({ status: 'confirmed', confirmedAt: nowIso() })
      .where(eq(allocationRuns.id, runId)).run();
  })();
```

Same pattern for: import (parse whole workbook, insert all rows, write `last_import_hash` — or nothing), reconcile-with-adjustment, dip-reserve deploy, category merge.

### 6.4 API surface (from `01` §8, adjusted for server-side import)

| Method & path | Returns |
|---|---|
| `GET /api/books?since=YYYY-MM-DD` | the `Books` snapshot (client may run engine locally for instant what-ifs) |
| `GET/POST/PATCH/DELETE /api/ledger` | ledger rows; DELETE sets `deleted_at` |
| `GET /api/accounts/balances` | from `v_account_balance` + CC due/available |
| `POST /api/reconcile` | check record (+ optional adjustment, one transaction) |
| `GET /api/month/:yyyymm` | pace + summary (engine) |
| `GET /api/cash` | free to allocate, next-month estimate, breakdown lines |
| `GET /api/forecast?months=6&assumeInflows=0` | cards with contributing lines |
| `GET/PUT /api/plans/recurring` · `/one-time` · `/inflows` · `/api/budgets/:yyyymm` | planning tables |
| `GET/PUT /api/buckets` | validated with `validateBuckets` |
| `POST /api/allocation/run` · `POST /api/allocation/:id/confirm` | proposal → ledger entries |
| `GET/PUT /api/invest/plan` · `GET /api/invest/split?amount=` · `POST /api/invest/dip-buy` | investing |
| `GET/POST /api/goals` · `POST /api/goals/:id/contribute` | goals |
| `POST /api/import/finance` · `POST /api/import/invest` (multipart xlsx) | validation report |
| `GET /api/export.json` · `.xlsx` · `.sqlite` | dumps (Phase 23) |
| `GET /api/health` | `{ ok, schemaVersion, dbFile, lastBackup }` |

Client side: `src/api/*.ts` are thin typed fetchers; screens use TanStack Query hooks with optimistic updates for Quick Add. No Dexie.

### 6.5 Tests

- **Engine tests:** unchanged.
- **Repo tests:** `new Database(':memory:')` + run migrations + insert fixtures → assert. Fast, no files.
- **Import test (Phase 10 approval):** upload fixture xlsx into a temp DB, run `loadBooks` → `computeBalances`, compare to the Reconciliation sheet to ₹1.
- **API tests:** Hono's `app.request('/api/…')` against an in-memory DB.

---

## 7. Migrations

`drizzle-kit generate` diffs `schema.ts` against the last snapshot and writes `server/db/migrations/0003_add_invest.sql`. Migrations are committed and applied at boot (`migrate()` above), so the VPS catches up the moment the new build starts.

Rules:

1. Never edit an applied migration. Add a new one.
2. Data migrations (e.g. "set `is_essential` for Rent/EMIs/Groceries") are SQL `UPDATE`s inside the same migration file.
3. Before any migration in production: take a backup (section 8). The `start` script does this automatically when `schema_version` is about to change.
4. SQLite `ALTER TABLE` is limited (no drop/alter column before 3.35). Drizzle handles the "create new table, copy, rename" dance; still read the generated SQL before running it.

---

## 8. Backup and restore

The file is the backup unit, but **do not just `cp` a live WAL database** — you can catch it mid-checkpoint. Use SQLite's own copy:

```ts
// server/db/backup.ts  (also exposed as GET /api/export.sqlite)
const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
sqlite.exec(`VACUUM INTO '${backupDir}/finance-${stamp}.sqlite'`);   // consistent, compacted copy
```

Schedule:

| When | What | Where |
|---|---|---|
| Server start | `VACUUM INTO` if last backup > 24 h or schema is about to migrate | `data/backups/` |
| Nightly (systemd timer / cron 02:00) | `npm run db:backup`, keep last 30 daily + 12 monthly | `data/backups/` and, ideally, a second disk / Syncthing folder |
| Manual | More → Data → "Download backup" → `/api/export.sqlite` and `/api/export.json` | phone / laptop Downloads |
| Phase 23 | xlsx mirror export (ledger + config + plans) | download |

Restore: stop the server, copy the chosen `finance-….sqlite` over `data/finance.sqlite` (delete stale `-wal`/`-shm`), start. Verify with `/api/health` and one reconcile.

Optional later: **Litestream** streams the WAL to any S3-compatible bucket continuously. Zero code change; worth it once the VPS is the only copy.

---

## 9. Running on the laptop behind Tailscale

```bash
cd ".../new proper web app/app"
npm run build
FINANCE_DB=/home/himanshu/finance-data/finance.sqlite PORT=8787 npm start
tailscale serve --bg 8787        # HTTPS at https://<machine>.tailf7a628.ts.net/
```

Keep the DB **outside** the repo folder (`~/finance-data/`) so a `git clean` or a reclone can never delete it.

Make it survive reboots — a user systemd unit:

```ini
# ~/.config/systemd/user/finance.service
[Unit]
Description=Finance OS server
After=network-online.target

[Service]
WorkingDirectory=/home/himanshu/Documents/project-tool-scripts-whatnot/toolkit/finance/new proper web app/app
Environment=FINANCE_DB=/home/himanshu/finance-data/finance.sqlite
Environment=PORT=8787
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist-server/index.js
Restart=on-failure

[Install]
WantedBy=default.target
```

`systemctl --user enable --now finance` and `loginctl enable-linger himanshu` so it runs without a logged-in session.

Auth: on the tailnet, Tailscale identity is the front door — the server can trust the `Tailscale-User-Login` header when behind `tailscale serve`. Add the PIN/biometric lock from `02` §3.7.3 as a second layer in Phase 17. Never bind to `0.0.0.0` on a public interface without auth.

Dev on the phone: `npm run dev` runs Vite (5173, proxying `/api`) and the server (8787); `tailscale serve 5173` as you do today.

---

## 10. Moving to a VPS later

1. Provision (any small Linux box). Install Node, `git clone`, `npm ci && npm run build`.
2. Stop the laptop service, `npm run db:backup`, `rsync` the fresh backup file to `/var/lib/finance/finance.sqlite` on the VPS.
3. Same systemd unit (system-level this time), same env vars, same port.
4. Front door: either join the VPS to your tailnet and `tailscale serve` (private), or Caddy on a domain with basic auth / Authelia (public). Private is simpler and safer for money data.
5. Point the phone at the new host. Nothing else changes: schema, migrations, engine, API, UI.
6. Reverse move works the same way. Keep the laptop as the off-site backup target (nightly `rsync` of `data/backups/` back home).

---

## 11. What changes in `plan.md`

**Stack table**

| Layer | Choice | When |
|---|---|---|
| Data | **SQLite file on the server** (`better-sqlite3` + Drizzle), server = laptop now, VPS later | Phase 9 |
| Server | **Hono on Node**, serves `dist/` + `/api`; runs the same `src/engine/` | Phase 9 |
| Import | SheetJS **server-side** (upload → parse → insert) | Phases 10–11 |
| Backend / cloud | **Not needed.** VPS with the same SQLite file = "more than this laptop". Supabase optional forever. | Phase 24 becomes "VPS move" |

**Folder**: `src/store/` → deleted; `server/` added; `src/api/` added (section 4).

**Track C** rename: "Data on device" → **"Data on the server"**.

**Phase 9 — replace with:**

> ### Phase 9 — Server + SQLite store
>
> **Goal.** The engine runs on real records in a SQLite file on the laptop, reachable from the phone over Tailscale, still without product UI.
>
> **Modules**
> 1. `server/` with Hono: serves `dist/` and `/api/health`; `npm run dev` runs Vite + server together, Vite proxies `/api`.
> 2. Drizzle schema + first migration: accounts, categories, settings, ledger_entries (soft delete), month_budgets, recurring_plans, one_time_plans, expected_inflows, buckets, meta. WAL + foreign keys on.
> 3. Repo helpers + `loadBooks(db, today)` returning the engine's `Books` type.
> 4. `GET /api/books`, `POST /api/ledger` (runs `validateLedgerEntry`), `GET /api/month/:yyyymm`.
> 5. `VACUUM INTO` backup script + `/api/export.sqlite`.
> 6. Dev page `/dev/store`: counts, "add one dummy expense", "wipe" (dangerous, red, confirm).
>
> **Out of scope.** Import, auth beyond tailnet, PWA install prompt, any product screen.
>
> **You approve when**
> - Restarting the server (and clearing browser site data) keeps the dummy row — it's in `finance.sqlite`, not the phone.
> - Adding a dummy expense from the phone over Tailscale changes `GET /api/month/2026-09` `budgetSpent`.
> - `data/backups/` gets a file from `npm run db:backup`, and opening it with `sqlite3` shows the row.
> - Wipe requires typing the word `wipe`.

**Phase 10–11**: "Parse … client-side" → "upload xlsx to `/api/import/*`; server parses and inserts in one transaction; validation report returned as JSON". Idempotency via `source_hash` unique index.

**Phase 12+ (screens)**: read/write through `/api` with TanStack Query. Optimistic update on Quick Add; on failure, the toast says "not saved" and the row disappears.

**Phase 17**: PWA install stays; add tailnet-header check + PIN lock. Note: "offline reads" is **not** promised; a later phase may add a read cache if you ever want it.

**Phase 23**: backup = `VACUUM INTO` + JSON + xlsx mirror + nightly timer (there is now a place to put it).

**Phase 24** → **"VPS move"** (section 10). Supabase paragraph deleted.

---

## 12. Quick answers

- **"Is IndexedDB a database?"** Yes, but inside the browser that opened the page. Phone and laptop each have their own; clearing site data deletes it. It's the wrong place for the books.
- **"Why not JSON files like Toolkit?"** Fine for append-only logs; once you have updates, deletes, links between tables and "all or nothing" writes, you're re-implementing a database badly.
- **"Why not Postgres now?"** An extra daemon for one user. SQLite gives the same SQL and transactions in one file. If you ever outgrow it, `pgloader` moves a SQLite file to Postgres in minutes and Drizzle supports both.
- **"Does the engine change?"** No. It still takes records and today's date. Only where the records live changed.
- **"Where does the data live in dev?"** `app/data/finance.sqlite` (gitignored). In production, `~/finance-data/finance.sqlite`, outside the repo.
