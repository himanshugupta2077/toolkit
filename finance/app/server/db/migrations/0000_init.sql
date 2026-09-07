CREATE TABLE buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL UNIQUE,
  target_rule TEXT NOT NULL CHECK (target_rule IN ('fixed','months_of_essentials','none')),
  target_amount INTEGER,
  target_months INTEGER,
  fill_mode TEXT NOT NULL CHECK (fill_mode IN ('until_target','percent','fixed','remainder')),
  fill_value INTEGER,
  min_monthly INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  colour TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category_group TEXT NOT NULL,
  default_in_budget INTEGER NOT NULL DEFAULT 1,
  is_essential INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','virtual')),
  account_group TEXT NOT NULL CHECK (account_group IN ('savings','cash','credit_card','fd','investment','virtual','loan','other')),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  opening_date TEXT NOT NULL,
  credit_limit INTEGER,
  include_net_worth INTEGER NOT NULL DEFAULT 1,
  include_liquid INTEGER NOT NULL DEFAULT 0,
  bucket_id TEXT REFERENCES buckets(id),
  statement_day INTEGER,
  due_day INTEGER,
  is_archived INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  virtual_kind TEXT CHECK (virtual_kind IS NULL OR virtual_kind IN ('employer','external','expense')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_budget INTEGER NOT NULL,
  monthly_salary INTEGER NOT NULL,
  salary_day INTEGER,
  ef_months INTEGER NOT NULL DEFAULT 6,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT,
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer','cc_payment','refund','investment','adjustment')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  from_account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  in_budget INTEGER NOT NULL,
  notes TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual','excel','statement','recurring_auto','allocation','ai')),
  source_hash TEXT,
  goal_id TEXT,
  holding_txn_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (from_account_id <> to_account_id)
);
--> statement-breakpoint
CREATE INDEX ix_ledger_date ON ledger_entries(date) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX ix_ledger_from ON ledger_entries(from_account_id, date) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX ix_ledger_to ON ledger_entries(to_account_id, date) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX ix_ledger_category ON ledger_entries(category_id, date) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX ux_ledger_hash ON ledger_entries(source_hash) WHERE source_hash IS NOT NULL;
--> statement-breakpoint
CREATE TABLE month_budgets (
  month TEXT PRIMARY KEY,
  budget_cap INTEGER NOT NULL,
  note TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE recurring_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','yearly','weekly','every_n_months')),
  every_n INTEGER,
  amount INTEGER NOT NULL,
  start_date TEXT,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  kind TEXT CHECK (kind IS NULL OR kind IN ('loan_emi','lifestyle','investment')),
  pay_from_account_id TEXT REFERENCES accounts(id),
  auto_propose INTEGER NOT NULL DEFAULT 0,
  last_proposed_month TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE one_time_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  expected_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
  status TEXT NOT NULL CHECK (status IN ('planned','completed','cancelled')),
  pay_from_account_id TEXT REFERENCES accounts(id),
  linked_entry_id TEXT REFERENCES ledger_entries(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE expected_inflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  expected_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  is_liquid INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('expected','received','dropped')),
  linked_entry_id TEXT REFERENCES ledger_entries(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
--> statement-breakpoint
CREATE VIEW v_account_balance AS
SELECT a.id, a.name, a.type, a.account_group, a.include_liquid, a.include_net_worth,
       a.opening_balance
       + COALESCE((SELECT SUM(amount) FROM ledger_entries e WHERE e.to_account_id   = a.id AND e.deleted_at IS NULL),0)
       - COALESCE((SELECT SUM(amount) FROM ledger_entries e WHERE e.from_account_id = a.id AND e.deleted_at IS NULL),0)
       AS asset_balance
FROM accounts a;
--> statement-breakpoint
CREATE VIEW v_month_ledger AS
SELECT substr(date,1,7) AS month, type, in_budget, category_id, SUM(amount) AS total
FROM ledger_entries WHERE deleted_at IS NULL
GROUP BY 1,2,3,4;
