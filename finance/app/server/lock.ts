import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 32;
const N = 16384;
const R = 8;
const P = 1;
const PREFIX = "scrypt";

export const PIN_PATTERN = /^\d{4,6}$/;

export function isPin(value: string): boolean {
  return PIN_PATTERN.test(value);
}

export function hashPin(pin: string): string {
  if (!isPin(pin)) throw new Error("PIN must be 4–6 digits.");
  const salt = randomBytes(16);
  const key = scryptSync(pin, salt, KEYLEN, { N, r: R, p: P });
  return `${PREFIX}$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  if (!isPin(pin)) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4];
  const keyHex = parts[5];
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (!saltHex || !keyHex) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;
  const actual = scryptSync(pin, salt, expected.length, { N: n, r, p });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
