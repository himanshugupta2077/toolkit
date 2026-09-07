/** @vitest-environment node */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { rupeesToPaise } from "../../src/engine/money.ts";
import { createApp } from "../app.ts";
import { openDatabase, type OpenedDb } from "../db/client.ts";
import { ensureCatalog } from "../db/seed.ts";
import { applyFinanceImport } from "./applyFinance.ts";
import { excelSerialToIso } from "./excelDate.ts";
import { parseFinanceWorkbook } from "./parseFinance.ts";
import { addLedgerRow, buildSyntheticFinanceXlsx } from "./syntheticWorkbook.ts";
import { MATCH_TOLERANCE_PAISE } from "./types.ts";

const opened: OpenedDb[] = [];

function harness() {
  const db = openDatabase(":memory:");
  opened.push(db);
  ensureCatalog(db.db);
  const app = createApp(db);
  return { ...db, app };
}

afterEach(() => {
  for (const db of opened.splice(0)) db.sqlite.close();
});

function hdfc(report: { balances: { name: string; enginePaise: number; match: boolean }[] }) {
  return report.balances.find((row) => row.name === "HDFC Savings");
}

describe("excel dates", () => {
  it("maps serial 46235 to 2026-08-01", () => {
    expect(excelSerialToIso(46235)).toBe("2026-08-01");
  });
});

describe("synthetic Finance-Mng import", () => {
  it("parses accounts, ledger, SmartEMI, inflows, and duplicate refunds", () => {
    const parsed = parseFinanceWorkbook(buildSyntheticFinanceXlsx());
    expect(parsed.accounts.map((a) => a.name)).toContain("HDFC Savings");
    expect(parsed.ledger).toHaveLength(7);
    expect(parsed.ledger.filter((r) => r.notes === "dup refund")).toHaveLength(2);
    expect(new Set(parsed.ledger.map((r) => r.sourceHash)).size).toBe(7);
    expect(parsed.recurring.some((r) => r.name === "MacBook SmartEMI")).toBe(true);
    expect(parsed.inflows).toHaveLength(2);
    expect(parsed.inflows[1]?.isLiquid).toBe(false);
    const blank = parsed.ledger.find((r) => r.notes === "blank budget flag");
    expect(blank?.inBudget).toBeNull();
  });

  it("inserts in one transaction and matches real accounts to ₹1", () => {
    const { db } = harness();
    const buf = buildSyntheticFinanceXlsx();
    const report = applyFinanceImport(db, parseFinanceWorkbook(buf), {
      replace: true,
      filename: "synth.xlsx",
      fileSha: "test",
    });
    expect(report.ok).toBe(true);
    expect(report.counts.ledgerInserted).toBe(7);
    expect(hdfc(report)?.enginePaise).toBe(rupeesToPaise(140190.25));
    expect(hdfc(report)?.match).toBe(true);
    expect(report.recurringCheck.includesSmartEmi).toBe(true);
    expect(report.recurringCheck.loanEmi).toBe(rupeesToPaise(38200));
    expect(report.typeGuideIssues.length).toBeGreaterThan(0);
    const eating = report.ledger.find((r) => r.notes === "blank budget flag");
    expect(eating?.categoryName).toBe("Eating outside");
  });

  it("re-import is idempotent; a new sheet row inserts once", () => {
    const { db } = harness();
    const firstBuf = buildSyntheticFinanceXlsx();
    applyFinanceImport(db, parseFinanceWorkbook(firstBuf), {
      replace: true,
      filename: "synth.xlsx",
      fileSha: "a",
    });
    const again = applyFinanceImport(db, parseFinanceWorkbook(firstBuf), {
      replace: false,
      filename: "synth.xlsx",
      fileSha: "a",
    });
    expect(again.counts.ledgerInserted).toBe(0);
    expect(again.counts.ledgerSkipped).toBe(7);
    expect(again.ok).toBe(true);

    const grown = addLedgerRow(firstBuf, "new coffee", 15);
    const third = applyFinanceImport(db, parseFinanceWorkbook(grown), {
      replace: false,
      filename: "synth.xlsx",
      fileSha: "b",
    });
    expect(third.counts.ledgerInserted).toBe(1);
    expect(third.counts.ledgerSkipped).toBe(7);
  });

  it("POST /api/import/finance accepts multipart xlsx", async () => {
    const { app } = harness();
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(buildSyntheticFinanceXlsx())], "synth.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    form.append("replace", "true");
    const res = await app.request("/api/import/finance", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      report: { ok: boolean; counts: { ledgerInserted: number } };
    };
    expect(body.ok).toBe(true);
    expect(body.report.counts.ledgerInserted).toBe(7);
  });
});

const LIVE =
  process.env.FINANCE_XLSX ?? "/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx";

describe.skipIf(!existsSync(LIVE))("live Finance-Mng-V2.xlsx", () => {
  it("imports and matches every real account to ₹1", () => {
    const { db } = harness();
    const buf = readFileSync(LIVE);
    const parsed = parseFinanceWorkbook(buf);
    expect(parsed.ledger.length).toBeGreaterThanOrEqual(150);
    const report = applyFinanceImport(db, parsed, {
      replace: true,
      filename: "Finance-Mng-V2.xlsx",
      fileSha: "live",
    });
    const real = report.balances.filter((row) => row.type !== "virtual");
    const bad = real.filter((row) => Math.abs(row.deltaPaise) > MATCH_TOLERANCE_PAISE);
    expect(bad).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.recurringCheck.includesSmartEmi).toBe(true);
    expect(report.recurringCheck.loanEmi).toBeGreaterThanOrEqual(rupeesToPaise(38200));
    const hdfcRow = hdfc(report);
    expect(hdfcRow).toBeTruthy();
    if (hdfcRow?.actualPaise != null) {
      expect(Math.abs(hdfcRow.actualPaise - hdfcRow.enginePaise)).toBeLessThanOrEqual(
        MATCH_TOLERANCE_PAISE,
      );
    }
    const again = applyFinanceImport(db, parsed, {
      replace: false,
      filename: "Finance-Mng-V2.xlsx",
      fileSha: "live",
    });
    expect(again.counts.ledgerInserted).toBe(0);
    expect(again.counts.ledgerSkipped).toBe(parsed.ledger.length);
  });
});
