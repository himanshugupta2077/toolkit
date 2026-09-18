import type { AccountBalanceRow } from "../api/store.ts";
import {
  recurringIsEnded,
  resolveRecurringKind,
  type Category,
  type IsoDate,
  type Paise,
  type RecurringPlan,
} from "../engine/index.ts";

export type DebtCard = Pick<
  AccountBalanceRow,
  "id" | "name" | "balance" | "creditLimit" | "available" | "utilisation" | "dueDay"
>;

export type DebtLoan = Pick<AccountBalanceRow, "id" | "name" | "balance">;

export function creditCardRows(accounts: readonly AccountBalanceRow[]): DebtCard[] {
  return accounts
    .filter((row) => row.group === "credit_card" && !row.isArchived)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loanAccountRows(accounts: readonly AccountBalanceRow[]): DebtLoan[] {
  return accounts
    .filter((row) => row.group === "loan" && !row.isArchived)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loanEmiPlans(
  plans: readonly RecurringPlan[],
  categories: readonly Pick<Category, "id" | "name">[],
  today: IsoDate,
): RecurringPlan[] {
  const names = new Map(categories.map((row) => [row.id, row.name]));
  return plans
    .filter((plan) => {
      if (!plan.active) return false;
      if (recurringIsEnded(plan.endDate, today)) return false;
      if (plan.kind === "bill") return false;
      return resolveRecurringKind(plan.kind, names.get(plan.categoryId)) === "loan_emi";
    })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function creditDueTotal(cards: readonly Pick<DebtCard, "balance">[]): Paise {
  return cards.reduce((sum, row) => sum + row.balance, 0);
}

export function loanBalanceTotal(loans: readonly Pick<DebtLoan, "balance">[]): Paise {
  return loans.reduce((sum, row) => sum + row.balance, 0);
}

export function totalDebt(
  cards: readonly Pick<DebtCard, "balance">[],
  loans: readonly Pick<DebtLoan, "balance">[],
): Paise {
  return creditDueTotal(cards) + loanBalanceTotal(loans);
}

export function monthlyEmiTotal(plans: readonly Pick<RecurringPlan, "frequency" | "amount">[]): Paise {
  return plans
    .filter((row) => row.frequency === "monthly")
    .reduce((sum, row) => sum + row.amount, 0);
}
