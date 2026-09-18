CREATE TABLE recurring_plans_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','yearly','weekly','every_n_months')),
  every_n INTEGER,
  amount INTEGER NOT NULL,
  start_date TEXT,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  kind TEXT CHECK (kind IS NULL OR kind IN ('loan_emi','lifestyle','investment','bill')),
  pay_from_account_id TEXT REFERENCES accounts(id),
  auto_propose INTEGER NOT NULL DEFAULT 0,
  last_proposed_month TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO recurring_plans_new SELECT * FROM recurring_plans;
--> statement-breakpoint
DROP TABLE recurring_plans;
--> statement-breakpoint
ALTER TABLE recurring_plans_new RENAME TO recurring_plans;
--> statement-breakpoint
ALTER TABLE one_time_plans ADD COLUMN kind TEXT CHECK (kind IS NULL OR kind IN ('loan_emi','lifestyle','investment','bill'));
