import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import { todayIst } from "./engine/dates.ts";
import { rupeesToPaise } from "./engine/money.ts";
import {
  DEFAULT_ASSET_IDS,
  DEFAULT_BUCKET_IDS,
  GOLD_ASSET_NAME,
  runWaterfall,
  seedDefaultBuckets,
  seedDefaultInvestPlan,
  splitInvest,
  type InvestPlan,
} from "./engine/index.ts";
import type { GoalCard } from "./engine/goals.ts";
import type {
  Account,
  Books,
  Category,
  ExpectedInflow,
  GoalContribution,
  LedgerEntry,
  LedgerType,
  OneTimePlan,
  RecurringPlan,
} from "./engine/types.ts";
import type {
  AccountBalanceRow,
  AllocationResponse,
  CategoryListItem,
  GoalsResponse,
  InvestResponse,
  PlanResponse,
  WealthResponse,
} from "./api/store.ts";

const OPENING = "2026-08-01";

function asset(id: string, name: string, group: Account["group"]): Account {
  return {
    id,
    name,
    type: "asset",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: true,
    includeLiquid: group === "savings" || group === "cash",
    group,
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: null,
  };
}

function cc(id: string, name: string): Account {
  return {
    id,
    name,
    type: "liability",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: rupeesToPaise(100000),
    includeNetWorth: true,
    includeLiquid: false,
    group: "credit_card",
    bucketId: null,
    statementDay: 17,
    dueDay: 7,
    isArchived: false,
    notes: "",
    virtualKind: null,
  };
}

function virtual(
  id: string,
  name: string,
  virtualKind: NonNullable<Account["virtualKind"]>,
): Account {
  return {
    id,
    name,
    type: "virtual",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: false,
    includeLiquid: false,
    group: "virtual",
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind,
  };
}

function category(
  id: string,
  name: string,
  group: string,
  defaultInBudget: boolean,
  sort: number,
): Category {
  return { id, name, group, defaultInBudget, icon: null, isArchived: false, sort };
}

const ACCOUNTS = {
  hdfc: asset("acc_hdfc", "HDFC Savings", "savings"),
  icici: asset("acc_icici", "ICICI Savings", "savings"),
  fd: asset("acc_fd", "FD", "fd"),
  hdfcCc: cc("acc_hdfc_cc", "HDFC Credit Card"),
  employer: virtual("acc_employer", "Employer", "employer"),
  external: virtual("acc_external", "External", "external"),
  expense: virtual("acc_expense", "Expense", "expense"),
} as const;

const CATEGORIES = {
  eating: category("cat_eating", "Eating outside", "Food", true, 1),
  groceries: category("cat_groceries", "Groceries", "Food", true, 2),
  salary: category("cat_salary", "Salary", "Income", false, 3),
  recon: category("cat_recon", "Reconciliation", "Finance", false, 4),
  care: category("cat_care", "Personal care", "Lifestyle", true, 5),
} as const;

