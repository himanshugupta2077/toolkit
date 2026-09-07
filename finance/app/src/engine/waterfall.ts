import { type AccountPosition } from "./balances.ts";
import { type CategoryName, type MonthLedgerEntry } from "./budget.ts";
import {
  addMonths,
  isIsoDate,
  isYearMonth,
  yearMonthFromIsoDate,
  type IsoDate,
  type YearMonth,
} from "./dates.ts";
import { isPaise, rupeesToPaise, ZERO_PAISE, type Paise } from "./money.ts";
import {
  EMI_CATEGORY_NAME,
  isFillMode,
  isTargetRule,
  RENT_CATEGORY_NAME,
  type Account,
  type Bucket,
  type FillMode,
  type TargetRule,
} from "./types.ts";

/** Fields the waterfall needs. Extra Bucket fields are allowed. */
export type WaterfallBucket = Pick<
  Bucket,
  | "id"
  | "name"
  | "priority"
  | "targetRule"
  | "targetAmount"
  | "targetMonths"
  | "fillMode"
  | "fillValue"
  | "active"
>;

export const DEFAULT_BUCKET_IDS = {
  emergencyFund: "emergency_fund",
  savingsBuffer: "savings_buffer",
  investment: "investment",
} as const;

/** Locked v1 default: 6 × trailing essentials. */
export const DEFAULT_EF_MONTHS = 6;
/** Trailing completed months used for the essentials average. */
export const ESSENTIALS_TRAILING_MONTHS = 3;
/** Locked v1 default: ₹10,000 hard cash. */
export const DEFAULT_SAVINGS_BUFFER_TARGET: Paise = rupeesToPaise(10_000);

export type BucketIssue = {
  field: string;
  code: string;
  message: string;
};

export type BucketValidationResult = {
  ok: boolean;
  issues: BucketIssue[];
};

export type EssentialsMonth = {
  month: YearMonth;
  amount: Paise;
};

export type TrailingEssentials = {
  average: Paise;
  monthsUsed: number;
  lookback: number;
  months: readonly EssentialsMonth[];
};

export type WaterfallLine = {
  bucketId: string;
  name: string;
  priority: number;
  fillMode: FillMode;
  current: Paise;
  /** Null when the bucket has no target (`none`). */
  target: Paise | null;
  /** Null when room is unbounded. */
  room: Paise | null;
  want: Paise;
  amount: Paise;
};

export type WaterfallResult = {
  surplus: Paise;
  leftover: Paise;
  totalAllocated: Paise;
  lines: readonly WaterfallLine[];
};

/** Per-bucket amount overrides. Missing keys keep the plan want. */
export type WaterfallOverrides = Readonly<Record<string, Paise>>;

function requirePaise(value: Paise, label: string): Paise {
  if (!isPaise(value)) {
    throw new Error(`${label} must be integer paise`);
  }
  return value;
}

function requireIsoDate(date: IsoDate, label: string): IsoDate {
  if (!isIsoDate(date)) {
    throw new Error(`invalid ${label} date: ${date}`);
  }
  return date;
}

function requireYearMonth(month: YearMonth): YearMonth {
  if (!isYearMonth(month)) {
    throw new Error(`invalid year-month: ${month}`);
  }
  return month;
}

function nameMatches(name: string, expected: string): boolean {
  return name.trim().toLowerCase() === expected.toLowerCase();
}

function isRentOrEmiName(name: string): boolean {
  return (
    nameMatches(name, RENT_CATEGORY_NAME) || nameMatches(name, EMI_CATEGORY_NAME)
  );
}

function inMonth(date: string, month: YearMonth): boolean {
  return isIsoDate(date) && yearMonthFromIsoDate(date) === month;
}

function issue(
  field: string,
  code: string,
  message: string,
): BucketIssue {
  return { field, code, message };
}

/**
 * Default three-bucket plan: Emergency Fund until 6× essentials, Savings
 * buffer until ₹10,000, Investment remainder.
 */
export function seedDefaultBuckets(): Bucket[] {
  return [
    {
      id: DEFAULT_BUCKET_IDS.emergencyFund,
      name: "Emergency Fund",
      priority: 1,
      targetRule: "months_of_essentials",
      targetAmount: null,
      targetMonths: DEFAULT_EF_MONTHS,
      fillMode: "until_target",
      fillValue: null,
      minMonthly: null,
      active: true,
      notes: "",
      colour: "",
    },
    {
      id: DEFAULT_BUCKET_IDS.savingsBuffer,
      name: "Savings buffer",
      priority: 2,
      targetRule: "fixed",
      targetAmount: DEFAULT_SAVINGS_BUFFER_TARGET,
      targetMonths: null,
      fillMode: "until_target",
      fillValue: null,
      minMonthly: null,
      active: true,
      notes: "",
      colour: "",
    },
    {
      id: DEFAULT_BUCKET_IDS.investment,
      name: "Investment",
      priority: 3,
      targetRule: "none",
      targetAmount: null,
      targetMonths: null,
      fillMode: "remainder",
      fillValue: null,
      minMonthly: null,
      active: true,
      notes: "",
      colour: "",
    },
  ];
}

