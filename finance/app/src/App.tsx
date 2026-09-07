import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { EnginePage } from "./dev/EnginePage.tsx";
import { StorePage } from "./dev/StorePage.tsx";
import { AccountDetailScreen } from "./ui/AccountDetailScreen.tsx";
import { AccountsScreen } from "./ui/AccountsScreen.tsx";
import { AppShell } from "./ui/AppShell.tsx";
import { AllocateScreen } from "./ui/AllocateScreen.tsx";
import { BucketEditorScreen } from "./ui/BucketEditorScreen.tsx";
import { GoalDetailScreen } from "./ui/GoalDetailScreen.tsx";
import { GoalsScreen } from "./ui/GoalsScreen.tsx";
import { HoldingDetailScreen } from "./ui/HoldingDetailScreen.tsx";
import { InvestScreen } from "./ui/InvestScreen.tsx";
import { PortfolioScreen } from "./ui/PortfolioScreen.tsx";
import { CategoriesScreen } from "./ui/CategoriesScreen.tsx";
import { LedgerDetailScreen } from "./ui/LedgerDetailScreen.tsx";
import { LockGate } from "./ui/LockGate.tsx";
import { PrivacyProvider } from "./ui/Privacy.tsx";
import { ReconcileScreen } from "./ui/ReconcileScreen.tsx";
import { SettingsScreen } from "./ui/SettingsScreen.tsx";
import { WealthScreen } from "./ui/WealthScreen.tsx";
import {
  HomeScreen,
  LedgerScreen,
  MoreScreen,
  PlanScreen,
} from "./ui/screens.tsx";
import { appBasename } from "./basePath.ts";

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={appBasename() || undefined}>
        <Routes>
          <Route path="/dev/store" element={<StorePage />} />
          <Route path="/dev/engine" element={<EnginePage />} />
          <Route
            element={
              <PrivacyProvider>
                <LockGate>
                  <AppShell />
                </LockGate>
              </PrivacyProvider>
            }
          >
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomeScreen />} />
            <Route path="/ledger" element={<LedgerScreen />} />
            <Route path="/ledger/:entryId" element={<LedgerDetailScreen />} />
            <Route path="/plan" element={<PlanScreen />} />
            <Route path="/wealth" element={<WealthScreen />} />
            <Route path="/wealth/allocate" element={<AllocateScreen />} />
            <Route path="/wealth/buckets" element={<BucketEditorScreen />} />
            <Route path="/wealth/goals" element={<GoalsScreen />} />
            <Route path="/wealth/goals/:goalId" element={<GoalDetailScreen />} />
            <Route path="/wealth/invest" element={<InvestScreen />} />
            <Route path="/wealth/portfolio" element={<PortfolioScreen />} />
            <Route path="/wealth/portfolio/:holdingId" element={<HoldingDetailScreen />} />
            <Route path="/more" element={<MoreScreen />} />
            <Route path="/more/accounts" element={<AccountsScreen />} />
            <Route path="/more/accounts/:accountId" element={<AccountDetailScreen />} />
            <Route
              path="/more/accounts/:accountId/reconcile"
              element={<ReconcileScreen />}
            />
            <Route path="/more/categories" element={<CategoriesScreen />} />
            <Route path="/more/settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