function mockBooks(accounts: Account[] = Object.values(ACCOUNTS)): Books {
  return {
    today: "2026-09-06",
    accounts,
    categories: Object.values(CATEGORIES),
    entries: [],
    monthBudgets: [{ month: "2026-09", cap: rupeesToPaise(31_000), note: "" }],
    settings: {
      defaultBudget: rupeesToPaise(31_000),
      monthlySalary: rupeesToPaise(1_40_000),
      salaryDay: 1,
    },
    recurringPlans: [],
    oneTimePlans: [],
    inflows: [],
    buckets: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MONTH_PAYLOAD = {
  month: "2026-09",
  today: "2026-09-06",
  pace: {
    month: "2026-09",
    today: "2026-09-06",
    cap: rupeesToPaise(31_000),
    spent: 0,
    remaining: rupeesToPaise(31_000),
    daysInMonth: 30,
    dayOfMonth: 6,
    daysLeft: 25,
    safePerDay: 121500,
    usedPct: 0,
    elapsedPct: 0.2,
    band: "on_track" as const,
  },
  summary: {
    month: "2026-09",
    income: 0,
    budgetSpent: 0,
    nonBudgetExp: 0,
    investments: 0,
    emis: 0,
    rent: 0,
    ccPayments: 0,
    estSavings: 0,
  },
};

function personalCareEntry(overrides?: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: "led_pc",
    date: todayIst(),
    time: "15:59",
    type: "expense",
    amount: rupeesToPaise(50),
    fromAccountId: ACCOUNTS.hdfcCc.id,
    toAccountId: ACCOUNTS.expense.id,
    categoryId: CATEGORIES.care.id,
    inBudget: true,
    notes: "",
    source: "manual",
    goalId: null,
    holdingTxnId: null,
    createdAt: "2026-09-06T15:59:00+05:30",
    updatedAt: "2026-09-06T15:59:00+05:30",
    ...overrides,
  };
}

function asBalanceRow(account: Account, extra?: Partial<AccountBalanceRow>): AccountBalanceRow {
  return {
    ...account,
    balance: extra?.balance ?? 0,
    available: extra?.available ?? (account.group === "credit_card" ? account.creditLimit : null),
    utilisation: extra?.utilisation ?? (account.group === "credit_card" ? 0 : null),
    lastReconciledAt: extra?.lastReconciledAt ?? null,
    daysSinceReconcile: extra?.daysSinceReconcile ?? null,
    ...extra,
  };
}

const SMART_EMI: RecurringPlan = {
  id: "rec_smart",
  name: "MacBook SmartEMI",
  categoryId: CATEGORIES.care.id,
  frequency: "monthly",
  intervalMonths: null,
  amount: rupeesToPaise(38_200),
  startDate: "2026-03-01",
  endDate: "2027-02-28",
  active: true,
  kind: "loan_emi",
  payFromAccountId: ACCOUNTS.hdfc.id,
  notes: "",
  autoPost: false,
  lastPostedMonth: null,
};

const SCOOTY: RecurringPlan = {
  id: "rec_scooty",
  name: "Scooty insurance",
  categoryId: CATEGORIES.care.id,
  frequency: "yearly",
  intervalMonths: null,
  amount: rupeesToPaise(1_800),
  startDate: "2026-12-01",
  endDate: null,
  active: true,
  kind: "lifestyle",
  payFromAccountId: null,
  notes: "",
  autoPost: false,
  lastPostedMonth: null,
};

const FLIGHTS: OneTimePlan = {
  id: "ot_flights",
  name: "Flights",
  categoryId: CATEGORIES.care.id,
  expectedDate: "2026-09-20",
  amount: rupeesToPaise(7_500),
  priority: "high",
  status: "planned",
  payFromAccountId: ACCOUNTS.hdfc.id,
  notes: "",
  linkedLedgerEntryId: null,
};

const BONUS: ExpectedInflow = {
  id: "in_bonus",
  name: "Bonus",
  categoryId: CATEGORIES.salary.id,
  expectedDate: "2026-09-30",
  amount: rupeesToPaise(10_000),
  isLiquid: true,
  status: "expected",
  notes: "",
  linkedLedgerEntryId: null,
};

function planPayload(overrides?: Partial<PlanResponse>): PlanResponse {
  const months = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"] as const;
  return {
    ok: true,
    today: MONTH_PAYLOAD.today,
    month: MONTH_PAYLOAD.month,
    assumeInflows: false,
    defaultBudget: rupeesToPaise(31_000),
    monthlySalary: rupeesToPaise(1_40_000),
    pace: { ...MONTH_PAYLOAD.pace, band: "on_track" as const },
    summary: MONTH_PAYLOAD.summary,
    paceByCategory: [],
    budgetMonths: months.map((month) => ({
      month,
      cap: rupeesToPaise(31_000),
      income: 0,
      budgetSpent: 0,
      estSavings: 0,
      band: "on_track" as const,
    })),
    recurring: [SMART_EMI, SCOOTY],
    recurringHeader: {
      monthlyFixed: rupeesToPaise(38_200),
      activeCount: 2,
      yearlyCommitments: rupeesToPaise(1_800),
    },
    oneTime: [FLIGHTS],
    oneTimeHeader: {
      next30: rupeesToPaise(7_500),
      next90: rupeesToPaise(7_500),
      totalPlanned: rupeesToPaise(7_500),
    },
    inflows: [BONUS],
    inflowsHeader: { expectedNotCounted: rupeesToPaise(10_000) },
    forecast: {
      today: MONTH_PAYLOAD.today,
      startMonth: "2026-09",
      assumeInflows: false,
      months: months.map((month) => ({
        month,
        loanEmi: month <= "2027-02" ? rupeesToPaise(38_200) : 0,
        lifestyle: month === "2026-12" ? rupeesToPaise(1_800) : 0,
        investment: 0,
        total: rupeesToPaise(38_200) + (month === "2026-12" ? rupeesToPaise(1_800) : 0),
        lines:
          month === "2026-12"
            ? [
                {
                  planId: SMART_EMI.id,
                  name: SMART_EMI.name,
                  kind: "loan_emi" as const,
                  amount: rupeesToPaise(38_200),
                },
                {
                  planId: SCOOTY.id,
                  name: SCOOTY.name,
                  kind: "lifestyle" as const,
                  amount: rupeesToPaise(1_800),
                },
              ]
            : [
                {
                  planId: SMART_EMI.id,
                  name: SMART_EMI.name,
                  kind: "loan_emi" as const,
                  amount: rupeesToPaise(38_200),
                },
              ],
        oneTime: 0,
        inflows: 0,
        flow: {
          salary: 0,
          cap: 0,
          loanEmi: rupeesToPaise(38_200),
          investment: 0,
          oneTime: 0,
          inflows: 0,
        },
        projectedLiquid: 0,
      })),
      totals: {
        loanEmi: rupeesToPaise(38_200 * 6),
        lifestyle: rupeesToPaise(1_800),
        investment: 0,
        total: rupeesToPaise(38_200 * 6 + 1_800),
      },
    },
    free: HOME_FREE as PlanResponse["free"],
    accounts: Object.values(ACCOUNTS),
    categories: Object.values(CATEGORIES),
    ...overrides,
  };
}

const HOME_FREE = {
  month: "2026-09",
  today: "2026-09-06",
  liquid: 0,
  budgetRemaining: rupeesToPaise(31_000),
  budgetReserved: rupeesToPaise(31_000),
  ccDue: 0,
  remainingEmi: 0,
  oneTime30d: 0,
  committed: 0,
  free: rupeesToPaise(-31_000),
  expectedInflowsIfReceived: 0,
  breakdown: [
    { key: "liquid", label: "Liquid savings", sign: 1 as const, amount: 0 },
    {
      key: "budget_reserved",
      label: "Budget still reserved",
      sign: -1 as const,
      amount: rupeesToPaise(31_000),
    },
    { key: "cc_due", label: "CC due", sign: -1 as const, amount: 0 },
    {
      key: "remaining_emi",
      label: "EMI remaining this month",
      sign: -1 as const,
      amount: 0,
    },
    {
      key: "one_time_30d",
      label: "One-time next 30 d",
      sign: -1 as const,
      amount: 0,
    },
  ],
};

function defaultWealth(): WealthResponse {
  const [efSeed, savingsSeed, investSeed] = seedDefaultBuckets();
  const surplus = rupeesToPaise(20_000);
  const efCurrent = rupeesToPaise(20_000);
  const efTarget = rupeesToPaise(20_000);
  const savingsTarget = rupeesToPaise(10_000);
  const ef = {
    ...efSeed,
    targetRule: "fixed" as const,
    targetAmount: efTarget,
    targetMonths: null,
    current: efCurrent,
    target: efTarget,
    room: 0,
    fillPct: 1,
    monthsFilled: null,
    accounts: [{ id: ACCOUNTS.fd.id, name: "FD", balance: efCurrent }],
    accountIds: [ACCOUNTS.fd.id],
  };
  const savings = {
    ...savingsSeed,
    current: 0,
    target: savingsTarget,
    room: savingsTarget,
    fillPct: 0,
    monthsFilled: null,
    accounts: [] as { id: string; name: string; balance: number }[],
    accountIds: [] as string[],
  };
  const investment = {
    ...investSeed,
    current: 0,
    target: null,
    room: null,
    fillPct: null,
    monthsFilled: null,
    accounts: [] as { id: string; name: string; balance: number }[],
    accountIds: [] as string[],
  };
  const buckets = [ef, savings, investment];
  const example = runWaterfall(surplus, buckets, {
    [ef.id]: efCurrent,
    [savings.id]: 0,
    [investment.id]: 0,
  });
  return {
    ok: true,
    today: "2026-09-06",
    netWorth: efCurrent,
    assetsTotal: efCurrent,
    liabilitiesTotal: 0,
    assets: [
      {
        id: ACCOUNTS.fd.id,
        name: "FD",
        group: "fd",
        type: "asset",
        balance: efCurrent,
        includeNetWorth: true,
        includeLiquid: false,
        isArchived: false,
        bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
      },
    ],
    liabilities: [],
    buckets,
    linkableAccounts: [
      {
        id: ACCOUNTS.fd.id,
        name: "FD",
        group: "fd",
        type: "asset",
        balance: efCurrent,
        includeNetWorth: true,
        includeLiquid: false,
        isArchived: false,
        bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
      },
      {
        id: ACCOUNTS.hdfc.id,
        name: "HDFC Savings",
        group: "savings",
        type: "asset",
        balance: 0,
        includeNetWorth: true,
        includeLiquid: true,
        isArchived: false,
        bucketId: null,
      },
    ],
    free: surplus,
    essentialsAverage: 0,
    example,
    netWorthHistory: [
      { date: "2026-09-01", netWorth: rupeesToPaise(18_000) },
      { date: "2026-09-06", netWorth: efCurrent },
    ],
  };
}

function defaultAllocation(wealth: WealthResponse): AllocationResponse {
  const investAmount =
    wealth.example.lines.find((row) => row.bucketId === DEFAULT_BUCKET_IDS.investment)?.amount ?? 0;
  const investPlan = seedDefaultInvestPlan();
  return {
    ...wealth,
    freeCash: {
      ...HOME_FREE,
      liquid: wealth.free + rupeesToPaise(31_000),
      free: wealth.free,
    } as AllocationResponse["freeCash"],
    canAllocate: wealth.free > 0,
    investPlan,
    investSplit: investAmount > 0 ? splitInvest(investAmount, investPlan) : null,
    suggested: [
      {
        bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
        fromAccountId: ACCOUNTS.hdfc.id,
        toAccountId: ACCOUNTS.fd.id,
        type: "investment",
      },
      {
        bucketId: DEFAULT_BUCKET_IDS.savingsBuffer,
        fromAccountId: ACCOUNTS.hdfc.id,
        toAccountId: ACCOUNTS.icici.id,
        type: "transfer",
      },
      {
        bucketId: DEFAULT_BUCKET_IDS.investment,
        fromAccountId: ACCOUNTS.hdfc.id,
        toAccountId: ACCOUNTS.fd.id,
        type: "investment",
      },
    ],
    history: [],
  };
}

function goldOnPlan(): InvestPlan {
  const base = seedDefaultInvestPlan();
  return {
    ...base,
    assets: [
      ...base.assets,
      {
        id: DEFAULT_ASSET_IDS.gold,
        name: GOLD_ASSET_NAME,
        kind: "core",
        targetBp: 1_000,
        dipPriority: 9,
        instrumentNote: "",
        active: true,
      },
    ],
  };
}

function defaultInvest(plan: InvestPlan = seedDefaultInvestPlan()): InvestResponse {
  const amount = rupeesToPaise(10_000);
  return {
    ok: true,
    today: "2026-09-06",
    plan,
    previousPlan: null,
    lastInvestAmount: amount,
    lastRunId: "run_1",
    sipSplit: splitInvest(amount, plan),
    dipBalance: rupeesToPaise(3_450),
    dipHistory: [
      {
        id: "dip_1",
        date: "2026-09-06",
        credit: rupeesToPaise(3_450),
        debit: 0,
        runId: "run_1",
        ledgerEntryId: null,
        note: "Allocation dip credit",
      },
    ],
    suggestedDip: { amount: 0, leftover: 0, orders: [] },
    accounts: [
      {
        id: ACCOUNTS.hdfc.id,
        name: "HDFC Savings",
        group: "savings",
        balance: rupeesToPaise(20_000),
      },
      {
        id: ACCOUNTS.fd.id,
        name: "FD",
        group: "fd",
        balance: 0,
      },
    ],
    suggestedFromAccountId: ACCOUNTS.hdfc.id,
    suggestedToAccountId: ACCOUNTS.fd.id,
  };
}

function emptyGoals(): GoalsResponse {
  return {
    ok: true,
    today: "2026-09-06",
    totalRemaining: 0,
    fundingNote: "Funded from Savings buffer",
    buckets: [
      { id: DEFAULT_BUCKET_IDS.emergencyFund, name: "Emergency Fund", current: 0 },
      {
        id: DEFAULT_BUCKET_IDS.savingsBuffer,
        name: "Savings buffer",
        current: rupeesToPaise(10_000),
      },
      { id: DEFAULT_BUCKET_IDS.investment, name: "Investment", current: 0 },
    ],
    accounts: [],
    goals: [],
    contributions: [],
  };
}

function goalCard(
  partial: Partial<GoalCard> & Pick<GoalCard, "id" | "name">,
): GoalCard {
  return {
    targetAmount: rupeesToPaise(8_000),
    targetDate: null,
    priority: 1,
    fundingBucketId: DEFAULT_BUCKET_IDS.savingsBuffer,
    status: "active",
    notes: "",
    funded: 0,
    remaining: rupeesToPaise(8_000),
    availableNow: rupeesToPaise(10_000),
    monthsLeft: null,
    neededPerMonth: null,
    expectedMonthly: 0,
    pill: "affordable_now",
    pillLabel: "Affordable now",
    needsTarget: false,
    contributionCount: 0,
    ...partial,
  };
}

function approvalGoals(): GoalsResponse {
  const base = emptyGoals();
  return {
    ...base,
    totalRemaining: rupeesToPaise(16_000),
    goals: [
      goalCard({
        id: "goal_german",
        name: "German Exams",
        priority: 1,
        pill: "affordable_now",
        pillLabel: "Affordable now",
        availableNow: rupeesToPaise(10_000),
      }),
      goalCard({
        id: "goal_mac",
        name: "MacBook Air",
        priority: 2,
        pill: "saving",
        pillLabel: "Saving",
        availableNow: rupeesToPaise(2_000),
      }),
      goalCard({
        id: "goal_iphone",
        name: "iPhone",
        priority: 3,
        targetAmount: null,
        remaining: null,
        needsTarget: true,
        pill: "saving",
        pillLabel: "Saving",
        availableNow: rupeesToPaise(2_000),
      }),
    ],
  };
}

function stubApi(opts?: {
  books?: Books;
  ledgerStatus?: number;
  entries?: LedgerEntry[];
  accountBalances?: Partial<Record<string, number>>;
  lastImport?: string | null;
  homeStatus?: number;
  pinSet?: boolean;
  blurDefault?: boolean;
  goals?: GoalsResponse;
  invest?: InvestResponse;
}) {
  const books = opts?.books ?? mockBooks();
  const ledgerStatus = opts?.ledgerStatus ?? 201;
  const entries = [...(opts?.entries ?? [])];
  let wealth = defaultWealth();
  let allocation = defaultAllocation(wealth);
  let goalsPayload = opts?.goals ?? emptyGoals();
  let investPayload = opts?.invest ?? defaultInvest();
  let plan = planPayload({
    accounts: [...books.accounts],
    categories: [...books.categories],
  });
  const accountRows: AccountBalanceRow[] = books.accounts.map((row) =>
    asBalanceRow(row, { balance: opts?.accountBalances?.[row.id] ?? 0 }),
  );
  const money = {
    defaultBudget: books.settings.defaultBudget,
    monthlySalary: books.settings.monthlySalary,
    salaryDay: books.settings.salaryDay,
    efMonths: 6,
  };
  const lock = {
    pinSet: opts?.pinSet ?? false,
    blurDefault: opts?.blurDefault ?? false,
    autoLockSeconds: 120,
  };
  let cats: CategoryListItem[] = books.categories.map((row) => ({
    ...row,
    isEssential: row.name === "Groceries" || row.name === "Eating outside",
    usageCount: row.id === CATEGORIES.eating.id ? 3 : 0,
  }));
  const settingsPayload = () => ({
    ok: true,
    money,
    lock,
    categories: cats,
    essentialIds: cats.filter((row) => row.isEssential).map((row) => row.id),
    identity: { required: false, login: null },
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.pathname === "/api/health") {
      return jsonResponse({
        ok: true,
        schemaVersion: "6",
        dbFile: "test.sqlite",
        lastBackup: null,
        lastImport: null,
      });
    }
    if (url.pathname === "/api/lock") {
      return jsonResponse({
        ok: true,
        ...lock,
        identity: { required: false, login: null },
      });
    }
    if (url.pathname === "/api/lock/unlock" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { pin?: string };
      if (body.pin === "1234") return jsonResponse({ ok: true, unlocked: true });
      return jsonResponse({ ok: false, error: "Wrong PIN." }, 401);
    }
    if (url.pathname === "/api/categories") {
      if (method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          name: string;
          group: string;
          defaultInBudget?: boolean;
        };
        const created: CategoryListItem = {
          id: "cat_new",
          name: body.name,
          group: body.group,
          defaultInBudget: body.defaultInBudget ?? true,
          icon: null,
          isArchived: false,
          sort: 9,
          isEssential: false,
          usageCount: 0,
        };
        cats = [...cats, created];
        return jsonResponse({ ok: true, category: created, categories: cats }, 201);
      }
      return jsonResponse({ ok: true, categories: cats });
    }
    if (url.pathname.startsWith("/api/categories/") && method === "PATCH") {
      const id = url.pathname.split("/").pop() ?? "";
      const body = JSON.parse(String(init?.body ?? "{}")) as Partial<CategoryListItem>;
      cats = cats.map((row) => (row.id === id ? { ...row, ...body } : row));
      const category = cats.find((row) => row.id === id);
      return jsonResponse({ ok: true, category, categories: cats });
    }
    if (url.pathname === "/api/settings") {
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          defaultBudget?: number;
          blurDefault?: boolean;
        };
        if (body.defaultBudget != null) money.defaultBudget = body.defaultBudget;
        if (body.blurDefault != null) lock.blurDefault = body.blurDefault;
        return jsonResponse(settingsPayload());
      }
      return jsonResponse(settingsPayload());
    }
    if (url.pathname === "/api/settings/pin") {
      if (method === "POST") {
        lock.pinSet = true;
        return jsonResponse({ ok: true, lock });
      }
      if (method === "DELETE") {
        lock.pinSet = false;
        return jsonResponse({ ok: true, lock });
      }
    }
    if (url.pathname === "/api/books") {
      return jsonResponse({ ok: true, books: { ...books, entries } });
    }
    if (url.pathname === "/api/home") {
      if (opts?.homeStatus && opts.homeStatus !== 200) {
        return jsonResponse({ ok: false, error: "laptop asleep" }, opts.homeStatus);
      }
      return jsonResponse({
        ok: true,
        today: MONTH_PAYLOAD.today,
        month: MONTH_PAYLOAD.month,
        lastImport: opts?.lastImport ?? null,
        pace: MONTH_PAYLOAD.pace,
        summary: MONTH_PAYLOAD.summary,
        free: HOME_FREE,
        nextMonth: {
          today: MONTH_PAYLOAD.today,
          nextMonth: "2026-10",
          freeToday: HOME_FREE.free,
          nextEmi: 0,
          salary: rupeesToPaise(1_40_000),
          nextCap: rupeesToPaise(31_000),
          estimated: HOME_FREE.free + rupeesToPaise(1_40_000) - rupeesToPaise(31_000),
          breakdown: [
            {
              key: "free_today",
              label: "Free to allocate (today)",
              sign: 1,
              amount: HOME_FREE.free,
            },
            { key: "next_emi", label: "Next month Loan / EMI", sign: -1, amount: 0 },
            { key: "salary", label: "Monthly salary", sign: 1, amount: rupeesToPaise(1_40_000) },
            {
              key: "next_cap",
              label: "Next month budget",
              sign: -1,
              amount: rupeesToPaise(31_000),
            },
          ],
        },
        forecast: {
          months: ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"].map(
            (month) => ({ month, loanEmi: 0, lifestyle: 0, investment: 0, total: 0 }),
          ),
          totals: { loanEmi: 0, lifestyle: 0, investment: 0, total: 0 },
        },
        cards: accountRows
          .filter((row) => row.group === "credit_card" && !row.isArchived)
          .map((row) => ({
            accountId: row.id,
            name: row.name,
            due: row.balance,
            creditLimit: row.creditLimit,
            available: row.available,
            utilisation: row.utilisation,
            dueDay: row.dueDay,
          })),
        recent: entries.slice(0, 5),
        accounts: books.accounts,
        categories: books.categories,
        recon: accountRows.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          group: row.group,
          isArchived: row.isArchived,
          lastReconciledAt: row.lastReconciledAt,
          daysSinceReconcile: row.daysSinceReconcile,
        })),
        paceByCategory: [],
      });
    }
    if (url.pathname === "/api/wealth") {
      return jsonResponse(wealth);
    }
    if (url.pathname === "/api/portfolio") {
      return jsonResponse({
        ok: true,
        today: "2026-09-06",
        value: rupeesToPaise(5_500),
        invested: rupeesToPaise(5_000),
        gain: rupeesToPaise(500),
        gainPct: 0.1,
        netWorth: wealth.netWorth,
        holdings: [
          {
            id: "hold_nasdaq",
            assetId: DEFAULT_ASSET_IDS.nasdaq100,
            assetName: "NASDAQ-100",
            accountId: "acc_mf",
            accountName: "Mutual Fund",
            accountGroup: "investment",
            lastNav: rupeesToPaise(22),
            lastNavDate: "2026-09-06",
            units: 250_000_000,
            avgCost: rupeesToPaise(20),
            cost: rupeesToPaise(5_000),
            value: rupeesToPaise(5_500),
            gain: rupeesToPaise(500),
            gainPct: 0.1,
            updatedAt: "2026-09-06T00:00:00.000Z",
          },
        ],
        fds: [
          {
            accountId: ACCOUNTS.fd.id,
            name: "FD",
            balance: rupeesToPaise(20_000),
            maturityDate: "2026-12-01",
            daysCaption: "matures in 86 days",
          },
        ],
        drift: [
          {
            assetId: DEFAULT_ASSET_IDS.nasdaq100,
            name: "NASDAQ-100",
            targetBp: 2_500,
            actualBp: 10_000,
            driftPp: 75,
            hint: true,
          },
        ],
        history: wealth.netWorthHistory,
        planId: "plan_1",
        assets: seedDefaultInvestPlan().assets.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
        })),
        accounts: [
          { id: ACCOUNTS.hdfc.id, name: "HDFC Savings", group: "savings" },
          { id: "acc_mf", name: "Mutual Fund", group: "investment" },
        ],
      });
    }
    if (url.pathname === "/api/goals") {
      if (method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          name: string;
          targetAmount?: number | null;
        };
        const created = goalCard({
          id: "goal_new",
          name: body.name,
          targetAmount: body.targetAmount ?? null,
          remaining: body.targetAmount ?? null,
          needsTarget: body.targetAmount == null,
          pill: body.targetAmount == null ? "saving" : "saving",
          pillLabel: "Saving",
          priority: goalsPayload.goals.length + 1,
        });
        goalsPayload = {
          ...goalsPayload,
          goals: [...goalsPayload.goals, created],
        };
        return jsonResponse({ ...goalsPayload, goal: created }, 201);
      }
      return jsonResponse(goalsPayload);
    }
    if (url.pathname === "/api/goals/order" && method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { ids: string[] };
      const map = new Map(goalsPayload.goals.map((row) => [row.id, row]));
      goalsPayload = {
        ...goalsPayload,
        goals: body.ids.map((id, index) => {
          const row = map.get(id);
          if (!row) return goalCard({ id, name: id, priority: index + 1 });
          return { ...row, priority: index + 1 };
        }),
      };
      return jsonResponse(goalsPayload);
    }
    if (url.pathname.startsWith("/api/goals/")) {
      const rest = decodeURIComponent(url.pathname.slice("/api/goals/".length));
      if (rest.endsWith("/contribute") && method === "POST") {
        const id = rest.slice(0, -"/contribute".length);
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          amount: number;
          note: string;
          date?: string;
        };
        if (!body.note || body.note.trim() === "") {
          return jsonResponse({ ok: false, error: "A note is required when there is no bank move." }, 400);
        }
        const contrib: GoalContribution = {
          id: `gc_${goalsPayload.contributions.length + 1}`,
          goalId: id,
          date: body.date ?? "2026-09-06",
          amount: body.amount,
          note: body.note,
          ledgerEntryId: null,
        };
        goalsPayload = {
          ...goalsPayload,
          contributions: [contrib, ...goalsPayload.contributions],
          goals: goalsPayload.goals.map((row) => {
            if (row.id !== id) return row;
            const funded = row.funded + body.amount;
            const remaining = row.targetAmount == null ? null : row.targetAmount - funded;
            const done = remaining != null && remaining <= 0;
            return {
              ...row,
              funded,
              remaining,
              contributionCount: row.contributionCount + 1,
              pill: done ? "achieved" : row.pill,
              pillLabel: done ? "Achieved" : row.pillLabel,
              status: done ? "achieved" : row.status,
            };
          }),
        };
        return jsonResponse({ ...goalsPayload, contribution: contrib }, 201);
      }
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Partial<GoalCard>;
        goalsPayload = {
          ...goalsPayload,
          goals: goalsPayload.goals.map((row) =>
            row.id === rest
              ? {
                  ...row,
                  ...body,
                  needsTarget: (body.targetAmount ?? row.targetAmount) == null,
                }
              : row,
          ),
        };
        const goal = goalsPayload.goals.find((row) => row.id === rest);
        return jsonResponse({ ...goalsPayload, goal });
      }
    }
    if (url.pathname === "/api/allocation") {
      return jsonResponse(allocation);
    }
    if (url.pathname === "/api/allocation/run" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        surplusInput: number;
        overrideReason?: string | null;
        confirm?: boolean;
        lines: { bucketId: string; amount: number; fromAccountId?: string; toAccountId?: string }[];
      };
      const run = {
        id: "run_1",
        month: "2026-09",
        surplusInput: body.surplusInput,
        overrideReason: body.overrideReason ?? null,
        status: (body.confirm ? "confirmed" : "proposed") as "confirmed" | "proposed",
        createdAt: "2026-09-06T12:00:00.000Z",
        confirmedAt: body.confirm ? "2026-09-06T12:00:00.000Z" : null,
        lines: (body.lines ?? []).map((line, i) => ({
          id: `line_${i}`,
          bucketId: line.bucketId,
          name: line.bucketId,
          proposedAmount: line.amount,
          confirmedAmount: body.confirm ? line.amount : null,
          ledgerEntryId: body.confirm && line.amount > 0 ? `led_alloc_${i}` : null,
          fromAccountId: line.fromAccountId ?? null,
          toAccountId: line.toAccountId ?? null,
          type: null,
        })),
      };
      allocation = { ...allocation, run, history: [run, ...allocation.history] };
      return jsonResponse(allocation, 201);
    }
    if (url.pathname === "/api/invest") {
      return jsonResponse(investPayload);
    }
    if (url.pathname === "/api/invest/plan" && method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}")) as InvestPlan;
      const saved = { ...body, id: "invest_plan_v2", effectiveFrom: "2026-09-06" };
      investPayload = {
        ...investPayload,
        previousPlan: investPayload.plan,
        plan: saved,
        sipSplit: body.assets.length
          ? splitInvest(investPayload.lastInvestAmount || rupeesToPaise(10_000), saved)
          : investPayload.sipSplit,
      };
      return jsonResponse(investPayload);
    }
    if (url.pathname === "/api/invest/split") {
      const amount = Number(url.searchParams.get("amount") ?? "0");
      const plan = investPayload.plan ?? seedDefaultInvestPlan();
      return jsonResponse({ ok: true, split: splitInvest(amount, plan), plan });
    }
    if (url.pathname === "/api/invest/dip-buy" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        amount: number;
        lines: { assetId: string; amount: number }[];
      };
      investPayload = {
        ...investPayload,
        dipBalance: investPayload.dipBalance - body.amount,
        dipHistory: [
          {
            id: "dip_debit",
            date: "2026-09-06",
            credit: 0,
            debit: body.amount,
            runId: null,
            ledgerEntryId: "led_dip",
            note: "Dip · NASDAQ-100",
          },
          ...investPayload.dipHistory,
        ],
      };
      return jsonResponse(investPayload, 201);
    }
    if (url.pathname === "/api/seed/invest" && method === "POST") {
      investPayload = defaultInvest();
      return jsonResponse({ ok: true, report: { filename: "seed" } });
    }
    if (url.pathname === "/api/buckets") {
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          buckets: WealthResponse["buckets"];
        };
        const next = (body.buckets ?? []).map((row) => {
          const prev = wealth.buckets.find((item) => item.id === row.id);
          const current = prev?.current ?? 0;
          const target =
            row.targetRule === "none"
              ? null
              : row.targetRule === "fixed"
                ? row.targetAmount
                : prev?.target ?? null;
          return {
            ...prev,
            ...row,
            current,
            target,
            room: target == null ? null : Math.max(0, target - current),
            fillPct: target != null && target > 0 ? current / target : null,
            accounts: prev?.accounts ?? [],
          };
        });
        const currentMap: Record<string, number> = {};
        for (const row of next) currentMap[row.id] = row.current;
        wealth = {
          ...wealth,
          buckets: next,
          example: runWaterfall(wealth.free, next, currentMap),
        };
        return jsonResponse(wealth);
      }
      return jsonResponse({
        ok: true,
        buckets: wealth.buckets,
        linkableAccounts: wealth.linkableAccounts,
        free: wealth.free,
        essentialsAverage: wealth.essentialsAverage,
        example: wealth.example,
      });
    }
    if (url.pathname === "/api/plan") {
      return jsonResponse(plan);
    }
    if (url.pathname.startsWith("/api/budgets/") && method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { cap: number };
      plan = {
        ...plan,
        pace: { ...plan.pace, cap: body.cap, remaining: body.cap - plan.pace.spent },
        defaultBudget: body.cap,
      };
      return jsonResponse({
        ...plan,
        budget: { month: plan.month, cap: body.cap, defaultBudget: body.cap },
      });
    }
    if (url.pathname.startsWith("/api/plans/recurring/") && method === "PATCH") {
      const id = decodeURIComponent(url.pathname.slice("/api/plans/recurring/".length));
      const body = JSON.parse(String(init?.body ?? "{}")) as Partial<RecurringPlan>;
      plan = {
        ...plan,
        recurring: plan.recurring.map((row) => (row.id === id ? { ...row, ...body } : row)),
      };
      const live = plan.recurring.filter((row) => row.active);
      plan = {
        ...plan,
        recurringHeader: {
          monthlyFixed: live
            .filter((row) => row.frequency === "monthly")
            .reduce((s, row) => s + row.amount, 0),
          activeCount: live.length,
          yearlyCommitments: live
            .filter((row) => row.frequency === "yearly")
            .reduce((s, row) => s + row.amount, 0),
        },
      };
      return jsonResponse(plan);
    }
    if (url.pathname === "/api/plans/recurring" && method === "POST") {
      return jsonResponse(plan, 201);
    }
    if (url.pathname.startsWith("/api/plans/one-time/") && method === "PATCH") {
      const id = decodeURIComponent(url.pathname.slice("/api/plans/one-time/".length));
      const body = JSON.parse(String(init?.body ?? "{}")) as Partial<OneTimePlan>;
      plan = {
        ...plan,
        oneTime: plan.oneTime.map((row) => (row.id === id ? { ...row, ...body } : row)),
      };
      const planned = plan.oneTime.filter((row) => row.status === "planned");
      plan = {
        ...plan,
        oneTimeHeader: {
          next30: planned.reduce((s, row) => s + row.amount, 0),
          next90: planned.reduce((s, row) => s + row.amount, 0),
          totalPlanned: planned.reduce((s, row) => s + row.amount, 0),
        },
      };
      return jsonResponse(plan);
    }
    if (url.pathname === "/api/plans/one-time" && method === "POST") {
      return jsonResponse(plan, 201);
    }
    if (url.pathname.startsWith("/api/plans/inflows") && (method === "POST" || method === "PATCH")) {
      return jsonResponse(plan, method === "POST" ? 201 : 200);
    }
    if (url.pathname.startsWith("/api/month/")) {
      return jsonResponse({ ok: true, ...MONTH_PAYLOAD });
    }
    if (url.pathname === "/api/accounts" || url.pathname === "/api/accounts/balances") {
      if (method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          name: string;
          group: Account["group"];
          openingBalance: number;
          includeLiquid: boolean;
        };
        const created: Account = asset("acc_new", body.name, body.group);
        created.includeLiquid = body.includeLiquid;
        created.openingBalance = body.openingBalance;
        accountRows.push(asBalanceRow(created, { balance: body.openingBalance }));
        return jsonResponse({ ok: true, account: created, liquid: body.openingBalance, accounts: accountRows }, 201);
      }
      return jsonResponse({
        ok: true,
        today: todayIst(),
        liquid: accountRows.filter((row) => row.includeLiquid).reduce((s, row) => s + row.balance, 0),
        accounts: accountRows,
        buckets: [],
      });
    }
    if (url.pathname.startsWith("/api/accounts/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/accounts/".length));
      const row = accountRows.find((item) => item.id === id);
      if (!row) return jsonResponse({ ok: false, error: "not found" }, 404);
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Partial<Account>;
        Object.assign(row, body);
        return jsonResponse({ ok: true, account: row, liquid: 0, detail: null });
      }
      return jsonResponse({
        ok: true,
        today: todayIst(),
        account: row,
        balance: row.balance,
        available: row.available,
        utilisation: row.utilisation,
        lastReconciledAt: row.lastReconciledAt,
        daysSinceReconcile: row.daysSinceReconcile,
        cycleStart: "2026-09-01",
        cycleSpent: 0,
        entries: entries.filter(
          (e) => e.fromAccountId === id || e.toAccountId === id,
        ),
        reconciliations: [],
        accounts: books.accounts,
        categories: books.categories,
        buckets: [],
        canReconcile: row.type !== "virtual",
        canArchive: row.type !== "virtual",
      });
    }
    if (url.pathname === "/api/reconcile" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        accountId: string;
        actualBalance: number;
        resolution: string;
        notes?: string;
      };
      return jsonResponse({
        ok: true,
        reconciliation: {
          id: "recon_1",
          accountId: body.accountId,
          checkedAt: todayIst(),
          calculatedBalance: 0,
          actualBalance: body.actualBalance,
          difference: body.actualBalance,
          resolution: body.resolution,
          adjustmentEntryId: body.resolution === "adjustment" ? "led_adj" : null,
          notes: body.notes ?? "",
        },
        entry:
          body.resolution === "adjustment"
            ? {
                id: "led_adj",
                type: "adjustment",
                amount: body.actualBalance,
              }
            : null,
        account: accountRows.find((row) => row.id === body.accountId),
        balance: body.actualBalance,
        liquid: body.actualBalance,
        ...MONTH_PAYLOAD,
      });
    }
    if (url.pathname === "/api/ledger" || url.pathname.startsWith("/api/ledger/")) {
      const id = url.pathname === "/api/ledger" ? "" : decodeURIComponent(url.pathname.slice("/api/ledger/".length));
      if (method === "GET" && id === "") {
        return jsonResponse({
          ok: true,
          month: url.searchParams.get("month") ?? "2026-09",
          today: todayIst(),
          entries,
          accounts: books.accounts,
          categories: books.categories,
        });
      }
      if (method === "GET") {
        const entry = entries.find((row) => row.id === id);
        if (!entry) return jsonResponse({ ok: false, error: "not found" }, 404);
        return jsonResponse({
          ok: true,
          today: todayIst(),
          entry,
          accounts: books.accounts,
          categories: books.categories,
        });
      }
      if (method === "POST") {
        if (ledgerStatus !== 201) {
          return jsonResponse(
            { ok: false, issues: [{ field: "toAccountId", message: "nope" }] },
            ledgerStatus,
          );
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          amount: number;
          type: LedgerType;
          categoryId: string;
          fromAccountId: string;
          toAccountId: string;
          date: string;
          inBudget: boolean;
          notes: string;
        };
        const created: LedgerEntry = {
          id: "led_1",
          date: body.date,
          time: null,
          type: body.type,
          amount: body.amount,
          fromAccountId: body.fromAccountId,
          toAccountId: body.toAccountId,
          categoryId: body.categoryId,
          inBudget: body.inBudget,
          notes: body.notes,
          source: "manual",
          goalId: null,
          holdingTxnId: null,
          createdAt: "2026-09-06T12:00:00+05:30",
          updatedAt: "2026-09-06T12:00:00+05:30",
        };
        entries.push(created);
        return jsonResponse(
          {
            ok: true,
            entry: created,
            ...MONTH_PAYLOAD,
            pace: { ...MONTH_PAYLOAD.pace, spent: body.amount },
            summary: { ...MONTH_PAYLOAD.summary, budgetSpent: body.amount },
          },
          201,
        );
      }
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Partial<LedgerEntry>;
        const idx = entries.findIndex((row) => row.id === id);
        if (idx < 0) return jsonResponse({ ok: false, error: "not found" }, 404);
        const updated = {
          ...entries[idx],
          ...body,
          id,
          updatedAt: "2026-09-06T16:00:00+05:30",
        } as LedgerEntry;
        entries[idx] = updated;
        return jsonResponse({ ok: true, entry: updated, ...MONTH_PAYLOAD });
      }
      if (method === "DELETE") {
        const idx = entries.findIndex((row) => row.id === id);
        if (idx < 0) return jsonResponse({ ok: false, error: "not found" }, 404);
        entries.splice(idx, 1);
        return jsonResponse({ ok: true, id, ...MONTH_PAYLOAD });
      }
    }
    return jsonResponse({ ok: false, error: "missing stub" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe("app shell", () => {
  it("renders Home and switches tabs", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Wealth" }));
    expect(await screen.findByRole("heading", { name: "Wealth" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Invest" }));
    expect(await screen.findByRole("heading", { name: "Invest" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Goals" }));
    expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "More" }));
    expect(screen.getByRole("heading", { name: "More" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan" })).toBeInTheDocument();
  });

  it("opens and closes the Quick Add sheet", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Quick Add" }));
    expect(screen.getByRole("dialog", { name: "Quick Add" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: "Expense" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("logs ₹240 eating outside on HDFC CC", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Quick Add" }));
    const addSheet = await screen.findByRole("dialog", { name: "Quick Add" });
    expect(await within(addSheet).findByText("HDFC Credit Card")).toBeInTheDocument();
    expect(within(addSheet).getByRole("button", { name: "Eating outside" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "4" }));
    await user.click(screen.getByRole("button", { name: "0" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes("/api/ledger"),
      );
      expect(posted).toBeTruthy();
      const body = JSON.parse(String(posted?.[1]?.body ?? "{}")) as {
        amount: number;
        type: string;
        fromAccountId: string;
        toAccountId: string;
        categoryId: string;
      };
      expect(body.amount).toBe(rupeesToPaise(240));
      expect(body.type).toBe("expense");
      expect(body.fromAccountId).toBe(ACCOUNTS.hdfcCc.id);
      expect(body.toAccountId).toBe(ACCOUNTS.expense.id);
      expect(body.categoryId).toBe(CATEGORIES.eating.id);
    });

    expect(await screen.findByRole("status")).toHaveTextContent(/₹240/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an inline hint when there is no credit card to pay", async () => {
    stubApi({
      books: mockBooks(
        Object.values(ACCOUNTS).filter((row) => row.group !== "credit_card"),
      ),
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Quick Add" }));
    expect(await screen.findByRole("radio", { name: "Expense" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "CC pay" }));

    expect(
      await screen.findByText("No credit card account to pay."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("toasts not saved when the API rejects the row", async () => {
    stubApi({ ledgerStatus: 400 });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Quick Add" }));
    const addSheet = await screen.findByRole("dialog", { name: "Quick Add" });
    await within(addSheet).findByText("HDFC Credit Card");
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "4" }));
    await user.click(screen.getByRole("button", { name: "0" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("not saved");
    });
  });
});

describe("ledger screen", () => {
  it("lists the ₹50 personal care row, edits the note, and soft-deletes", async () => {
    const fetchMock = stubApi({ entries: [personalCareEntry()] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Ledger" }));
    expect(await screen.findByText("Personal care")).toBeInTheDocument();
    expect(screen.getAllByText("₹50.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Budget ₹50.00/)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /Personal care/ }));
    expect(await screen.findByText("HDFC Credit Card → Expense")).toBeInTheDocument();
    expect(screen.getByText("Counts against this month's budget cap.")).toBeInTheDocument();
    expect(screen.getByText(/no balance field/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const note = await screen.findByPlaceholderText("Note");
    await user.type(note, "haircut");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patched = fetchMock.mock.calls.find((call) => {
        const url = String(call[0]);
        const method = call[1]?.method ?? "GET";
        return url.includes("/api/ledger/led_pc") && method === "PATCH";
      });
      expect(patched).toBeTruthy();
      const body = JSON.parse(String(patched?.[1]?.body ?? "{}")) as { notes: string };
      expect(body.notes).toBe("haircut");
    });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete row" }));
    await waitFor(() => {
      const deleted = fetchMock.mock.calls.find((call) => {
        const url = String(call[0]);
        const method = call[1]?.method ?? "GET";
        return url.includes("/api/ledger/led_pc") && method === "DELETE";
      });
      expect(deleted).toBeTruthy();
    });
  });
});

describe("accounts + reconcile screens", () => {
  it("lists accounts from More, grouped, with calculated balances", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "More" }));
    expect(screen.getByRole("heading", { name: "More" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Accounts" }));
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByText("Savings")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /HDFC Savings/ })).toBeInTheDocument();
    expect(screen.getByText(/cannot type one here/i)).toBeInTheDocument();
  });

  it("stamps a zero difference and posts an adjustment when the bank number differs", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Accounts" }));
    await user.click(await screen.findByRole("link", { name: /HDFC Savings/ }));
    await user.click(await screen.findByRole("link", { name: "Reconcile" }));
    expect(await screen.findByRole("heading", { name: "Reconcile" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark reconciled today" }));
    await waitFor(() => {
      const posted = fetchMock.mock.calls.find((call) => {
        const url = String(call[0]);
        const method = call[1]?.method ?? "GET";
        return url.includes("/api/reconcile") && method === "POST";
      });
      expect(posted).toBeTruthy();
      const body = JSON.parse(String(posted?.[1]?.body ?? "{}")) as {
        resolution: string;
        actualBalance: number;
      };
      expect(body.resolution).toBe("none");
      expect(body.actualBalance).toBe(0);
    });
  });

  it("posts an adjustment with a required note when actual differs", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Accounts" }));
    await user.click(await screen.findByRole("link", { name: /HDFC Savings/ }));
    await user.click(await screen.findByRole("link", { name: "Reconcile" }));
    await screen.findByRole("heading", { name: "Reconcile" });

    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "0" }));
    await user.click(screen.getByRole("button", { name: "0" }));
    const note = await screen.findByPlaceholderText("Required — why the gap");
    await user.type(note, "bank vs app");
    await user.click(screen.getByRole("button", { name: "Add adjustment" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find((call) => {
        const url = String(call[0]);
        const method = call[1]?.method ?? "GET";
        return url.includes("/api/reconcile") && method === "POST";
      });
      expect(posted).toBeTruthy();
      const body = JSON.parse(String(posted?.[1]?.body ?? "{}")) as {
        resolution: string;
        actualBalance: number;
        notes: string;
      };
      expect(body.resolution).toBe("adjustment");
      expect(body.actualBalance).toBe(rupeesToPaise(200));
      expect(body.notes).toBe("bank vs app");
    });
  });

  it("adds a liquid cash account from the sheet", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Accounts" }));
    await user.click(await screen.findByRole("button", { name: "+ Add" }));
    const name = await screen.findByPlaceholderText("HDFC Savings");
    await user.clear(name);
    await user.type(name, "Wallet");
    await user.click(screen.getByRole("button", { name: "Cash" }));
    await user.click(screen.getByRole("button", { name: "Add account" }));

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find((call) => {
        const url = String(call[0]);
        const method = call[1]?.method ?? "GET";
        return url.endsWith("/api/accounts") && method === "POST";
      });
      expect(posted).toBeTruthy();
      const body = JSON.parse(String(posted?.[1]?.body ?? "{}")) as {
        name: string;
        group: string;
        includeLiquid: boolean;
      };
      expect(body.name).toBe("Wallet");
      expect(body.group).toBe("cash");
      expect(body.includeLiquid).toBe(true);
    });
  });
});

describe("home screen", () => {
  it("shows pace, negative free cash, and the free-cash breakdown", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByText("No spending yet — ₹1,215.00 / day"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Committed beyond liquid").length).toBeGreaterThan(0);
    expect(screen.getByText("-₹31,000.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show breakdown" }));
    expect(screen.getByText("Liquid savings")).toBeInTheDocument();
    expect(screen.getByText("Budget still reserved")).toBeInTheDocument();
  });

  it("links this-month tiles and credit-card rows", async () => {
    stubApi({ accountBalances: { [ACCOUNTS.hdfcCc.id]: rupeesToPaise(702.16) } });
    render(<App />);

    expect(await screen.findByRole("link", { name: /Budget exp/ })).toHaveAttribute(
      "href",
      "/ledger?month=2026-09&type=expense&inBudget=1",
    );
    const cc = await screen.findByRole("link", { name: /HDFC Credit Card/ });
    expect(cc).toHaveAttribute("href", `/more/accounts/${ACCOUNTS.hdfcCc.id}`);
    expect(cc).toHaveTextContent("₹702.16");
  });

  it("shows an unverified-import banner after a statement import", async () => {
    stubApi({ lastImport: "2026-09-06T10:00:00+05:30" });
    render(<App />);

    const banner = await screen.findByRole("link", { name: /Unverified import/ });
    expect(banner).toHaveAttribute("href", "/more/accounts");
  });

  it("lists recent transactions on Home", async () => {
    stubApi({ entries: [personalCareEntry()] });
    render(<App />);
    expect(await screen.findByRole("link", { name: /Personal care/ })).toHaveAttribute(
      "href",
      "/ledger/led_pc",
    );
  });

  it("links the 6-month strip to Plan Forecast", async () => {
    stubApi();
    render(<App />);
    const strip = await screen.findByRole("link", { name: /Next 6 months/ });
    expect(strip).toHaveAttribute("href", "/plan?tab=forecast");
  });

  it("shows retry when Home cannot reach the API", async () => {
    const fetchMock = stubApi({ homeStatus: 503 });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText(/Can.t reach the laptop/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      const homes = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/home"));
      expect(homes.length).toBeGreaterThan(1);
    });
  });
});

describe("plan screen", () => {
  it("shows this month's cap and sub-tabs", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Plan" }));
    expect(await screen.findByText("Cap")).toBeInTheDocument();
    expect(screen.getByText("₹31,000.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recurring" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forecast" })).toBeInTheDocument();
  });

  it("turning a recurring row off PATCHes active false and does not post a ledger row", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Plan" }));
    await user.click(await screen.findByRole("button", { name: "Recurring" }));
    expect(await screen.findByText("MacBook SmartEMI")).toBeInTheDocument();
    expect(screen.getByText("Scooty insurance")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "MacBook SmartEMI active" }));
    await waitFor(() => {
      const patched = fetchMock.mock.calls.find((call) => {
        const url = String(call[0]);
        const method = call[1]?.method ?? "GET";
        return url.includes("/api/plans/recurring/rec_smart") && method === "PATCH";
      });
      expect(patched).toBeTruthy();
      const body = JSON.parse(String(patched?.[1]?.body ?? "{}")) as { active: boolean };
      expect(body.active).toBe(false);
    });
    const ledgerPosts = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      const method = call[1]?.method ?? "GET";
      return url.includes("/api/ledger") && method === "POST";
    });
    expect(ledgerPosts).toEqual([]);
  });

  it("completing a one-time flips status and does not invent a ledger row", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Plan" }));
    await user.click(await screen.findByRole("button", { name: "One-time" }));
    expect(await screen.findByText("Flights")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => {
      const patched = fetchMock.mock.calls.find((call) => {
        const url = String(call[0]);
        const method = call[1]?.method ?? "GET";
        return url.includes("/api/plans/one-time/ot_flights") && method === "PATCH";
      });
      expect(patched).toBeTruthy();
      const body = JSON.parse(String(patched?.[1]?.body ?? "{}")) as { status: string };
      expect(body.status).toBe("completed");
    });
    const ledgerPosts = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      const method = call[1]?.method ?? "GET";
      return url.includes("/api/ledger") && method === "POST";
    });
    expect(ledgerPosts).toEqual([]);
  });

  it("Forecast lists which rows make up Loan/EMI in a month", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Plan" }));
    await user.click(await screen.findByRole("button", { name: "Forecast" }));
    expect(await screen.findByRole("switch", { name: /Assume expected inflows arrive/ })).toBeInTheDocument();
    const loanButtons = await screen.findAllByRole("button", { name: /Loan\/EMI/ });
    await user.click(loanButtons[loanButtons.length - 1]!);
    expect(await screen.findByText("MacBook SmartEMI")).toBeInTheDocument();
  });
});

describe("categories + settings", () => {
  it("lists categories from More, adds one, and archives", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Categories" }));
    expect(await screen.findByText("Eating outside")).toBeInTheDocument();
    expect(screen.getByText("3 uses · essential")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Eating outside default in budget" }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (call) =>
          String(call[0]).includes("/api/categories/cat_eating") &&
          (call[1]?.method ?? "GET").toUpperCase() === "PATCH",
      );
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch?.[1]?.body ?? "{}"))).toMatchObject({
        defaultInBudget: false,
      });
    });

    await user.click(screen.getByRole("button", { name: "+ Add" }));
    const sheet = await screen.findByRole("dialog", { name: "Add category" });
    await user.type(within(sheet).getAllByRole("textbox")[0]!, "Milk");
    await user.click(within(sheet).getByRole("button", { name: "Add category" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Milk added");
    expect(await screen.findByText("Milk")).toBeInTheDocument();
  });

  it("saves default budget and blur from Settings", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "More" }));
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByText("Default monthly budget")).toBeInTheDocument();
    expect(screen.getByText("₹31,000.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Default monthly budget/ }));
    const budgetSheet = await screen.findByRole("dialog", { name: "Default budget" });
    await user.click(within(budgetSheet).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (call) =>
          String(call[0]).includes("/api/settings") &&
          (call[1]?.method ?? "GET").toUpperCase() === "PUT",
      );
      expect(JSON.parse(String(put?.[1]?.body ?? "{}")).defaultBudget).toBe(
        rupeesToPaise(31_000),
      );
    });

    await user.click(screen.getByRole("switch", { name: /Blur Home numbers by default/ }));
    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(
        (call) =>
          String(call[0]).includes("/api/settings") &&
          (call[1]?.method ?? "GET").toUpperCase() === "PUT",
      );
      const bodies = puts.map((call) => JSON.parse(String(call[1]?.body ?? "{}")));
      expect(bodies.some((body: { blurDefault?: boolean }) => body.blurDefault === true)).toBe(
        true,
      );
    });
  });
});

