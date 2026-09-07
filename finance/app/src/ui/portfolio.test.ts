import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../engine/money.ts";
import {
  driftCaption,
  formatDriftPp,
  gainCaption,
  parseNavRupees,
  pieConic,
  pieSlices,
  sparklinePoints,
} from "./portfolio.ts";

describe("portfolio copy", () => {
  it("formats drift with a rebalance hint over 5pp", () => {
    expect(formatDriftPp(30)).toBe("+30 pp");
    expect(formatDriftPp(-5.2)).toBe("−5.2 pp");
    expect(
      driftCaption({
        assetId: "a",
        name: "NASDAQ-100",
        targetBp: 5_000,
        actualBp: 8_000,
        driftPp: 30,
        hint: true,
      }),
    ).toContain("rebalance");
  });

  it("formats gain with percent", () => {
    expect(gainCaption(rupeesToPaise(500), 0.1)).toBe("+₹500.00 (+10%)");
    expect(gainCaption(rupeesToPaise(-200), -0.04)).toBe("-₹200.00 (−4%)");
  });

  it("parses NAV rupees to paise", () => {
    expect(parseNavRupees("150.25")).toBe(15025);
    expect(parseNavRupees("0")).toBeNull();
    expect(parseNavRupees("")).toBeNull();
  });

  it("groups pie slices by asset, kind, and account", () => {
    const data = {
      holdings: [
        {
          id: "h1",
          assetId: "nasdaq",
          assetName: "NASDAQ-100",
          accountId: "mf",
          accountName: "Mutual Fund",
          accountGroup: "investment",
          lastNav: null,
          lastNavDate: null,
          units: 1,
          avgCost: 0,
          cost: 0,
          value: 700,
          gain: 0,
          gainPct: null,
          updatedAt: "",
        },
        {
          id: "h2",
          assetId: "ai",
          assetName: "AI Infra",
          accountId: "mf",
          accountName: "Mutual Fund",
          accountGroup: "investment",
          lastNav: null,
          lastNavDate: null,
          units: 1,
          avgCost: 0,
          cost: 0,
          value: 300,
          gain: 0,
          gainPct: null,
          updatedAt: "",
        },
      ],
      fds: [
        {
          accountId: "fd",
          name: "FD",
          balance: 200,
          maturityDate: null,
          daysCaption: null,
        },
      ],
      assets: [
        { id: "nasdaq", name: "NASDAQ-100", kind: "core" },
        { id: "ai", name: "AI Infra", kind: "theme" },
      ],
    };
    const byAsset = pieSlices(data, "asset");
    expect(byAsset.map((row) => row.label)).toEqual(["NASDAQ-100", "AI Infra", "FD"]);
    const byKind = pieSlices(data, "kind");
    expect(byKind.find((row) => row.label === "Core")?.value).toBe(700);
    expect(byKind.find((row) => row.label === "Theme")?.value).toBe(300);
    expect(byKind.find((row) => row.label === "FD")?.value).toBe(200);
    const byAccount = pieSlices(data, "account");
    expect(byAccount.find((row) => row.label === "Mutual Fund")?.value).toBe(1000);
    expect(pieConic(byAsset)).toContain("conic-gradient");
  });

  it("maps history to sparkline 0–1 coordinates", () => {
    const pts = sparklinePoints([
      { date: "2026-09-01", netWorth: 100 },
      { date: "2026-09-02", netWorth: 200 },
    ]);
    expect(pts[0]).toEqual({ x: 0, y: 1 });
    expect(pts[1]).toEqual({ x: 1, y: 0 });
  });
});