/**
 * Guardrails: exactly one remainder bucket (and it is active);
 * active percent fills sum to ≤ 100.
 */
export function validateBuckets(
  buckets: readonly WaterfallBucket[],
): BucketValidationResult {
  const issues: BucketIssue[] = [];
  const seen = new Set<string>();
  let percentSum = 0;
  const remainders: WaterfallBucket[] = [];

  for (const bucket of buckets) {
    const prefix = bucket.id || bucket.name || "bucket";

    if (!bucket.id.trim()) {
      issues.push(issue("id", "empty_id", "Bucket id is required."));
    } else if (seen.has(bucket.id)) {
      issues.push(
        issue("id", "duplicate_id", `Duplicate bucket id: ${bucket.id}.`),
      );
    } else {
      seen.add(bucket.id);
    }

    if (!Number.isInteger(bucket.priority) || bucket.priority < 1) {
      issues.push(
        issue(
          "priority",
          "invalid_priority",
          `${prefix}: priority must be an integer ≥ 1.`,
        ),
      );
    }

    const targetRule: string = bucket.targetRule;
    if (!isTargetRule(targetRule)) {
      issues.push(
        issue(
          "targetRule",
          "invalid_target_rule",
          `${prefix}: unknown target rule.`,
        ),
      );
    } else {
      issues.push(...targetRuleIssues(bucket, prefix, targetRule));
    }

    const fillMode: string = bucket.fillMode;
    if (!isFillMode(fillMode)) {
      issues.push(
        issue(
          "fillMode",
          "invalid_fill_mode",
          `${prefix}: unknown fill mode.`,
        ),
      );
    } else {
      issues.push(...fillModeIssues(bucket, prefix, fillMode));
      if (fillMode === "remainder") remainders.push(bucket);
      if (fillMode === "percent" && bucket.active) {
        const value = bucket.fillValue;
        if (value != null && Number.isInteger(value)) percentSum += value;
      }
    }
  }

  const activeRemainders = remainders.filter((bucket) => bucket.active);
  if (remainders.length !== 1 || activeRemainders.length !== 1) {
    issues.push(
      issue(
        "fillMode",
        "remainder_count",
        "Exactly one bucket must use remainder fill, and it must be active.",
      ),
    );
  }

  if (percentSum > 100) {
    issues.push(
      issue(
        "fillValue",
        "percent_sum",
        `Active percent fills sum to ${percentSum}; they must be ≤ 100.`,
      ),
    );
  }

  return { ok: issues.length === 0, issues };
}

function targetRuleIssues(
  bucket: WaterfallBucket,
  prefix: string,
  targetRule: TargetRule,
): BucketIssue[] {
  switch (targetRule) {
    case "fixed":
      if (bucket.targetAmount == null || !isPaise(bucket.targetAmount) || bucket.targetAmount < 0) {
        return [
          issue(
            "targetAmount",
            "fixed_target_needs_amount",
            `${prefix}: fixed target needs a non-negative paise amount.`,
          ),
        ];
      }
      return [];
    case "months_of_essentials":
      if (
        bucket.targetMonths == null ||
        !Number.isInteger(bucket.targetMonths) ||
        bucket.targetMonths < 1
      ) {
        return [
          issue(
            "targetMonths",
            "essentials_needs_months",
            `${prefix}: months-of-essentials needs an integer ≥ 1.`,
          ),
        ];
      }
      return [];
    case "none":
      return [];
  }
}

function fillModeIssues(
  bucket: WaterfallBucket,
  prefix: string,
  fillMode: FillMode,
): BucketIssue[] {
  switch (fillMode) {
    case "until_target":
      if (bucket.targetRule === "none") {
        return [
          issue(
            "targetRule",
            "until_target_needs_target",
            `${prefix}: until-target fill needs a target (fixed or months of essentials).`,
          ),
        ];
      }
      return [];
    case "percent": {
      const value = bucket.fillValue;
      if (value == null || !Number.isInteger(value) || value < 0 || value > 100) {
        return [
          issue(
            "fillValue",
            "percent_needs_value",
            `${prefix}: percent fill needs an integer 0–100.`,
          ),
        ];
      }
      return [];
    }
    case "fixed": {
      const value = bucket.fillValue;
      if (value == null || !isPaise(value) || value < 0) {
        return [
          issue(
            "fillValue",
            "fixed_fill_needs_value",
            `${prefix}: fixed fill needs a non-negative paise amount.`,
          ),
        ];
      }
      return [];
    }
    case "remainder":
      return [];
  }
}

