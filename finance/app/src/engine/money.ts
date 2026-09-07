/** Integer paise. ₹1.00 = 100. Never a float. */
export type Paise = number;

export const ZERO_PAISE: Paise = 0;

export function isPaise(value: number): boolean {
  return Number.isSafeInteger(value);
}

/**
 * Convert rupees to paise. Half-up via `Math.round` so `1150.5` → `115050`.
 */
export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new Error("rupees must be a finite number");
  }
  const paise = Math.round(rupees * 100);
  if (!Number.isSafeInteger(paise)) {
    throw new Error("paise overflow");
  }
  return paise;
}

export function paiseToRupees(paise: Paise): number {
  if (!isPaise(paise)) {
    throw new Error("paise must be a safe integer");
  }
  return paise / 100;
}

/** Last 3 digits, then groups of 2: 140000 → `1,40,000`. */
export function groupIndianInteger(n: number): string {
  if (!Number.isInteger(n)) {
    throw new Error("groupIndianInteger expects an integer");
  }
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.abs(n));
  if (digits.length <= 3) return sign + digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const groupedHead = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}${groupedHead},${tail}`;
}

/** Indian grouping with the rupee sign, always two decimal places: `₹1,40,000.00`. */
export function formatInr(paise: Paise): string {
  if (!isPaise(paise)) {
    throw new Error("formatInr expects integer paise");
  }
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const body = `₹${groupIndianInteger(rupees)}.${String(fraction).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}
