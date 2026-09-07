import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  isClockTime,
  isIsoDate,
  isYearMonth,
  monthEnd,
  monthStart,
  monthsBetween,
  nowTimeIst,
  todayIst,
  yearMonthFromIsoDate,
} from "./dates.ts";

describe("ISO date and YYYY-MM", () => {
  it("accepts real calendar dates and months", () => {
    expect(isIsoDate("2026-09-06")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isYearMonth("2026-09")).toBe(true);
  });

  it("rejects impossible dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-9-6")).toBe(false);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth("26-09")).toBe(false);
  });

  it("derives the month key from a civil date", () => {
    expect(yearMonthFromIsoDate("2026-09-06")).toBe("2026-09");
  });

  it("computes month bounds", () => {
    expect(monthStart("2026-09")).toBe("2026-09-01");
    expect(monthEnd("2026-09")).toBe("2026-09-30");
    expect(monthEnd("2024-02")).toBe("2024-02-29");
    expect(daysInMonth("2026-02")).toBe(28);
  });

  it("adds months across year boundaries", () => {
    expect(addMonths("2026-01", 1)).toBe("2026-02");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-06", 30)).toBe("2026-10-06");
    expect(addDays("2026-09-06", 90)).toBe("2026-12-05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-09-06", 0)).toBe("2026-09-06");
    expect(addDays("2026-09-06", -1)).toBe("2026-09-05");
  });

  it("counts whole days between civil dates", () => {
    expect(daysBetween("2026-09-06", "2026-10-06")).toBe(30);
    expect(daysBetween("2026-09-06", "2026-09-06")).toBe(0);
    expect(daysBetween("2026-09-07", "2026-09-06")).toBe(-1);
  });

  it("counts calendar months, ignoring day-of-month", () => {
    expect(monthsBetween("2026-09-06", "2026-09-30")).toBe(0);
    expect(monthsBetween("2026-09-06", "2026-10-01")).toBe(1);
    expect(monthsBetween("2026-09-06", "2027-03-06")).toBe(6);
    expect(monthsBetween("2026-09-06", "2026-08-01")).toBe(-1);
  });
});

describe("clock time", () => {
  it("accepts 24-hour HH:mm", () => {
    expect(isClockTime("00:00")).toBe(true);
    expect(isClockTime("09:05")).toBe(true);
    expect(isClockTime("23:59")).toBe(true);
  });

  it("rejects invalid times", () => {
    expect(isClockTime("24:00")).toBe(false);
    expect(isClockTime("9:05")).toBe(false);
    expect(isClockTime("12:60")).toBe(false);
  });
});

describe("IST helpers", () => {
  it("uses Asia/Kolkata even when the UTC date is the previous day", () => {
    // 2026-09-05 18:30 UTC = 2026-09-06 00:00 IST
    const justAfterMidnightIst = new Date("2026-09-05T18:30:00.000Z");
    expect(todayIst(justAfterMidnightIst)).toBe("2026-09-06");
    expect(nowTimeIst(justAfterMidnightIst)).toBe("00:00");
  });

  it("stays on the previous IST day just before midnight IST", () => {
    // 2026-09-05 18:29 UTC = 2026-09-05 23:59 IST
    const justBeforeMidnightIst = new Date("2026-09-05T18:29:00.000Z");
    expect(todayIst(justBeforeMidnightIst)).toBe("2026-09-05");
    expect(nowTimeIst(justBeforeMidnightIst)).toBe("23:59");
  });
});
