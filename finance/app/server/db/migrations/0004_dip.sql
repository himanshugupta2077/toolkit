ALTER TABLE allocation_runs ADD COLUMN invest_plan_id TEXT REFERENCES invest_plans(id);
--> statement-breakpoint
CREATE TABLE dip_reserve_ledger (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  credit INTEGER NOT NULL DEFAULT 0,
  debit INTEGER NOT NULL DEFAULT 0,
  run_id TEXT REFERENCES allocation_runs(id),
  ledger_entry_id TEXT REFERENCES ledger_entries(id),
  note TEXT
);
--> statement-breakpoint
CREATE INDEX ix_dip_reserve_date ON dip_reserve_ledger(date);
