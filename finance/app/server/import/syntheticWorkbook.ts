import * as XLSX from "xlsx";

function sheet(name: string, rows: unknown[][], wb: XLSX.WorkBook): void {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function serial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return utc / 86_400_000 + 25569;
}

/** Small Finance-Mng-shaped workbook for tests. Not live data. */
export function buildSyntheticFinanceXlsx(): Buffer {
  const wb = XLSX.utils.book_new();

  sheet(
    "Configuration",
    [
      ["CONFIGURATION"],
      [],
      [],
      ["BUDGET DEFAULT"],
      ["Setting", "Value"],
      ["Default Monthly Budget (₹)", 31000],
      ["Monthly Salary (₹)", 140000],
      ["ACCOUNTS"],
      [],
      [
        "Account",
        "Type",
        "Opening Balance (₹)",
        "Credit Limit (₹)",
        "Include in Net Worth",
        "Include in Liquid Cash",
        "Account Group",
        "Notes",
      ],
      ["HDFC Savings", "Asset", 1000.5, null, "TRUE", "TRUE", "Savings", "test"],
      ["HDFC Credit Card", "Liability", 0, 100000, "TRUE", "FALSE", "Credit Card", ""],
      ["FD", "Asset", 0, null, "TRUE", "FALSE", "FD", ""],
      ["Employer", "Virtual", 0, null, "FALSE", "FALSE", "Virtual", ""],
      ["Expense", "Virtual", 0, null, "FALSE", "FALSE", "Virtual", ""],
      ["External", "Virtual", 0, null, "FALSE", "FALSE", "Virtual", ""],
      [],
      [],
      ["CATEGORIES"],
      [],
      ["Category", "Group", "Typical Budget?"],
      ["Groceries - Physical", "Food", "TRUE"],
      ["Eating outside", "Food", "TRUE"],
      ["EMIs", "Fixed", "FALSE"],
      ["Reconciliation", "Finance", "FALSE"],
      ["Salary", "Income", "FALSE"],
      ["FD Deposit", "Finance", "FALSE"],
    ],
    wb,
  );

  sheet(
    "Ledger",
    [
      [
        "Date",
        "Time",
        "Day",
        "Month",
        "Year",
        "Type",
        "Amount (₹)",
        "From Account",
        "To Account",
        "Category",
        "Include in Budget",
        "Notes",
        "Source",
      ],
      [serial("2026-09-01"), null, null, null, null, "Expense", 250.25, "HDFC Savings", "Expense", "Groceries - Physical", true, "milk", "manual"],
      [serial("2026-09-01"), null, null, null, null, "Expense", 100, "HDFC Savings", "Expense", "Eating outside", null, "blank budget flag", "manual"],
      [serial("2026-09-02"), null, null, null, null, "Investment", 500, "HDFC Savings", "FD", "FD Deposit", false, "fd", "manual"],
      [serial("2026-09-02"), null, null, null, null, "Income", 140000, "Employer", "HDFC Savings", "Salary", false, "salary", "manual"],
      [serial("2026-09-03"), null, null, null, null, "Adjustment", 50, "External", "HDFC Credit Card", "EMIs", false, "bad category adjustment", "manual"],
      [serial("2026-09-03"), null, null, null, null, "Refund", 20, "Expense", "HDFC Savings", "Groceries - Physical", true, "dup refund", "manual"],
      [serial("2026-09-03"), null, null, null, null, "Refund", 20, "Expense", "HDFC Savings", "Groceries - Physical", true, "dup refund", "manual"],
    ],
    wb,
  );

  sheet(
    "Monthly Budget",
    [
      ["MONTHLY BUDGET"],
      ...Array.from({ length: 17 }, () => []),
      ["MONTH-BY-MONTH"],
      ["Month Start", "Budget", "Income"],
      [serial("2026-09-01"), 31000, 0],
    ],
    wb,
  );

  sheet(
    "Reconciliation",
    [
      ["ACCOUNT RECONCILIATION"],
      [],
      [],
      ["Account", "Type", "Calculated", "Actual", "Difference", "Last Reconciled", "Notes"],
      ["HDFC Savings", "Asset", null, 140190.25, null, serial("2026-09-03"), "stmt"],
      ["HDFC Credit Card", "Liability", null, 50, null, serial("2026-09-03"), "due"],
      ["FD", "Asset", null, 500, null, serial("2026-09-02"), "booked"],
    ],
    wb,
  );

  const pe: unknown[][] = Array.from({ length: 110 }, () => []);
  pe[0] = ["PLANNED EXPENSES"];
  pe[12] = ["RECURRING EXPENSES"];
  pe[13] = [
    "Expense",
    "Category",
    "Frequency",
    "Amount",
    "Start",
    "End",
    "Active",
    "Monthly Equivalent",
    "Payment Method",
    "Notes",
    "Kind",
  ];
  pe[14] = [
    "MacBook SmartEMI",
    "EMIs",
    "Monthly",
    38200,
    serial("2026-09-01"),
    serial("2027-02-01"),
    "TRUE",
    null,
    "HDFC CC",
    "letter",
    "Loan / EMI",
  ];
  pe[15] = [
    "Spotify",
    "Eating outside",
    "Monthly",
    119,
    serial("2026-08-01"),
    null,
    "TRUE",
    null,
    null,
    "",
    "Lifestyle",
  ];
  pe[65] = ["UPCOMING ONE-TIME EXPENSES"];
  pe[66] = [
    "Expense",
    "Category",
    "Expected Month",
    "Expected Date",
    "Amount",
    "Priority",
    "Status",
    "Notes",
    "Effective Date",
  ];
  pe[67] = [
    "Laptop Purchase",
    "EMIs",
    serial("2026-08-01"),
    serial("2026-08-09"),
    1000,
    "Medium",
    "Completed",
    "bought",
    null,
  ];
  pe[100] = ["EXPECTED INFLOWS — planning only"];
  pe[101] = [
    "Item",
    "Category",
    "Expected Month",
    "Expected Date",
    "Amount",
    "Liquid?",
    "Status",
    "Notes",
  ];
  pe[102] = [
    "Landlord refund",
    "Salary",
    serial("2026-09-01"),
    serial("2026-09-21"),
    21600,
    "Yes, when received",
    "Expected",
    "park in savings",
  ];
  pe[103] = [
    "Voucher",
    "Salary",
    serial("2026-09-01"),
    serial("2026-09-30"),
    3500,
    "No — voucher",
    "Expected",
    "not cash",
  ];
  sheet("Planned Expenses", pe, wb);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return Buffer.from(buf);
}

export function addLedgerRow(buf: Buffer, notes: string, amount = 10): Buffer {
  const wb = XLSX.read(buf, { type: "buffer", raw: true, cellDates: false });
  const ws = wb.Sheets.Ledger;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  rows.push([
    serial("2026-09-04"),
    null,
    null,
    null,
    null,
    "Expense",
    amount,
    "HDFC Savings",
    "Expense",
    "Eating outside",
    true,
    notes,
    "manual",
  ]);
  wb.Sheets.Ledger = XLSX.utils.aoa_to_sheet(rows);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}
