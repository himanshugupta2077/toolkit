CREATE TABLE invest_plans (
  id TEXT PRIMARY KEY,
  effective_from TEXT NOT NULL,
  sip_bp INTEGER NOT NULL,
  dip_reserve_bp INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE invest_theme_tiers (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES invest_plans(id) ON DELETE CASCADE,
  below_amount INTEGER,
  allowed_asset_ids TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_amount INTEGER,
  target_date TEXT,
  priority INTEGER NOT NULL,
  funding_bucket_id TEXT NOT NULL REFERENCES buckets(id),
  status TEXT NOT NULL CHECK (status IN ('active','paused','achieved','dropped')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE goal_contributions (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  ledger_entry_id TEXT REFERENCES ledger_entries(id),
  note TEXT
);
--> statement-breakpoint
CREATE INDEX ix_goals_priority ON goals(priority);
--> statement-breakpoint
CREATE INDEX ix_goal_contrib_goal ON goal_contributions(goal_id, date);