/** Null target means unbounded room. */
export function resolveBucketTarget(
  bucket: Pick<WaterfallBucket, "targetRule" | "targetAmount" | "targetMonths">,
  essentialsMonthlyAverage: Paise,
): Paise | null {
  requirePaise(essentialsMonthlyAverage, "essentials average");
  switch (bucket.targetRule) {
    case "none":
      return null;
    case "fixed":
      if (bucket.targetAmount == null) return null;
      return requirePaise(bucket.targetAmount, "target amount");
    case "months_of_essentials": {
      const months = bucket.targetMonths;
      if (months == null || !Number.isInteger(months) || months < 1) return null;
      return months * essentialsMonthlyAverage;
    }
  }
}

/** `current / target`. Null when there is no positive target. */
export function bucketFillPct(current: Paise, target: Paise | null): number | null {
  requirePaise(current, "current");
  if (target == null) return null;
  requirePaise(target, "target");
  if (target <= 0) return null;
  return current / target;
}

/** How many months of essentials the current balance covers. */
export function bucketMonthsFilled(
  current: Paise,
  essentialsMonthlyAverage: Paise,
): number | null {
  requirePaise(current, "current");
  requirePaise(essentialsMonthlyAverage, "essentials average");
  if (essentialsMonthlyAverage <= 0) return null;
  return current / essentialsMonthlyAverage;
}

/**
 * In-budget spend in essentials categories, plus rent and EMIs.
 * Rent / EMIs are not counted twice if those categories are also essential.
 */
export function monthEssentials(
  month: YearMonth,
  entries: readonly MonthLedgerEntry[],
  categories: readonly CategoryName[],
  essentialsCategoryIds: readonly string[],
): Paise {
  const ym = requireYearMonth(month);
  const names = new Map<string, string>();
  for (const category of categories) names.set(category.id, category.name);
  const essentialIds = new Set(essentialsCategoryIds);

  let inBudgetEssentials: Paise = ZERO_PAISE;
  let rent: Paise = ZERO_PAISE;
  let emis: Paise = ZERO_PAISE;

  for (const entry of entries) {
    if (!inMonth(entry.date, ym)) continue;
    requirePaise(entry.amount, "entry amount");
    const categoryName = names.get(entry.categoryId) ?? "";

    if (essentialIds.has(entry.categoryId) && !isRentOrEmiName(categoryName)) {
      if (entry.type === "expense" && entry.inBudget) inBudgetEssentials += entry.amount;
      if (entry.type === "refund" && entry.inBudget) inBudgetEssentials -= entry.amount;
    }

    if (nameMatches(categoryName, RENT_CATEGORY_NAME)) rent += entry.amount;
    if (nameMatches(categoryName, EMI_CATEGORY_NAME)) emis += entry.amount;
  }

  return inBudgetEssentials + rent + emis;
}

/**
 * Average essentials over up to `lookback` completed months that exist in the
 * ledger history. Until 3 months exist, uses the months we have.
 */
export function trailingEssentialsAverage(
  asOf: IsoDate,
  entries: readonly MonthLedgerEntry[],
  categories: readonly CategoryName[],
  essentialsCategoryIds: readonly string[],
  lookback: number = ESSENTIALS_TRAILING_MONTHS,
): TrailingEssentials {
  const today = requireIsoDate(asOf, "as-of");
  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new Error("essentials lookback must be a positive integer");
  }

  const earliest = earliestEntryMonth(entries);
  const months: EssentialsMonth[] = [];
  if (earliest != null) {
    let cursor = addMonths(yearMonthFromIsoDate(today), -1);
    while (months.length < lookback && cursor >= earliest) {
      months.push({
        month: cursor,
        amount: monthEssentials(cursor, entries, categories, essentialsCategoryIds),
      });
      cursor = addMonths(cursor, -1);
    }
    months.reverse();
  }

  const monthsUsed = months.length;
  const sum = months.reduce((total, row) => total + row.amount, ZERO_PAISE);
  const average: Paise =
    monthsUsed === 0 ? ZERO_PAISE : Math.round(sum / monthsUsed);

  return { average, monthsUsed, lookback, months };
}

