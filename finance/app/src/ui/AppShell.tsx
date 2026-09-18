import { useCallback, useRef, useState, type TouchEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { LedgerType, Paise } from "../engine/index.ts";
import { BottomSheet } from "./BottomSheet.tsx";
import {
  AccountIcon,
  CategoryIcon,
  DebtIcon,
  EmergencyIcon,
  EyeIcon,
  EyeOffIcon,
  GearIcon,
  GoalsIcon,
  HomeIcon,
  InvestIcon,
  LedgerIcon,
  MoreIcon,
  PlanIcon,
  PlusIcon,
  WealthIcon,
} from "./icons.tsx";
import { InstallBanner } from "./InstallBanner.tsx";
import {
  DESKTOP_NAV_GROUPS,
  DESKTOP_SETUP,
  isDesktopNavActive,
  useDesktopLayout,
} from "./layout.ts";
import { usePrivacy } from "./Privacy.tsx";
import { QuickAddSheet } from "./QuickAddSheet.tsx";
import { adjacentTabPath, isTabActive, TABS } from "./tabs.ts";
import { Toast } from "./Toast.tsx";

export type QuickAddPrefill = {
  type?: LedgerType;
  amount?: Paise;
  notes?: string;
  goalId?: string;
  goalName?: string;
  fromAccountId?: string;
  toAccountId?: string;
};

export type AppShellOutlet = {
  onToast: (message: string) => void;
  openQuickAdd: (prefill?: QuickAddPrefill) => void;
};

const TAB_ICONS = {
  "/home": HomeIcon,
  "/wealth": WealthIcon,
  "/wealth/invest": InvestIcon,
  "/wealth/goals": GoalsIcon,
  "/more": MoreIcon,
} as const;

const DESKTOP_ICONS = {
  "/home": HomeIcon,
  "/ledger": LedgerIcon,
  "/plan": PlanIcon,
  "/emergency": EmergencyIcon,
  "/debt": DebtIcon,
  "/wealth": WealthIcon,
  "/wealth/invest": InvestIcon,
  "/wealth/goals": GoalsIcon,
  "/more/accounts": AccountIcon,
  "/more/categories": CategoryIcon,
  "/more/settings": GearIcon,
} as const;

const SWIPE_MIN_X = 72;
const SWIPE_MAX_Y = 48;

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const desktop = useDesktopLayout();
  const { blurred, toggle } = usePrivacy();
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddPrefill, setQuickAddPrefill] = useState<QuickAddPrefill | undefined>();
  const [toast, setToast] = useState<string | null>(null);
  const onToast = useCallback((message: string) => setToast(message), []);
  const openQuickAdd = useCallback((prefill?: QuickAddPrefill) => {
    setQuickAddPrefill(prefill);
    setQuickAddOpen(true);
  }, []);
  const closeQuickAdd = useCallback(() => {
    setQuickAddOpen(false);
    setQuickAddPrefill(undefined);
  }, []);

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    if (quickAddOpen || desktop) return;
    const t = event.changedTouches[0];
    if (!t) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("input, textarea, select, [role='dialog'], .overflow-x-auto")
    ) {
      swipe.current = null;
      return;
    }
    swipe.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || quickAddOpen || desktop) return;
    const t = event.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dy) > SWIPE_MAX_Y) return;
    if (Math.abs(dx) < Math.abs(dy) * 2) return;
    const next = adjacentTabPath(location.pathname, dx < 0 ? 1 : -1);
    if (next) navigate(next);
  }

  const outlet = <Outlet context={{ onToast, openQuickAdd } satisfies AppShellOutlet} />;
  const sheet = (
    <BottomSheet
      open={quickAddOpen}
      title="Quick Add"
      onClose={closeQuickAdd}
    >
      <QuickAddSheet
        open={quickAddOpen}
        onClose={closeQuickAdd}
        onToast={onToast}
        prefill={quickAddPrefill}
      />
    </BottomSheet>
  );

  if (desktop) {
    return (
      <div className="relative flex h-full w-full overflow-hidden bg-page">
        <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-card">
          <div className="px-5 pt-7 pb-5">
            <p className="text-lg font-semibold tracking-tight text-ink">Finance</p>
            <p className="mt-0.5 text-[12px] text-muted">Personal workspace</p>
          </div>
          <nav
            aria-label="Primary"
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
          >
            {DESKTOP_NAV_GROUPS.map((group) => (
              <div key={group.label ?? "home"} className={group.label ? "mt-5" : ""}>
                {group.label ? (
                  <p className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">
                    {group.label}
                  </p>
                ) : null}
                {group.items.map((item) => {
                  const Icon = DESKTOP_ICONS[item.to];
                  const active = isDesktopNavActive(location.pathname, item.to);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      className={`mt-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                        active
                          ? "bg-accent-soft font-semibold text-accent"
                          : "font-medium text-ink hover:bg-card-2"
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            ))}
            <p className="mt-6 mb-1 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">
              Setup
            </p>
            {DESKTOP_SETUP.map((item) => {
              const Icon = DESKTOP_ICONS[item.to];
              const active = isDesktopNavActive(location.pathname, item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={`mt-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-accent-soft font-semibold text-accent"
                      : "font-medium text-ink hover:bg-card-2"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="border-t border-line p-3">
            <button
              type="button"
              aria-label="Quick Add"
              onClick={() => openQuickAdd()}
              className="btn-primary w-full gap-2"
            >
              <PlusIcon className="h-5 w-5" />
              Add
            </button>
            <div className="mt-2 flex items-center justify-between gap-2">
              <a href="/" className="btn-quiet px-2 text-sm">
                Toolkit
              </a>
              <button
                type="button"
                onClick={toggle}
                className="icon-btn"
                aria-pressed={blurred}
                aria-label={blurred ? "Show amounts" : "Hide amounts"}
              >
                {blurred ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col bg-app">
          <main className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
            {outlet}
          </main>
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
        {sheet}
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[480px] flex-col overflow-hidden overscroll-none bg-app shadow-[0_0_0_1px_var(--line)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="shrink-0 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-1">
        <p className="text-[13px] font-medium text-muted">Finance OS</p>
      </header>

      <main
        className="min-h-0 flex-1 overflow-y-auto overscroll-none pb-28"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <InstallBanner />
        {outlet}
      </main>

      <button
        type="button"
        aria-label="Quick Add"
        onClick={() => openQuickAdd()}
        className="absolute right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg shadow-accent/30 transition-transform active:scale-95"
      >
        <PlusIcon className="h-7 w-7" />
      </button>

      <nav
        role="tablist"
        aria-label="Primary"
        className="relative z-20 grid shrink-0 grid-cols-5 border-t border-line bg-app pb-[max(0.4rem,env(safe-area-inset-bottom))]"
      >
        {TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.to];
          const active = isTabActive(location.pathname, tab.to);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              role="tab"
              aria-selected={active}
              className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 pt-1 text-[13px] transition-colors ${
                active ? "font-semibold text-accent" : "font-medium text-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0 h-0.5 w-6 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
              />
              <Icon className="h-5 w-5" />
              {tab.label}
            </NavLink>
          );
        })}
      </nav>

      <Toast message={toast} onDismiss={() => setToast(null)} />
      {sheet}
    </div>
  );
}