describe("wealth", () => {
  it("shows net worth and EF fill from FD", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Wealth" }));
    expect(await screen.findByRole("heading", { name: "Wealth" })).toBeInTheDocument();
    expect(screen.getByText("Net worth")).toBeInTheDocument();
    expect(screen.getByText("Emergency Fund")).toBeInTheDocument();
    expect(screen.getAllByText("FD").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Emergency Fund 100%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Portfolio" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Net worth history" })).toBeInTheDocument();
    expect(
      screen.getByText(/With ₹20,000.00 surplus today this plan gives EF ₹0.00, Savings ₹10,000.00, Investment ₹10,000.00/),
    ).toBeInTheDocument();
  });

  it("updates rings and the example split when Savings target goes 10k → 30k without posting ledger", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Wealth" }));
    await user.click(await screen.findByRole("link", { name: "Edit bucket rules" }));
    expect(await screen.findByRole("heading", { name: "Bucket rules" })).toBeInTheDocument();

    const savingsTarget = await screen.findByLabelText("Savings buffer target rupees");
    await user.clear(savingsTarget);
    await user.type(savingsTarget, "30000");

    expect(
      await screen.findByText(
        /With ₹20,000.00 surplus today this plan gives EF ₹0.00, Savings ₹20,000.00, Investment ₹0.00/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save rules" }));
    await screen.findByText("Bucket rules saved");

    const puts = fetchMock.mock.calls.filter(
      (call) => String(call[0]).includes("/api/buckets") && (call[1] as RequestInit | undefined)?.method === "PUT",
    );
    expect(puts).toHaveLength(1);
    const putInit = puts[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(putInit?.body ?? "{}")) as {
      buckets: { id: string; targetAmount: number | null }[];
    };
    const savings = body.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.savingsBuffer);
    expect(savings?.targetAmount).toBe(rupeesToPaise(30_000));
    const ledgerPosts = fetchMock.mock.calls.filter(
      (call) => String(call[0]).includes("/api/ledger") && (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(ledgerPosts).toHaveLength(0);
  });

  it("opens Allocate from Wealth and confirms the waterfall", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Wealth" }));
    await user.click(await screen.findByRole("link", { name: /Allocate this month/ }));
    expect(await screen.findByRole("heading", { name: "Allocate" })).toBeInTheDocument();
    expect(screen.getByText("This month’s SIP")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm allocation" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Allocated/);
    const posts = fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]).includes("/api/allocation/run") &&
        (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String((posts[0]?.[1] as RequestInit | undefined)?.body ?? "{}")) as {
      confirm: boolean;
      surplusInput: number;
    };
    expect(body.confirm).toBe(true);
    expect(body.surplusInput).toBe(rupeesToPaise(20_000));
  });
});