function earliestEntryMonth(entries: readonly MonthLedgerEntry[]): YearMonth | null {
  let earliest: YearMonth | null = null;
  for (const entry of entries) {
    if (!isIsoDate(entry.date)) continue;
    const month = yearMonthFromIsoDate(entry.date);
    if (earliest == null || month < earliest) earliest = month;
  }
  return earliest;
}

/** Σ balances of accounts tagged to each bucket. Untagged accounts are omitted. */
export function bucketCurrentBalances(
  accounts: readonly Pick<Account, "id" | "bucketId">[],
  positions: readonly Pick<AccountPosition, "accountId" | "balance">[],
): Record<string, Paise> {
  const byAccount = new Map<string, Paise>();
  for (const position of positions) {
    requirePaise(position.balance, `balance for ${position.accountId}`);
    byAccount.set(position.accountId, position.balance);
  }

  const totals: Record<string, Paise> = {};
  for (const account of accounts) {
    if (account.bucketId == null) continue;
    const balance = byAccount.get(account.id) ?? ZERO_PAISE;
    totals[account.bucketId] = (totals[account.bucketId] ?? ZERO_PAISE) + balance;
  }
  return totals;
}

/**
 * Split surplus down the active buckets in priority order.
 * `give = min(want, room, remaining)`. Percent is of the original surplus.
 * Surplus ≤ 0 → every line is 0, leftover is the (possibly negative) surplus.
 */
export function runWaterfall(
  surplus: Paise,
  buckets: readonly WaterfallBucket[],
  currentBalances: Readonly<Record<string, Paise>>,
  essentialsMonthlyAverage?: Paise,
  overrides?: WaterfallOverrides,
): WaterfallResult {
  const original = requirePaise(surplus, "surplus");
  const checked = validateBuckets(buckets);
  if (!checked.ok) {
    throw new Error(
      `invalid buckets: ${checked.issues.map((row) => row.code).join(", ")}`,
    );
  }

  for (const [bucketId, balance] of Object.entries(currentBalances)) {
    requirePaise(balance, `balance for ${bucketId}`);
  }

  const needsEssentials = buckets.some(
    (bucket) => bucket.active && bucket.targetRule === "months_of_essentials",
  );
  let essentialsAverage: Paise = ZERO_PAISE;
  if (needsEssentials) {
    if (essentialsMonthlyAverage === undefined) {
      throw new Error(
        "essentialsMonthlyAverage is required for months_of_essentials targets",
      );
    }
    essentialsAverage = requirePaise(
      essentialsMonthlyAverage,
      "essentials average",
    );
  } else if (essentialsMonthlyAverage !== undefined) {
    essentialsAverage = requirePaise(
      essentialsMonthlyAverage,
      "essentials average",
    );
  }

  const active = buckets
    .filter((bucket) => bucket.active)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const zeroRun = original <= 0;
  let remaining: Paise = zeroRun ? ZERO_PAISE : original;
  const lines: WaterfallLine[] = [];

  for (const bucket of active) {
    const current = currentBalances[bucket.id] ?? ZERO_PAISE;
    const target = resolveBucketTarget(bucket, essentialsAverage);
    const room: Paise | null = target == null ? null : Math.max(0, target - current);
    const override = overrides?.[bucket.id];
    if (override !== undefined) requirePaise(override, `override for ${bucket.id}`);
    const want = zeroRun
      ? ZERO_PAISE
      : override !== undefined
        ? override
        : bucketWant(bucket, original, remaining, room);
    const amount = zeroRun ? ZERO_PAISE : capGive(want, room, remaining);
    remaining -= amount;
    lines.push({
      bucketId: bucket.id,
      name: bucket.name,
      priority: bucket.priority,
      fillMode: bucket.fillMode,
      current,
      target,
      room,
      want,
      amount,
    });
  }

  const leftover: Paise = zeroRun ? original : remaining;
  const totalAllocated: Paise = zeroRun ? ZERO_PAISE : original - leftover;

  return { surplus: original, leftover, totalAllocated, lines };
}

function bucketWant(
  bucket: WaterfallBucket,
  originalSurplus: Paise,
  remaining: Paise,
  room: Paise | null,
): Paise {
  switch (bucket.fillMode) {
    case "until_target":
      return room ?? ZERO_PAISE;
    case "percent":
      return Math.round((originalSurplus * (bucket.fillValue ?? 0)) / 100);
    case "fixed":
      return bucket.fillValue ?? ZERO_PAISE;
    case "remainder":
      return remaining;
  }
}

function capGive(want: Paise, room: Paise | null, remaining: Paise): Paise {
  let give = want;
  if (room != null && give > room) give = room;
  if (give > remaining) give = remaining;
  if (give < 0) give = ZERO_PAISE;
  return give;
}
