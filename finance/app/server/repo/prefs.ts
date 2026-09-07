import { eq } from "drizzle-orm";
import {
  DEFAULT_BUCKET_IDS,
  DEFAULT_EF_MONTHS,
  isPaise,
  type Paise,
} from "../../src/engine/index.ts";
import type { AppDb } from "../db/client.ts";
import { buckets, settings } from "../db/schema.ts";
import { nowIso } from "../ids.ts";
import { hashPin, isPin, verifyPin } from "../lock.ts";
import { getMeta, setMeta } from "./store.ts";

export const META_PIN_HASH = "pin_hash";
export const META_BLUR_DEFAULT = "blur_default";
export const META_AUTO_LOCK = "auto_lock_seconds";

export const AUTO_LOCK_OPTIONS = [0, 30, 60, 120, 300] as const;
export type AutoLockSeconds = (typeof AUTO_LOCK_OPTIONS)[number];

export type MoneySettings = {
  defaultBudget: Paise;
  monthlySalary: Paise;
  salaryDay: number;
  efMonths: number;
};

export type MoneyPatch = {
  defaultBudget?: Paise;
  monthlySalary?: Paise;
  salaryDay?: number;
  efMonths?: number;
};

export type LockStatus = {
  pinSet: boolean;
  blurDefault: boolean;
  autoLockSeconds: AutoLockSeconds;
};

export function getMoneySettings(db: AppDb): MoneySettings {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) throw new Error("settings row is missing");
  return {
    defaultBudget: row.defaultBudget,
    monthlySalary: row.monthlySalary,
    salaryDay: row.salaryDay ?? 1,
    efMonths: row.efMonths,
  };
}

export function updateMoneySettings(db: AppDb, patch: MoneyPatch): MoneySettings {
  const current = getMoneySettings(db);
  const next: MoneySettings = {
    defaultBudget: patch.defaultBudget ?? current.defaultBudget,
    monthlySalary: patch.monthlySalary ?? current.monthlySalary,
    salaryDay: patch.salaryDay ?? current.salaryDay,
    efMonths: patch.efMonths ?? current.efMonths,
  };
  if (!isPaise(next.defaultBudget) || next.defaultBudget <= 0) {
    throw new Error("Default budget must be positive integer paise.");
  }
  if (!isPaise(next.monthlySalary) || next.monthlySalary < 0) {
    throw new Error("Salary must be integer paise.");
  }
  if (!Number.isInteger(next.salaryDay) || next.salaryDay < 1 || next.salaryDay > 31) {
    throw new Error("Salary day must be 1–31.");
  }
  if (!Number.isInteger(next.efMonths) || next.efMonths < 1 || next.efMonths > 24) {
    throw new Error("EF months must be 1–24.");
  }
  const at = nowIso();
  db.transaction((tx) => {
    tx.update(settings)
      .set({
        defaultBudget: next.defaultBudget,
        monthlySalary: next.monthlySalary,
        salaryDay: next.salaryDay,
        efMonths: next.efMonths,
        updatedAt: at,
      })
      .where(eq(settings.id, 1))
      .run();
    if (patch.efMonths != null) {
      tx.update(buckets)
        .set({ targetMonths: next.efMonths, updatedAt: at })
        .where(eq(buckets.id, DEFAULT_BUCKET_IDS.emergencyFund))
        .run();
    }
  });
  return getMoneySettings(db);
}

function parseAutoLock(raw: string | null): AutoLockSeconds {
  const n = Number(raw ?? "120");
  if ((AUTO_LOCK_OPTIONS as readonly number[]).includes(n)) return n as AutoLockSeconds;
  return 120;
}

export function getLockStatus(db: AppDb): LockStatus {
  return {
    pinSet: Boolean(getMeta(db, META_PIN_HASH)),
    blurDefault: getMeta(db, META_BLUR_DEFAULT) === "1",
    autoLockSeconds: parseAutoLock(getMeta(db, META_AUTO_LOCK)),
  };
}

export function setBlurDefault(db: AppDb, value: boolean): LockStatus {
  setMeta(db, META_BLUR_DEFAULT, value ? "1" : "0");
  return getLockStatus(db);
}

export function setAutoLockSeconds(db: AppDb, seconds: number): LockStatus {
  if (!(AUTO_LOCK_OPTIONS as readonly number[]).includes(seconds)) {
    throw new Error("Unknown auto-lock interval.");
  }
  setMeta(db, META_AUTO_LOCK, String(seconds));
  return getLockStatus(db);
}

export function setPin(db: AppDb, pin: string, currentPin: string | null): LockStatus {
  if (!isPin(pin)) throw new Error("PIN must be 4–6 digits.");
  const stored = getMeta(db, META_PIN_HASH);
  if (stored) {
    if (currentPin == null || !verifyPin(currentPin, stored)) {
      throw new Error("Current PIN is wrong.");
    }
  }
  setMeta(db, META_PIN_HASH, hashPin(pin));
  return getLockStatus(db);
}

export function clearPin(db: AppDb, currentPin: string): LockStatus {
  const stored = getMeta(db, META_PIN_HASH);
  if (!stored) throw new Error("No PIN is set.");
  if (!verifyPin(currentPin, stored)) throw new Error("Current PIN is wrong.");
  setMeta(db, META_PIN_HASH, "");
  return getLockStatus(db);
}

export function unlockWithPin(db: AppDb, pin: string): boolean {
  const stored = getMeta(db, META_PIN_HASH);
  if (!stored) return true;
  return verifyPin(pin, stored);
}

export function defaultEfMonths(): number {
  return DEFAULT_EF_MONTHS;
}
