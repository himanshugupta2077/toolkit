import { describe, expect, it } from "vitest";
import {
  formatInr,
  groupIndianInteger,
  paiseToRupees,
  rupeesToPaise,
} from "./money.ts";

describe("rupeesToPaise", () => {
  it("rounds 1150.5 rupees to 115050 paise", () => {
    expect(rupeesToPaise(1150.5)).toBe(115050);
  });

  it("rounds sheet-style opening 3851.96 to integer paise", () => {
    expect(rupeesToPaise(3851.96)).toBe(385196);
  });

  it("maps 1 rupee to 100 paise", () => {
    expect(rupeesToPaise(1)).toBe(100);
  });

  it("rejects non-finite input", () => {
    expect(() => rupeesToPaise(Number.NaN)).toThrow(/finite/);
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});

describe("formatInr", () => {
  it("displays 115050 paise as ₹1,150.50", () => {
    expect(formatInr(115050)).toBe("₹1,150.50");
  });

  it("uses Indian grouping for 1.4 lakh", () => {
    expect(formatInr(rupeesToPaise(140000))).toBe("₹1,40,000.00");
  });

  it("always shows two decimal places", () => {
    expect(formatInr(100)).toBe("₹1.00");
    expect(formatInr(5)).toBe("₹0.05");
    expect(formatInr(0)).toBe("₹0.00");
  });

  it("puts the minus sign before the rupee sign", () => {
    expect(formatInr(-115050)).toBe("-₹1,150.50");
  });
});

describe("groupIndianInteger", () => {
  it("groups last three, then by two", () => {
    expect(groupIndianInteger(0)).toBe("0");
    expect(groupIndianInteger(123)).toBe("123");
    expect(groupIndianInteger(1234)).toBe("1,234");
    expect(groupIndianInteger(12345)).toBe("12,345");
    expect(groupIndianInteger(123456)).toBe("1,23,456");
    expect(groupIndianInteger(1234567)).toBe("12,34,567");
    expect(groupIndianInteger(10000000)).toBe("1,00,00,000");
  });
});

describe("paiseToRupees", () => {
  it("inverts the Phase 2 rounding example", () => {
    expect(paiseToRupees(115050)).toBe(1150.5);
  });
});
