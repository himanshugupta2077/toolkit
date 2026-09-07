import { Link } from "react-router-dom";

const LINKS = [
  { to: "/ledger", label: "Ledger" },
  { to: "/plan", label: "Plan" },
  { to: "/more/accounts", label: "Accounts" },
  { to: "/more/categories", label: "Categories" },
  { to: "/more/settings", label: "Settings" },
] as const;

export function MoreScreen() {
  return (
    <section className="px-5">
      <a href="/" className="text-sm text-muted">
        ← Toolkit
      </a>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">More</h1>
      <nav className="card mt-5 divide-y divide-line overflow-hidden">
        {LINKS.map((row) => (
          <Link
            key={row.to}
            to={row.to}
            className="flex min-h-14 items-center justify-between px-4 text-base text-ink transition-colors active:bg-card-2"
          >
            {row.label}
            <span className="text-muted" aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </nav>
    </section>
  );
}
