/** Civil date in IST, `YYYY-MM-DD`. */
export type IsoDate = string;
/** Calendar month, `YYYY-MM`. */
export type YearMonth = string;
/** 24h clock, `HH:mm`. */
export type ClockTime = string;

export const IST_TIME_ZONE = "Asia/Kolkata";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;
const CLOCK_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoDateFromParts(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function yearMonthFromParts(year: number, month: number): YearMonth {
  return `${year}-${pad2(month)}`;
}

export function isIsoDate(value: string): value is IsoDate {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function isYearMonth(value: string): value is YearMonth {
  const match = YEAR_MONTH_RE.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function isClockTime(value: string): value is ClockTime {
  return CLOCK_TIME_RE.test(value);
}

export function yearMonthFromIsoDate(date: IsoDate): YearMonth {
  if (!isIsoDate(date)) {
    throw new Error(`invalid ISO date: ${date}`);
  }
  return date.slice(0, 7);
}

export function parseYearMonth(month: YearMonth): { year: number; month: number } {
  if (!isYearMonth(month)) {
    throw new Error(`invalid year-month: ${month}`);
  }
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

export function monthStart(month: YearMonth): IsoDate {
  const { year, month: m } = parseYearMonth(month);
  return isoDateFromParts(year, m, 1);
}

export function daysInMonth(month: YearMonth): number {
  const { year, month: m } = parseYearMonth(month);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

export function monthEnd(month: YearMonth): IsoDate {
  const { year, month: m } = parseYearMonth(month);
  return isoDateFromParts(year, m, daysInMonth(month));
}

export function addMonths(month: YearMonth, delta: number): YearMonth {
  if (!Number.isInteger(delta)) {
    throw new Error("delta must be an integer");
  }
  const parsed = parseYearMonth(month);
  const index = parsed.year * 12 + (parsed.month - 1) + delta;
  const year = Math.floor(index / 12);
  const monthIndex = ((index % 12) + 12) % 12;
  return yearMonthFromParts(year, monthIndex + 1);
}

function utcMidnight(date: IsoDate): Date {
  if (!isIsoDate(date)) {
    throw new Error(`invalid ISO date: ${date}`);
  }
  return new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
  );
}

/** Civil-date arithmetic. `addDays("2026-09-06", 30)` → `2026-10-06`. */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) {
    throw new Error("days must be an integer");
  }
  const utc = utcMidnight(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return isoDateFromParts(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = utcMidnight(from).getTime();
  const b = utcMidnight(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Calendar-month difference of the YYYY-MM parts (day-of-month ignored).
 * Sep → Mar = 6; same month = 0; `to` earlier than `from` is negative.
 */
export function monthsBetween(from: IsoDate, to: IsoDate): number {
  const start = parseYearMonth(yearMonthFromIsoDate(from));
  const end = parseYearMonth(yearMonthFromIsoDate(to));
  return (end.year - start.year) * 12 + (end.month - start.month);
}

function istParts(instant: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`missing date part: ${type}`);
    return part.value;
  };

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** Today's civil date in Asia/Kolkata, regardless of the device timezone. */
export function todayIst(now: Date = new Date()): IsoDate {
  const { year, month, day } = istParts(now);
  return isoDateFromParts(year, month, day);
}

/** Current `HH:mm` in Asia/Kolkata. */
export function nowTimeIst(now: Date = new Date()): ClockTime {
  const { hour, minute } = istParts(now);
  return `${pad2(hour)}:${pad2(minute)}`;
}
