import {
  isClockTime,
  isIsoDate,
  isoDateFromParts,
  todayIst,
  type ClockTime,
  type IsoDate,
} from "../../src/engine/dates.ts";

/** Excel serial 25569 is 1970-01-01 (includes the 1900 leap-year bug). */
const EXCEL_UNIX_EPOCH = 25569;
const MS_PER_DAY = 86_400_000;

const DMY_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function excelSerialToIso(serial: number): IsoDate | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const whole = Math.floor(serial + 1e-9);
  const utcDays = whole - EXCEL_UNIX_EPOCH;
  const date = new Date(utcDays * MS_PER_DAY);
  if (Number.isNaN(date.getTime())) return null;
  const iso = isoDateFromParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
  return isIsoDate(iso) ? iso : null;
}

export function excelFractionToTime(serial: number): ClockTime | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial + 1e-9);
  const frac = serial - whole;
  if (frac < 1e-9) return null;
  const totalMinutes = Math.round(frac * 24 * 60);
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return isClockTime(time) ? time : null;
}

export function cellToIsoDate(value: unknown): IsoDate | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return todayIst(value);
  }
  if (typeof value === "number") {
    if (value > 20000 && value < 80000) return excelSerialToIso(value);
    return null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = ISO_RE.exec(trimmed);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isIsoDate(date) ? date : null;
  }
  const dmy = DMY_RE.exec(trimmed);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    const date = isoDateFromParts(year, month, day);
    return isIsoDate(date) ? date : null;
  }
  return null;
}

export function cellToTime(value: unknown, dateSerial?: number): ClockTime | null {
  if (typeof value === "number") {
    if (value >= 0 && value < 1) return excelFractionToTime(value);
    if (value > 1) return excelFractionToTime(value);
  }
  if (typeof dateSerial === "number") return excelFractionToTime(dateSerial);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hh = value.getUTCHours();
    const mm = value.getUTCMinutes();
    if (hh === 0 && mm === 0) return null;
    const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    return isClockTime(time) ? time : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isClockTime(trimmed)) return trimmed;
    const hm = /^(\d{1,2}):(\d{2})/.exec(trimmed);
    if (hm) {
      const time = `${String(Number(hm[1])).padStart(2, "0")}:${hm[2]}`;
      return isClockTime(time) ? time : null;
    }
  }
  return null;
}
