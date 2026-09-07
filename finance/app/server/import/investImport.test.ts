/** @vitest-environment node */
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ASSET_IDS,
  DEFAULT_BUCKET_IDS,
  GOLD_ASSET_NAME,
  rupeesToPaise,
} from "../../src/engine/index.ts";
import { createApp } from "../app.ts";
import { openDatabase, type OpenedDb } from "../db/client.ts";
import { accounts } from "../db/schema.ts";
import { ensureCatalog } from "../db/seed.ts";
import { nowIso } from "../ids.ts";
import { applyFinanceImport } from "./applyFinance.ts";
import { applyInvestImport, seedDefaultInvestSide } from "./applyInvest.ts";
import { parseFinanceWorkbook } from "./parseFinance.ts";
import { parseInvestWorkbook } from "./parseInvest.ts";
import { buildSyntheticFinanceXlsx } from "./syntheticWorkbook.ts";
import { buildSyntheticInvestXlsx } from "./syntheticInvestWorkbook.ts";

const opened: OpenedDb[] = [];
const tmpDirs: string[] = [];

function harness(file = ":memory:") {
  const db = openDatabase(file);
  opened.push(db);
  ensureCatalog(db.db);
  const app = createApp(db);
  return { ...db, app };
}

afterEach(() => {
  for (const db of opened.splice(0)) db.sqlite.close();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function addAsset(
  db: OpenedDb["db"],
  name: string,
  group: "fd" | "savings" | "investment",
  opening: number,
) {
  const at = nowIso();
  db.insert(accounts)
    .values({
      id: `acc_${name.toLowerCase().replace(/\s+/g, "_")}`,
      name,
      type: "asset",
      accountGroup: group,
      openingBalance: opening,
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: group === "savings",
      bucketId: null,
      statementDay: null,
      dueDay: null,
      isArchived: false,
      notes: "",
      virtualKind: null,
      createdAt: at,
      updatedAt: at,
    })
    .run();
}

describe("synthetic investment import", () => {
  it("parses 70/30, Gold, themes, and four goals with blank rupee targets", () => {
    const parsed = parseInvestWorkbook(buildSyntheticInvestXlsx());
    expect(parsed.sipBp).toBe(7_000);
    expect(parsed.dipReserveBp).toBe(3_000);
    expect(parsed.savingsTarget).toBe(rupeesToPaise(10_000));
    expect(parsed.assets.some((row) => row.name === GOLD_ASSET_NAME)).toBe(true);
    expect(parsed.assets.find((row) => row.name === GOLD_ASSET_NAME)?.active).toBe(false);
    expect(parsed.assets.some((row) => row.name === "AI Infrastructure")).toBe(true);
    expect(parsed.assets.some((row) => row.name === "NASDAQ-100")).toBe(true);
    expect(parsed.goals.map((row) => row.name)).toEqual([
      "German Exams",
      "Germany Relocation",
      "Macbook Air",
      "Iphone",
    ]);
    expect(parsed.goals.every((row) => row.targetAmount == null)).toBe(true);
    expect(parsed.goals[2]?.notes).toBe("");
    expect(parsed.goals[0]?.notes).toContain("20%");
  });

  it("tags FD / ICICI / Mutual Fund and shows FD on Emergency Fund", () => {
    const { db } = harness();
    addAsset(db, "FD", "fd", rupeesToPaise(20_000));
    addAsset(db, "ICICI Savings", "savings", rupeesToPaise(392.11));
    addAsset(db, "Mutual Fund", "investment", 0);
    const report = applyInvestImport(db, parseInvestWorkbook(buildSyntheticInvestXlsx()), {
      replace: true,
      filename: "synth-invest.xlsx",
    });
    expect(report.ok).toBe(true);
    const ef = report.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.emergencyFund);
    const savings = report.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.savingsBuffer);
    const invest = report.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.investment);
    expect(ef?.current).toBe(rupeesToPaise(20_000));
    expect(ef?.accounts.some((row) => row.name === "FD")).toBe(true);
    expect(savings?.current).toBe(rupeesToPaise(392.11));
    expect(invest?.current).toBe(0);
    expect(report.investPlan?.assets.find((row) => row.id === DEFAULT_ASSET_IDS.gold)?.active).toBe(
      false,
    );
    expect(report.confirmation).toContain("Savings target = ₹10,000.00");
    expect(report.confirmation).toContain("Investment = remainder");
  });

  it("default seed is 70/30 with no Gold, and PUT savings target persists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finance-p11-"));
    tmpDirs.push(dir);
    const file = join(dir, "finance.sqlite");
    const first = harness(file);
    addAsset(first.db, "FD", "fd", rupeesToPaise(20_000));
    const seeded = seedDefaultInvestSide(first.db);
    expect(seeded.investPlan?.sipBp).toBe(7_000);
    expect(seeded.investPlan?.assets.some((row) => row.name === GOLD_ASSET_NAME)).toBe(false);
    const put = await first.app.request("/api/seed/invest", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ savingsRupees: 12_000, efMonths: 6, sipPct: 70 }),
    });
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { summary: { savingsTarget: number } };
    expect(putBody.summary.savingsTarget).toBe(rupeesToPaise(12_000));
    first.sqlite.close();
    opened.splice(opened.indexOf(first), 1);

    const second = harness(file);
    const res = await second.app.request("/api/engine-summary");
    const body = (await res.json()) as { summary: { savingsTarget: number; confirmation: string } };
    expect(body.summary.savingsTarget).toBe(rupeesToPaise(12_000));
    expect(body.summary.confirmation).toContain("₹12,000.00");
  });

  it("POST /api/import/invest accepts multipart xlsx", async () => {
    const { app, db } = harness();
    addAsset(db, "FD", "fd", rupeesToPaise(20_000));
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(buildSyntheticInvestXlsx())], "synth-invest.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const res = await app.request("/api/import/invest", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      report: { goals: { name: string }[]; investPlan: { sipBp: number } | null };
    };
    expect(body.ok).toBe(true);
    expect(body.report.goals).toHaveLength(4);
    expect(body.report.investPlan?.sipBp).toBe(7_000);
  });
});