describe("goals", () => {
  it("shows Affordable now on the first ₹8,000 goal and not the second", async () => {
    stubApi({ goals: approvalGoals() });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Goals" }));
    expect(await screen.findByText("German Exams")).toBeInTheDocument();
    expect(screen.getByText("Affordable now")).toBeInTheDocument();
    expect(screen.getByText("MacBook Air")).toBeInTheDocument();
    expect(screen.getAllByText("Saving").length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();
    expect(screen.getByText("Funded from Savings buffer")).toBeInTheDocument();
  });

  it("prompts to fill a blank imported target", async () => {
    stubApi({ goals: approvalGoals() });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Goals" }));
    expect(await screen.findByText("iPhone")).toBeInTheDocument();
    expect(screen.getAllByText("Fill a target amount").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("link", { name: /iPhone/ }));
    expect(await screen.findByRole("heading", { name: "iPhone" })).toBeInTheDocument();
    expect(screen.getByText("Fill a target amount to see if this is affordable.")).toBeInTheDocument();
  });

  it("records a manual contribution and marks Achieved", async () => {
    stubApi({ goals: approvalGoals() });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Goals" }));
    await user.click(await screen.findByRole("link", { name: /German Exams/ }));
    expect(await screen.findByRole("heading", { name: "German Exams" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add contribution" }));
    const sheet = await screen.findByRole("dialog", { name: "Add contribution" });
    const amount = within(sheet).getByRole("textbox", { name: "Amount rupees" });
    await user.clear(amount);
    await user.type(amount, "8000");
    await user.type(within(sheet).getByRole("textbox", { name: "Note" }), "cash on hand");
    await user.click(within(sheet).getByRole("button", { name: "Save contribution" }));
    expect(await screen.findByText("Achieved")).toBeInTheDocument();
  });

  it("opens Quick Add as a transfer from Fund now", async () => {
    stubApi({ goals: approvalGoals() });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Goals" }));
    await user.click(await screen.findByRole("link", { name: /German Exams/ }));
    await user.click(await screen.findByRole("button", { name: "Fund now" }));
    const sheet = await screen.findByRole("dialog", { name: "Quick Add" });
    expect(await within(sheet).findByRole("radio", { name: "Transfer" })).toBeChecked();
    expect(within(sheet).getByText("This save also funds German Exams.")).toBeInTheDocument();
  });
});

describe("invest", () => {
  it("turning Gold off re-normalises % and SIP rupees", async () => {
    stubApi({ invest: defaultInvest(goldOnPlan()) });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Invest" }));
    expect(await screen.findByRole("heading", { name: "Invest" })).toBeInTheDocument();
    expect(screen.getAllByText("Gold").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("switch", { name: "Gold active" }));
    expect(await screen.findByText("sum = 100% ✓")).toBeInTheDocument();
    const goldSwitch = screen.getByRole("switch", { name: "Gold active" });
    expect(goldSwitch).toHaveAttribute("aria-checked", "false");
    const sipCard = screen.getByRole("heading", { name: "This month’s SIP" }).closest("article");
    expect(sipCard).toBeTruthy();
    expect(within(sipCard as HTMLElement).queryByText("Gold")).not.toBeInTheDocument();
  });

  it("₹10,000 leaves Automation SIP at ₹0; ₹25,000 turns themes on", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Invest" }));
    expect(await screen.findByRole("heading", { name: "This month’s SIP" })).toBeInTheDocument();
    const sipCard = screen.getByRole("heading", { name: "This month’s SIP" }).closest("article");
    expect(sipCard).toBeTruthy();
    expect(within(sipCard as HTMLElement).queryByText("Automation & Robotics")).not.toBeInTheDocument();

    const amount = screen.getByLabelText("SIP what-if rupees");
    await user.clear(amount);
    await user.type(amount, "25000");
    expect(await within(sipCard as HTMLElement).findByText("Automation & Robotics")).toBeInTheDocument();
  });

  it("deploys dip reserve and posts dip-buy", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Invest" }));
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    const sheet = await screen.findByRole("dialog", { name: "Deploy dip reserve" });
    await user.click(within(sheet).getByRole("button", { name: "Deploy" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Deployed/);
    const posts = fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]).includes("/api/invest/dip-buy") &&
        (call[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String((posts[0]?.[1] as RequestInit | undefined)?.body ?? "{}")) as {
      amount: number;
    };
    expect(body.amount).toBe(rupeesToPaise(3_450));
  });
});

describe("portfolio", () => {
  it("shows drift hint, holdings, and FD maturity from Wealth", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Wealth" }));
    await user.click(await screen.findByRole("link", { name: "Portfolio" }));
    expect(await screen.findByRole("heading", { name: "Portfolio" })).toBeInTheDocument();
    expect(screen.getAllByText("NASDAQ-100").length).toBeGreaterThan(0);
    expect(screen.getByText(/rebalance/)).toBeInTheDocument();
    expect(screen.getByText("matures in 86 days")).toBeInTheDocument();
  });
});

describe("privacy blur + PIN lock", () => {
  it("blurs Home amounts and the eye unhides them", async () => {
    stubApi({ blurDefault: true });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("button", { name: "Show amounts" })).toBeInTheDocument();
    expect(document.querySelectorAll(".privacy-blur").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Show amounts" }));
    expect(screen.getByRole("button", { name: "Hide amounts" })).toBeInTheDocument();
    expect(document.querySelectorAll(".privacy-blur").length).toBe(0);
  });

  it("blocks the app with the PIN overlay until unlock", async () => {
    stubApi({ pinSet: true });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Home" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "3" }));
    await user.click(screen.getByRole("button", { name: "4" }));
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByRole("tab", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
  });
});


