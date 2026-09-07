import type { FreeCashBooks } from "../src/engine/cash.ts";
import { todayIst, type IsoDate } from "../src/engine/dates.ts";
import type { Books } from "../src/engine/types.ts";
import type { AppDb } from "./db/client.ts";
import {
  getSettings,
  listAccounts,
  listBuckets,
  listCategories,
  listExpectedInflows,
  listLedgerEntries,
  listMonthBudgets,
  listOneTimePlans,
  listRecurringPlans,
} from "./repo/store.ts";

export function loadBooks(
  db: AppDb,
  today: IsoDate = todayIst(),
  since?: IsoDate,
): Books {
  return {
    today,
    accounts: listAccounts(db),
    categories: listCategories(db),
    entries: listLedgerEntries(db, since),
    monthBudgets: listMonthBudgets(db),
    settings: getSettings(db),
    recurringPlans: listRecurringPlans(db),
    oneTimePlans: listOneTimePlans(db),
    inflows: listExpectedInflows(db),
    buckets: listBuckets(db),
  };
}

export function toFreeCashBooks(books: Books, assumeInflows = false): FreeCashBooks {
  return {
    today: books.today,
    accounts: books.accounts,
    entries: books.entries,
    monthBudgets: books.monthBudgets,
    defaultBudgetCap: books.settings.defaultBudget,
    monthlySalary: books.settings.monthlySalary,
    recurringPlans: books.recurringPlans,
    categories: books.categories,
    oneTimePlans: books.oneTimePlans,
    inflows: books.inflows,
    assumeInflows,
  };
}
