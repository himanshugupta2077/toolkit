import type {
  AccountGroup,
  AccountType,
  InflowStatus,
  LedgerType,
  OneTimeStatus,
  PlanPriority,
  RecurringFrequency,
  RecurringKind,
  VirtualKind,
} from "../../src/engine/types.ts";

function compact(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function mapAccountType(value: string): AccountType | null {
  const n = compact(value);
  if (n === "asset") return "asset";
  if (n === "liability") return "liability";
  if (n === "virtual") return "virtual";
  return null;
}

export function mapAccountGroup(value: string): AccountGroup | null {
  const n = compact(value);
  if (n === "savings") return "savings";
  if (n === "cash") return "cash";
  if (n === "credit card") return "credit_card";
  if (n === "fd") return "fd";
  if (n === "investment") return "investment";
  if (n === "virtual") return "virtual";
  if (n === "loan") return "loan";
  if (n === "other") return "other";
  return null;
}

export function mapVirtualKind(name: string, type: AccountType): VirtualKind | null {
  if (type !== "virtual") return null;
  const n = compact(name);
  if (n === "employer") return "employer";
  if (n === "expense") return "expense";
  if (n === "external") return "external";
  return null;
}

export function mapLedgerType(value: string): LedgerType | null {
  const n = compact(value);
  if (n === "income") return "income";
  if (n === "expense") return "expense";
  if (n === "transfer") return "transfer";
  if (n === "credit card payment") return "cc_payment";
  if (n === "refund") return "refund";
  if (n === "investment") return "investment";
  if (n === "adjustment") return "adjustment";
  return null;
}

export function mapFrequency(value: string): RecurringFrequency | null {
  const n = compact(value);
  if (n === "monthly") return "monthly";
  if (n === "yearly") return "yearly";
  if (n === "weekly") return "weekly";
  if (n === "custom months" || n === "every n months") return "custom_months";
  return null;
}

export function mapKind(value: string): RecurringKind | null {
  const n = compact(value);
  if (!n) return null;
  if (n === "loan emi" || n === "loan" || n === "emi") return "loan_emi";
  if (n === "lifestyle") return "lifestyle";
  if (n === "investment") return "investment";
  if (n === "bill") return "bill";
  return null;
}

export function mapPriority(value: string): PlanPriority | null {
  const n = compact(value);
  if (n === "high") return "high";
  if (n === "medium") return "medium";
  if (n === "low") return "low";
  return null;
}

export function mapOneTimeStatus(value: string): OneTimeStatus | null {
  const n = compact(value);
  if (n === "planned") return "planned";
  if (n === "completed") return "completed";
  if (n === "cancelled") return "cancelled";
  return null;
}

export function mapInflowStatus(value: string): InflowStatus | null {
  const n = compact(value);
  if (n === "expected") return "expected";
  if (n === "received") return "received";
  if (n === "dropped") return "dropped";
  return null;
}

export function mapPayFromAlias(value: string): string | null {
  const n = compact(value);
  if (!n) return null;
  if (n === "hdfc cc" || n === "hdfc credit card") return "HDFC Credit Card";
  if (n === "icici cc" || n === "icici credit card") return "ICICI Credit Card";
  if (
    n === "saving acc" ||
    n === "savings" ||
    n === "hdfc savings" ||
    n === "saving account"
  ) {
    return "HDFC Savings";
  }
  if (n === "icici savings") return "ICICI Savings";
  if (n === "cash") return "Cash";
  if (n === "wallet") return "Wallet";
  if (n === "fd") return "FD";
  if (n === "mutual fund") return "Mutual Fund";
  return value.trim();
}

export function isEssentialCategory(name: string, group: string): boolean {
  const n = compact(name);
  if (n === "rent" || n === "emis" || n === "insurance") return true;
  const g = compact(group);
  return g === "food" || g === "home";
}
