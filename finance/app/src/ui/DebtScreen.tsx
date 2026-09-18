import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getAccounts, getPlan } from "../api/store.ts";
import { formatInr, todayIst } from "../engine/index.ts";
import { formatUtilisation } from "./accounts.ts";
import {
  creditCardRows,
  creditDueTotal,
  loanAccountRows,
  loanEmiPlans,
  monthlyEmiTotal,
  totalDebt,
} from "./debt.ts";
import { FetchError } from "./FetchError.tsx";
import { dueInLabel } from "./home.ts";
import { nextDueLabel } from "./plan.ts";
import { Amount } from "./Privacy.tsx";

export function DebtScreen() {
  const today = todayIst();
  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
    staleTime: 15_000,
  });
  const planQ = useQuery({
    queryKey: ["plan", "debt"],
    queryFn: () => getPlan(),
    staleTime: 15_000,
  });

  const cards = creditCardRows(accountsQ.data?.accounts ?? []);
  const loans = loanAccountRows(accountsQ.data?.accounts ?? []);
  const emis = loanEmiPlans(
    planQ.data?.recurring ?? [],
    planQ.data?.categories ?? [],
    planQ.data?.today ?? today,
  );
  const due = creditDueTotal(cards);
  const debt = totalDebt(cards, loans);
  const monthly = monthlyEmiTotal(emis);
  const pending = accountsQ.isPending || planQ.isPending;
  const error = accountsQ.error ?? planQ.error;

  return (
    <section className="page">
      <Link to="/more" className="back-link btn-ghost desk:hidden">
        ← More
      </Link>
      <h1 className="page-title mt-2">Debt</h1>
      <p className="mt-1 text-sm text-muted">Credit cards, loans, and EMIs in one place.</p>

      {pending ? (
        <p className="py-8 text-sm text-muted">Loading Debt…</p>
      ) : error ? (
        <FetchError
          error={error}
          onRetry={() => {
            void accountsQ.refetch();
            void planQ.refetch();
          }}
        />
      ) : (
        <div className="desk-stack mt-4">
          <article className="card p-4">
            <p className="kicker">Total debt</p>
            <p className="hero-num">
              <Amount>{formatInr(debt)}</Amount>
            </p>
            <p className="mt-2 text-sm text-muted">
              Cards <Amount>{formatInr(due)}</Amount>
              {loans.length > 0 ? (
                <>
                  {" · "}
                  Loans{" "}
                  <Amount>
                    {formatInr(debt - due)}
                  </Amount>
                </>
              ) : null}
            </p>
            {monthly > 0 ? (
              <p className="mt-1 text-sm text-muted">
                Monthly EMI <Amount>{formatInr(monthly)}</Amount>
              </p>
            ) : null}
          </article>

          <section>
            <h2 className="kicker">Credit cards</h2>
            {cards.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No credit cards.</p>
            ) : (
              <ul className="card mt-2 divide-y divide-line">
                {cards.map((card) => {
                  const dueLabel = dueInLabel(planQ.data?.today ?? today, card.dueDay);
                  const used = formatUtilisation(card.utilisation);
                  const bits = [
                    card.creditLimit != null ? `Limit ${formatInr(card.creditLimit)}` : null,
                    card.available != null ? `Available ${formatInr(card.available)}` : null,
                    used ? `${used} used` : null,
                    dueLabel,
                  ].filter(Boolean);
                  return (
                    <li key={card.id}>
                      <Link
                        to={`/more/accounts/${card.id}`}
                        className="flex min-h-11 items-center justify-between gap-3 px-4 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-base text-ink">{card.name}</span>
                          {bits.length > 0 ? (
                            <span className="block truncate text-[13px] text-muted">
                              <Amount>{bits.join(" · ")}</Amount>
                            </span>
                          ) : null}
                        </span>
                        <Amount className="shrink-0 text-base font-semibold tabular-nums text-ink">
                          {formatInr(card.balance)}
                        </Amount>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="kicker">Loans</h2>
            {loans.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No loan accounts.</p>
            ) : (
              <ul className="card mt-2 divide-y divide-line">
                {loans.map((loan) => (
                  <li key={loan.id}>
                    <Link
                      to={`/more/accounts/${loan.id}`}
                      className="flex min-h-11 items-center justify-between gap-3 px-4 py-2"
                    >
                      <span className="truncate text-base text-ink">{loan.name}</span>
                      <Amount className="shrink-0 text-base font-semibold tabular-nums text-ink">
                        {formatInr(loan.balance)}
                      </Amount>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between gap-2">
              <h2 className="kicker">EMI</h2>
              <Link to="/plan?tab=recurring" className="text-[13px] font-medium text-accent">
                Budget
              </Link>
            </div>
            {emis.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No EMI plans. Add them on Budget.</p>
            ) : (
              <ul className="card mt-2 divide-y divide-line">
                {emis.map((plan) => (
                  <li key={plan.id}>
                    <Link
                      to="/plan?tab=recurring"
                      className="flex min-h-11 items-center justify-between gap-3 px-4 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base text-ink">{plan.name}</span>
                        <span className="block truncate text-[13px] text-muted">
                          {nextDueLabel(plan, planQ.data?.today ?? today)}
                        </span>
                      </span>
                      <Amount className="shrink-0 text-base font-semibold tabular-nums text-ink">
                        {formatInr(plan.amount)}
                      </Amount>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
