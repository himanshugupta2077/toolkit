import * as XLSX from "xlsx";

function sheet(name: string, rows: unknown[][], wb: XLSX.WorkBook): void {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

/** Small investment-tracker-shaped workbook for tests. Not live data. */
export function buildSyntheticInvestXlsx(): Buffer {
  const wb = XLSX.utils.book_new();

  sheet(
    "Config",
    [
      ["Milestone 1 Financial Planner"],
      [],
      ["Monthly Surplus (₹)", 11500],
      [],
      ["Bucket", "Allocation %", "Auto Amount ₹", "Notes"],
      ["Hard Cash in Saving Account", null, 10000, "ICICI"],
      ["Emergency Fund", 0.6, 6900],
      ["Goal Fund", 0.3, 3450],
      ["Investing", 0.1, 1150],
    ],
    wb,
  );

  sheet(
    "Goal Fund",
    [
      ["Goal", "Target Allocation", "Monthly Allocation ₹"],
      ["German Exams", 0.2, 690],
      ["Germany Relocation", 0.1, 345],
      ["Macbook Air", null, null],
      ["Iphone", null, null],
    ],
    wb,
  );

  sheet(
    "Investing",
    [
      [
        "Monthly Investing Amount (₹)",
        1150,
        null,
        null,
        null,
        "Theme Engine",
        null,
        null,
        null,
        "Dip Buy Priority",
      ],
      [ "SIP %", 0.7, null, null, null, "Below ₹20,000 investment", "AI Infrastructure Only", null, null, "1 AI Infrastructure" ],
      [ "Dip Reserve %", 0.3, null, null, null, "₹20,000+ investment", "All Themes Active", null, null, "2 NASDAQ-100" ],
      [ null, null, null, null, null, null, null, null, null, "3 Nifty Next 50" ],
      [ "SIP Pool ₹", 805, null, null, null, "Theme", "Weight", "Allocation ₹", null, "4 Flexicap" ],
      [ "Dip Reserve Pool ₹", 345, null, null, null, "AI Infrastructure", 0.15, 281.75, null, "5 Gold" ],
      [ null, null, null, null, null, "Automation & Robotics", 0.09, 0 ],
      [ "Asset", "Target %", "Monthly SIP ₹", null, null, "Electricity & Grid", 0.06, 0 ],
      [ "Gold", 0.1, 80.5, "nippon gold etf", null, "Defense & Cyber", 0.05, 0 ],
      [ "NASDAQ-100", 0.25, 201.25, "motilal oswal nasdaq 100" ],
      [ "India Flexicap", 0.15, 120.75 ],
      [ "Nifty 50", 0.075, 60.375 ],
      [ "Nifty Next 50", 0.075, 60.375 ],
    ],
    wb,
  );

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
