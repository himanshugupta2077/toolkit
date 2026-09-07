CREATE TABLE allocation_runs (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  surplus_input INTEGER NOT NULL,
  override_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed','confirmed')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);
--> statement-breakpoint
CREATE TABLE allocation_run_lines (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES allocation_runs(id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL REFERENCES buckets(id),
  proposed_amount INTEGER NOT NULL,
  confirmed_amount INTEGER,
  ledger_entry_id TEXT REFERENCES ledger_entries(id)
);
--> statement-breakpoint
CREATE INDEX ix_alloc_runs_month ON allocation_runs(month, created_at);
--> statement-breakpoint
CREATE INDEX ix_alloc_lines_run ON allocation_run_lines(run_id);
