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
--> statement-breakpoint
CREATE INDEX ix_recon_account ON reconciliations(account_id, checked_at);
