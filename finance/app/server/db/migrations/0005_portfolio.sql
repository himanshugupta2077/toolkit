ALTER TABLE accounts ADD COLUMN maturity_date TEXT;
--> statement-breakpoint
CREATE TABLE holdings (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES invest_assets(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  last_nav INTEGER,
  last_nav_date TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX ux_holdings_asset_account ON holdings(asset_id, account_id);
--> statement-breakpoint
CREATE TABLE holding_txns (
  id TEXT PRIMARY KEY,
  holding_id TEXT NOT NULL REFERENCES holdings(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('buy_sip','buy_dip','sell','dividend')),
  units INTEGER NOT NULL,
  nav INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id)
);
--> statement-breakpoint
CREATE INDEX ix_holding_txns_holding ON holding_txns(holding_id, date);
--> statement-breakpoint
CREATE TABLE snapshots (
  date TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  balance INTEGER NOT NULL,
  PRIMARY KEY (date, account_id)
);
--> statement-breakpoint
CREATE TABLE net_worth_daily (
  date TEXT PRIMARY KEY,
  assets INTEGER NOT NULL,
  liabilities INTEGER NOT NULL,
  liquid INTEGER NOT NULL,
  invested INTEGER NOT NULL,
  ef_balance INTEGER NOT NULL,
  savings_balance INTEGER NOT NULL
);