describe("finance import tags default buckets", () => {
  it("maps synthetic FD to Emergency Fund", () => {
    const { db } = harness();
    applyFinanceImport(db, parseFinanceWorkbook(buildSyntheticFinanceXlsx()), {
      replace: true,
      filename: "synth.xlsx",
      fileSha: "t",
    });
    const summary = seedDefaultInvestSide(db);
    const fd = summary.buckets
      .find((row) => row.id === DEFAULT_BUCKET_IDS.emergencyFund)
      ?.accounts.find((row) => row.name === "FD");
    expect(fd).toBeTruthy();
  });
});

const LIVE_INVEST =
  process.env.INVEST_XLSX ??
  "/home/himanshu/Documents/project-tool-scripts-whatnot/toolkit/finance/new proper web app/Investment_Portfolio_Allocation_Tracker.xlsx";
const LIVE_FINANCE =
  process.env.FINANCE_XLSX ?? "/home/himanshu/Documents/Finance/Finance-Mng-V2.xlsx";

describe.skipIf(!existsSync(LIVE_INVEST) || !existsSync(LIVE_FINANCE))(
  "live investment xlsx",
  () => {
    it("imports goals and tags FD to Emergency Fund at the imported FD balance", () => {
      const { db } = harness();
      applyFinanceImport(db, parseFinanceWorkbook(readFileSync(LIVE_FINANCE)), {
        replace: true,
        filename: "Finance-Mng-V2.xlsx",
        fileSha: "live",
      });
      const report = applyInvestImport(db, parseInvestWorkbook(readFileSync(LIVE_INVEST)), {
        replace: true,
        filename: "Investment_Portfolio_Allocation_Tracker.xlsx",
      });
      expect(report.goals).toHaveLength(4);
      expect(report.goals.filter((row) => row.targetAmount == null)).toHaveLength(4);
      expect(report.investPlan?.sipBp).toBe(7_000);
      expect(report.investPlan?.assets.find((row) => row.name === GOLD_ASSET_NAME)?.active).toBe(
        false,
      );
      const ef = report.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.emergencyFund);
      expect(ef?.current).toBe(rupeesToPaise(20_000));
      expect(ef?.accounts.some((row) => row.name === "FD")).toBe(true);
    });
  },
);
