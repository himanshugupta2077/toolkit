import { useCallback, useRef, useState, type TouchEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { LedgerType, Paise } from "../engine/index.ts";
import { BottomSheet } from "./BottomSheet.tsx";
import {
  GoalsIcon,
  HomeIcon,
  InvestIcon,
  MoreIcon,
  PlusIcon,
  WealthIcon,
} from "./icons.tsx";
import { InstallBanner } from "./InstallBanner.tsx";
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

const SWIPE_MIN_X = 72;
const SWIPE_MAX_Y = 48;

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
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
    if (quickAddOpen) return;
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
    if (!start || quickAddOpen) return;
    const t = event.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dy) > SWIPE_MAX_Y) return;
    if (Math.abs(dx) < Math.abs(dy) * 2) return;
    const next = adjacentTabPath(location.pathname, dx < 0 ? 1 : -1);
    if (next) navigate(next);
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
        <Outlet context={{ onToast, openQuickAdd } satisfies AppShellOutlet} />
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

      <BottomSheet
        open={quickAddOpen}
        title="Quick Add"
        tall
        onClose={closeQuickAdd}
      >
        <QuickAddSheet
          open={quickAddOpen}
          onClose={closeQuickAdd}
          onToast={onToast}
          prefill={quickAddPrefill}
        />
      </BottomSheet>
    </div>
  );
}
