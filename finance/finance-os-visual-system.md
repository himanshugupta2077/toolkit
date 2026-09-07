# Finance OS — visual system + patches

Scope: colour, type, spacing, surfaces, buttons, chips, sheets, states. No routes, queries, bodies, labels, or helper logic touched. Every diff is against `04_SOURCE.txt`; hunks are given by context (no line numbers) so they apply after any unrelated drift.

---

## 1. Visual system

### The three fixes

1. **Neutrals were the problem, not the green.** `#e4dfd2 / #f4f1e8 / #fffcf5` are 3 % apart; nothing lifts. The new neutrals are cool, near-achromatic, and spaced: app column is a light grey, cards are white, insets (keypad keys, avatars) are a deeper grey. Cards now read as objects without a heavy border.
2. **One green.** Forest green is the **action** colour only: primary button, FAB, links, switch-on, active tab. Positive **status** (money in, pace on-track, goal achieved) is a calm blue, so an inflow amount can never be mistaken for a link and a link can never look like "good news". Amber is watch; red is danger. Red appears only when something needs attention — outflows are plain ink (a ledger that is 90 % red conveys nothing).
3. **Selection ≠ action.** Selected chips and picked rows are inverted-neutral (ink fill, app text). Green fill now means exactly one thing: "this does something".

### Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--page` | `#e2e5e1` | `#0a0b0a` | Body around the 480 px column |
| `--app` | `#f3f4f1` | `#131513` | Column, tab bar, sticky bars |
| `--card` | `#ffffff` | `#1c1f1c` | Cards, list groups, form fields, lock keys |
| `--card-2` | `#e9ece8` | `#262a26` | Insets: keypad keys, avatar discs, bar tracks, pressed state |
| `--sheet` | `#ffffff` | `#202420` | Bottom-sheet panel |
| `--ink` | `#171a18` | `#eef0ec` | Primary text, selected chip fill, toast |
| `--muted` | `#5b6360` | `#a4aba6` | Labels, meta, idle tabs (≥ 5.5:1 on both surfaces) |
| `--line` | `#d3d8d3` | `#2f342f` | Hairlines, dividers, card edge |
| `--line-strong` | `#aeb5af` | `#4a524c` | Field borders, secondary-button edge, sheet grabber |
| `--accent` | `#1b5a40` | `#7fcaa0` | **Actions**: primary fill, FAB, links, switch-on, tab indicator, sparkline |
| `--accent-fg` | `#ffffff` | `#0c1c14` | Text on accent |
| `--accent-soft` | `#e1efe7` | `#17302a` | Picked row background, count badge tint, goal-funding note |
| `--ok` | `#2358a6` | `#85b4ff` | Money in, pace on-track, goal achieved/affordable |
| `--ok-soft` | `#e3ebf8` | `#172740` | Pill background for ok |
| `--warn` | `#8a5200` | `#f2b35a` | Pace watch, stale reconcile, hints, goal behind |
| `--warn-soft` | `#fbeed6` | `#3a2a10` | Pill background for warn |
| `--danger` | `#b3261e` | `#ff8b80` | Negative free cash, over pace, errors, delete text |
| `--danger-fg` | `#ffffff` | `#2a0b09` | Text on danger fill |
| `--danger-soft` | `#fbe7e5` | `#3d1a18` | Danger card background |
| `--overlay` | `rgba(20,24,20,.45)` | `rgba(0,0,0,.6)` | Sheet scrim |
| `--seg-emi` | `#4d5651` | `#c3c9c4` | Forecast Loan/EMI segment (data, not type) |
| `--seg-life` | `#a7afa9` | `#6b736d` | Forecast Lifestyle segment |

Investment segment stays `--accent` (money going toward the brand promise). Track stays `--card-2`.

### Hierarchy

Each card has **one** hero number: `2rem/1 semibold tabular-nums ink`, a sentence-case 13 px muted label above it, and at most one 14 px muted line below. The uppercase-tracked 12 px kicker is retired everywhere (85 instances → one class); small caps at 12 px is the hardest thing to read on a phone. Screen titles are unified at `text-2xl` (Home month, Plan, Wealth, More, Lock). Lists live directly on the app background with hairline dividers — only heroes, grouped controls, and "the thing you tap into" get a card. Primary = green fill, Secondary = outlined ink, Ghost = coloured text, Destructive = red fill, Chip-on = ink fill. All interactive elements share `active:` and `disabled:` treatment via the component classes below.

---

## 2. File patches

### app/src/index.css — full replacement

```css
@import "tailwindcss";

@theme {
  --font-sans: "Segoe UI", ui-sans-serif, system-ui, sans-serif;

  --color-page: var(--page);
  --color-app: var(--app);
  --color-card: var(--card);
  --color-card-2: var(--card-2);
  --color-sheet: var(--sheet);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --color-accent-soft: var(--accent-soft);
  --color-ok: var(--ok);
  --color-ok-soft: var(--ok-soft);
  --color-warn: var(--warn);
  --color-warn-soft: var(--warn-soft);
  --color-danger: var(--danger);
  --color-danger-fg: var(--danger-fg);
  --color-danger-soft: var(--danger-soft);
  --color-overlay: var(--overlay);
  --color-seg-emi: var(--seg-emi);
  --color-seg-life: var(--seg-life);
}

:root {
  color-scheme: light dark;
  --page: #e2e5e1;
  --app: #f3f4f1;
  --card: #ffffff;
  --card-2: #e9ece8;
  --sheet: #ffffff;
  --ink: #171a18;
  --muted: #5b6360;
  --line: #d3d8d3;
  --line-strong: #aeb5af;
  --accent: #1b5a40;
  --accent-fg: #ffffff;
  --accent-soft: #e1efe7;
  --ok: #2358a6;
  --ok-soft: #e3ebf8;
  --warn: #8a5200;
  --warn-soft: #fbeed6;
  --danger: #b3261e;
  --danger-fg: #ffffff;
  --danger-soft: #fbe7e5;
  --overlay: rgba(20, 24, 20, 0.45);
  --seg-emi: #4d5651;
  --seg-life: #a7afa9;
}

@media (prefers-color-scheme: dark) {
  :root {
    --page: #0a0b0a;
    --app: #131513;
    --card: #1c1f1c;
    --card-2: #262a26;
    --sheet: #202420;
    --ink: #eef0ec;
    --muted: #a4aba6;
    --line: #2f342f;
    --line-strong: #4a524c;
    --accent: #7fcaa0;
    --accent-fg: #0c1c14;
    --accent-soft: #17302a;
    --ok: #85b4ff;
    --ok-soft: #172740;
    --warn: #f2b35a;
    --warn-soft: #3a2a10;
    --danger: #ff8b80;
    --danger-fg: #2a0b09;
    --danger-soft: #3d1a18;
    --overlay: rgba(0, 0, 0, 0.6);
    --seg-emi: #c3c9c4;
    --seg-life: #6b736d;
  }
}

html,
body,
#root {
  min-height: 100dvh;
}

body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.45;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

button,
a {
  -webkit-tap-highlight-color: transparent;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.privacy-blur {
  filter: blur(9px);
  user-select: none;
}

/* Shared components. One definition each; screens compose these instead of
   repeating class strings. Add extra Tailwind classes after the component
   class (e.g. `card p-4`, `btn-primary w-full`). */
@layer components {
  .card {
    @apply rounded-2xl border border-line bg-card;
  }
  .card-danger {
    @apply rounded-2xl border border-danger/40 bg-danger-soft;
  }
  .kicker {
    @apply text-[13px] font-medium text-muted;
  }
  .hero-num {
    @apply text-[2rem] leading-none font-semibold tracking-tight tabular-nums text-ink;
  }
  .field {
    @apply min-h-11 w-full rounded-xl border border-line-strong bg-card px-3 text-base text-ink placeholder:text-muted;
  }
  .btn-primary {
    @apply inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 text-base font-medium text-accent-fg transition-[opacity,transform] active:scale-[0.98] active:opacity-90 disabled:pointer-events-none disabled:opacity-40;
  }
  .btn-secondary {
    @apply inline-flex min-h-11 items-center justify-center rounded-xl border border-line-strong bg-card px-4 text-base font-medium text-ink transition-[opacity,transform] active:scale-[0.98] active:bg-card-2 disabled:pointer-events-none disabled:opacity-40;
  }
  .btn-ghost {
    @apply inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-accent transition-opacity active:opacity-70 disabled:pointer-events-none disabled:opacity-40;
  }
  .btn-quiet {
    @apply inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-muted transition-opacity active:opacity-70 disabled:pointer-events-none disabled:opacity-40;
  }
  .btn-danger {
    @apply inline-flex min-h-11 items-center justify-center rounded-xl bg-danger px-4 text-base font-medium text-danger-fg transition-[opacity,transform] active:scale-[0.98] active:opacity-90 disabled:pointer-events-none disabled:opacity-40;
  }
  .icon-btn {
    @apply inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink transition-colors active:bg-card-2 disabled:opacity-40;
  }
  .chip {
    @apply inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-medium transition-opacity active:opacity-80;
  }
  .chip-on {
    @apply bg-ink text-app;
  }
  .chip-off {
    @apply border border-line-strong bg-card text-ink;
  }
  .avatar {
    @apply flex size-9 shrink-0 items-center justify-center rounded-full bg-card-2 text-sm font-medium text-ink;
  }
}
```

### app/index.html

```diff
--- a/app/index.html
+++ b/app/index.html
@@
     <meta
       name="theme-color"
       media="(prefers-color-scheme: light)"
-      content="#f4f1e8"
+      content="#f3f4f1"
     />
     <meta
       name="theme-color"
       media="(prefers-color-scheme: dark)"
-      content="#12140f"
+      content="#131513"
     />
```

### app/public/manifest.webmanifest

```diff
--- a/app/public/manifest.webmanifest
+++ b/app/public/manifest.webmanifest
@@
-  "background_color": "#f4f1e8",
-  "theme_color": "#215c45",
+  "background_color": "#f3f4f1",
+  "theme_color": "#1b5a40",
```

---

### app/src/ui/AppShell.tsx

Tab bar: active tab gets weight **and** a 2 px indicator (new `span`, 1 line). Header line shrinks. FAB gets a tinted shadow so it sits above content instead of a grey blob.

```diff
--- a/app/src/ui/AppShell.tsx
+++ b/app/src/ui/AppShell.tsx
@@
-    <div className="relative mx-auto flex h-dvh w-full max-w-[480px] flex-col overflow-hidden bg-app shadow-[0_0_0_1px_var(--line)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
-      <header className="px-5 pt-[max(0.85rem,env(safe-area-inset-top))] pb-2">
-        <p className="text-sm font-medium text-muted">Finance OS</p>
+    <div className="relative mx-auto flex h-dvh w-full max-w-[480px] flex-col overflow-hidden bg-app shadow-[0_0_0_1px_var(--line)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
+      <header className="px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-1">
+        <p className="text-[13px] font-medium text-muted">Finance OS</p>
       </header>
@@
-        className="absolute right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg"
+        className="absolute right-[max(1rem,env(safe-area-inset-right))] bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg shadow-accent/30 transition-transform active:scale-95"
       >
@@
-        className="sticky bottom-0 z-20 grid grid-cols-5 border-t border-line bg-app pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1"
+        className="sticky bottom-0 z-20 grid grid-cols-5 border-t border-line bg-app pb-[max(0.4rem,env(safe-area-inset-bottom))]"
       >
@@
-              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 text-sm ${
-                active ? "text-accent" : "text-muted"
-              }`}
+              className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 pt-1 text-[13px] transition-colors ${
+                active ? "font-semibold text-accent" : "font-medium text-muted"
+              }`}
             >
+              <span
+                aria-hidden="true"
+                className={`absolute top-0 h-0.5 w-6 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
+              />
               <Icon className="h-5 w-5" />
               {tab.label}
```

### app/src/ui/BottomSheet.tsx — full replacement

```tsx
import { useEffect, type ReactNode } from "react";

type BottomSheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Nearly full-height sheet so a keypad can sit at the bottom. */
  tall?: boolean;
};

export function BottomSheet({
  open,
  title,
  onClose,
  children,
  tall = false,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const titleId = "bottom-sheet-title";

  return (
    <div className="absolute inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-overlay"
        aria-label="Dismiss"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`absolute inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[1.75rem] border-t border-line bg-sheet shadow-[0_-12px_40px_rgba(0,0,0,0.25)] ${
          tall ? "h-[min(92dvh,760px)]" : "max-h-[min(92dvh,760px)]"
        }`}
      >
        <div className="shrink-0 px-5 pt-2.5">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" />
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="btn-quiet -mr-3">
              Close
            </button>
          </div>
        </div>
        <div
          className={`min-h-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] ${
            tall ? "flex flex-1 flex-col overflow-hidden" : "overflow-y-auto"
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
```

### app/src/ui/Toast.tsx — full replacement

```tsx
import { useEffect } from "react";

type ToastProps = {
  message: string | null;
  onDismiss: () => void;
};

export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDismiss, 3500);
    return () => window.clearTimeout(id);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      className="absolute left-4 right-4 top-[max(0.75rem,env(safe-area-inset-top))] z-50 rounded-2xl bg-ink px-4 py-3 text-sm font-medium tabular-nums text-app shadow-lg"
    >
      {message}
    </div>
  );
}
```

### app/src/ui/Keypad.tsx — full replacement

```tsx
import type { AmountKey } from "./quickAdd.ts";

const ROWS: AmountKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
];

function labelFor(key: AmountKey): string {
  if (key === "back") return "Backspace";
  if (key === ".") return "Decimal point";
  if (key === "+") return "Add";
  return key;
}

type KeypadProps = {
  onKey: (key: AmountKey) => void;
};

export function Keypad({ onKey }: KeypadProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ROWS.flat().map((key) => (
        <button
          type="button"
          key={key}
          aria-label={labelFor(key)}
          onClick={() => onKey(key)}
          className="min-h-12 rounded-2xl bg-card-2 text-2xl font-medium tabular-nums text-ink transition-colors active:bg-line"
        >
          {key === "back" ? "⌫" : key}
        </button>
      ))}
      <button
        type="button"
        aria-label="Add"
        onClick={() => onKey("+")}
        className="col-span-3 min-h-11 rounded-2xl border border-line-strong bg-card text-lg font-medium text-ink transition-colors active:bg-card-2"
      >
        +
      </button>
    </div>
  );
}
```

### app/src/ui/FetchError.tsx — full replacement

```tsx
import { laptopErrorText } from "./copy.ts";

export function FetchError({
  error,
  onRetry,
  compact = false,
}: {
  error: unknown;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "pb-4" : "py-8"}>
      <p className="text-sm text-danger">{laptopErrorText(error)}</p>
      <button type="button" className="btn-primary mt-3 rounded-full text-sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
```

### app/src/ui/InstallBanner.tsx

```diff
--- a/app/src/ui/InstallBanner.tsx
+++ b/app/src/ui/InstallBanner.tsx
@@
-    <div className="mx-5 mb-3 rounded-2xl border border-line bg-sheet p-4">
+    <div className="card mx-5 mb-3 p-4">
       <p className="text-sm font-medium text-ink">Add to Home Screen</p>
@@
           <button
             type="button"
-            className="min-h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg"
+            className="btn-primary rounded-full text-sm"
             onClick={() => void install()}
           >
             Install
           </button>
         ) : null}
         <button
           type="button"
-          className="min-h-11 rounded-full px-4 text-sm font-medium text-muted"
+          className="btn-quiet"
           onClick={dismiss}
         >
```

### app/src/ui/LockScreen.tsx

```diff
--- a/app/src/ui/LockScreen.tsx
+++ b/app/src/ui/LockScreen.tsx
@@
-      <p className="text-sm font-medium tracking-wide text-muted uppercase">Locked</p>
-      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">Finance OS</h1>
+      <p className="kicker">Locked</p>
+      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Finance OS</h1>
       <p className="mt-2 text-sm text-muted">Enter your PIN. Numbers stay on the laptop.</p>
 
-      <p className="mt-8 text-center text-3xl tracking-[0.4em] text-ink" aria-hidden="true">
+      <p className="mt-10 text-center text-3xl leading-none tracking-[0.4em] text-ink" aria-hidden="true">
         {"•".repeat(pin.length) || " "}
       </p>
 
-      {error ? <p className="mt-3 text-center text-sm text-red-700 dark:text-red-400">{error}</p> : null}
+      {error ? <p className="mt-3 text-center text-sm text-danger">{error}</p> : null}
@@
-          className="mt-4 min-h-11 rounded-xl border border-line text-sm font-medium text-accent"
+          className="btn-secondary mt-4 text-sm"
           onClick={() => void onBio()}
@@
-            className="min-h-14 rounded-xl bg-sheet text-xl font-medium text-ink"
+            className="min-h-14 rounded-2xl border border-line bg-card text-2xl font-medium tabular-nums text-ink transition-colors active:bg-card-2 disabled:opacity-40"
             aria-label={key === "back" ? "Backspace" : key}
@@
-          className="min-h-14 rounded-xl bg-accent text-base font-medium text-accent-fg disabled:opacity-40"
+          className="btn-primary min-h-14 rounded-2xl"
           disabled={busy || !isPinDigits(pin)}
```

---

### Class helpers

### app/src/ui/ledger.ts

Inflows blue, outflows ink, transfers muted. (If the owner wants outflows red after seeing it, change the `"out"` line to `"text-danger"` — one string.)

```diff
--- a/app/src/ui/ledger.ts
+++ b/app/src/ui/ledger.ts
@@
 export function amountClass(kind: FlowKind): string {
-  if (kind === "in") return "text-emerald-700 dark:text-emerald-400";
-  if (kind === "out") return "text-red-700 dark:text-red-400";
+  if (kind === "in") return "text-ok";
+  if (kind === "out") return "text-ink";
   return "text-muted";
 }
```

### app/src/ui/plan.ts

```diff
--- a/app/src/ui/plan.ts
+++ b/app/src/ui/plan.ts
@@
 export function chipClass(on: boolean): string {
-  return `shrink-0 min-h-11 rounded-full px-3 text-sm font-medium ${
-    on ? "bg-accent text-accent-fg" : "border border-line text-ink"
-  }`;
+  return `chip ${on ? "chip-on" : "chip-off"}`;
 }
 
 export function paceDotClass(band: PaceBand): string {
-  if (band === "on_track") return "bg-emerald-600 dark:bg-emerald-500";
-  if (band === "watch") return "bg-amber-500";
-  return "bg-red-600 dark:bg-red-500";
+  if (band === "on_track") return "bg-ok";
+  if (band === "watch") return "bg-warn";
+  return "bg-danger";
 }
```

### app/src/ui/goals.ts

```diff
--- a/app/src/ui/goals.ts
+++ b/app/src/ui/goals.ts
@@
 export function pillClass(pill: GoalPill): string {
   switch (pill) {
     case "affordable_now":
-      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
+      return "bg-ok-soft text-ok";
     case "on_track":
-      return "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300";
+      return "border border-line-strong text-ink";
     case "behind":
-      return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300";
+      return "bg-warn-soft text-warn";
     case "achieved":
-      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
+      return "bg-ok-soft text-ok";
     case "saving":
-      return "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
+      return "bg-card-2 text-muted";
   }
 }
```

### Duplicated local `chipClass` — LedgerScreen.tsx, QuickAddSheet.tsx, LedgerEditSheet.tsx, AccountFormSheet.tsx, CategoryFormSheet.tsx

Same body change in all five files (or delete the local function and `import { chipClass } from "./plan.ts"` — either is fine; the import is one line and removes drift):

```diff
 function chipClass(on: boolean): string {
-  return `shrink-0 min-h-11 rounded-full px-3 text-sm font-medium ${
-    on ? "bg-accent text-accent-fg" : "border border-line text-ink"
-  }`;
+  return `chip ${on ? "chip-on" : "chip-off"}`;
 }
```

---

### Screens

### app/src/ui/HomeScreen.tsx

Pace card gets a status dot next to the band word; one hero per card; the six tiles become one grouped card; forecast segments stop using type tokens.

```diff
--- a/app/src/ui/HomeScreen.tsx
+++ b/app/src/ui/HomeScreen.tsx
@@
 import { formatUtilisation } from "./accounts.ts";
 import { FetchError } from "./FetchError.tsx";
 import { EyeIcon, EyeOffIcon } from "./icons.tsx";
+import { paceDotClass } from "./plan.ts";
@@
 function bandFill(band: PaceBand): string {
-  if (band === "on_track") return "bg-emerald-600 dark:bg-emerald-500";
-  if (band === "watch") return "bg-amber-500";
-  return "bg-red-600 dark:bg-red-500";
+  if (band === "on_track") return "bg-ok";
+  if (band === "watch") return "bg-warn";
+  return "bg-danger";
 }
@@
     <div
-      className="relative mt-3 h-1.5 w-full rounded-full bg-line"
+      className="relative mt-3 h-2 w-full rounded-full bg-card-2"
       role="img"
@@
       <div
-        className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-ink"
+        className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-ink"
         style={{ left: `${elapsed}%` }}
@@ CcRow
-      <Amount className="shrink-0 text-base font-medium tabular-nums text-ink">
+      <Amount className="shrink-0 text-base font-semibold tabular-nums text-ink">
         {formatInr(card.due)}
       </Amount>
@@ ForecastStrip
     <Link
       to="/plan?tab=forecast"
-      className="mt-3 block rounded-2xl border border-line bg-sheet p-4"
+      className="card mt-3 block p-4 active:bg-card-2"
     >
       <div className="flex items-center justify-between gap-2">
-        <h2 className="text-sm font-medium text-ink">Next 6 months</h2>
-        <span className="text-xs text-muted">Plan · Forecast</span>
+        <h2 className="text-sm font-semibold text-ink">Next 6 months</h2>
+        <span className="text-[13px] font-medium text-accent">Forecast</span>
       </div>
       <div className="mt-3 flex items-end justify-between gap-1">
         {bars.map((bar) => (
           <div key={bar.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
-            <div className="flex h-16 w-7 flex-col justify-end overflow-hidden rounded-sm bg-line">
+            <div className="flex h-16 w-7 flex-col justify-end overflow-hidden rounded-md bg-card-2">
@@
                   <div
-                    className="w-full bg-muted"
+                    className="w-full bg-seg-life"
                     style={{ height: `${Math.round(bar.shares.lifestyle * 100)}%` }}
@@
                   <div
-                    className="w-full bg-ink"
+                    className="w-full bg-seg-emi"
                     style={{ height: `${Math.round(bar.shares.loanEmi * 100)}%` }}
@@
-            <span className="text-[10px] text-muted">{formatMonthShort(bar.month as YearMonth)}</span>
+            <span className="text-[11px] text-muted">{formatMonthShort(bar.month as YearMonth)}</span>
           </div>
         ))}
       </div>
-      <p className="mt-2 text-[11px] text-muted">
-        <span className="mr-2 inline-block size-2 rounded-sm bg-ink align-middle" />
+      <p className="mt-2 text-[12px] text-muted">
+        <span className="mr-2 inline-block size-2 rounded-sm bg-seg-emi align-middle" />
         Loan/EMI
-        <span className="mx-2 inline-block size-2 rounded-sm bg-muted align-middle" />
+        <span className="mx-2 inline-block size-2 rounded-sm bg-seg-life align-middle" />
         Lifestyle
         <span className="mx-2 inline-block size-2 rounded-sm bg-accent align-middle" />
         Investment
@@ header eye button
-          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink"
+          className="icon-btn"
           aria-pressed={blurred}
@@ pace hero
           <button
             type="button"
             onClick={() => setPaceOpen(true)}
-            className="mt-4 w-full rounded-2xl border border-line bg-sheet p-4 text-left"
+            className="card mt-4 w-full p-4 text-left active:bg-card-2"
           >
-            <p className="text-xs font-medium tracking-wide text-muted uppercase">
-              Pace · {PACE_BAND_LABELS[data.pace.band]}
+            <p className="kicker flex items-center gap-2">
+              <span aria-hidden="true" className={`size-2 rounded-full ${paceDotClass(data.pace.band)}`} />
+              Pace · {PACE_BAND_LABELS[data.pace.band]}
             </p>
-            <p className="mt-1 text-xl font-semibold tracking-tight text-ink">
+            <p className="mt-1.5 text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums text-ink">
               <Amount>{paceHeadline(data.pace)}</Amount>
             </p>
-            <p className="mt-1 text-sm text-muted">
+            <p className="mt-2 text-sm text-muted">
               Budget remaining <Amount>{formatInr(data.pace.remaining)}</Amount> of{" "}
@@ action cards
-                const className = `block w-full rounded-2xl border p-4 text-left ${
+                const className = `block w-full p-4 text-left ${
                   card.kind === "negative_free"
-                    ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
-                    : "border-line bg-sheet"
+                    ? "card-danger"
+                    : "card active:bg-card-2"
                 }`;
                 const inner = (
                   <>
-                    <p className="text-base font-medium text-ink">{card.title}</p>
+                    <p className={`text-base font-medium ${card.kind === "negative_free" ? "text-danger" : "text-ink"}`}>{card.title}</p>
                     <p className="mt-0.5 text-sm text-muted">{card.body}</p>
@@
-                        <button type="button" disabled className={`${className} opacity-60`}>
+                        <button type="button" disabled className={`${className} opacity-40`}>
@@ credit cards
-            <section className="mt-3 rounded-2xl border border-line bg-sheet p-4">
+            <section className="card mt-3 p-4">
               <div className="flex items-center justify-between gap-2">
-                <h2 className="text-sm font-medium text-ink">Credit cards</h2>
+                <h2 className="text-sm font-semibold text-ink">Credit cards</h2>
                 <p className="text-sm tabular-nums text-muted">
@@ free to allocate
-          <section className="mt-3 rounded-2xl border border-line bg-sheet p-4">
-            <p className="text-xs font-medium tracking-wide text-muted uppercase">
-              Free to allocate
-            </p>
+          <section className="card mt-3 p-4">
+            <p className="kicker">Free to allocate</p>
             <p
-              className={`mt-1 text-3xl font-semibold tracking-tight tabular-nums ${
-                data.free.free < 0 ? "text-red-700 dark:text-red-400" : "text-ink"
+              className={`hero-num mt-1.5 ${
+                data.free.free < 0 ? "text-danger" : ""
               }`}
             >
               <Amount>{formatInr(data.free.free)}</Amount>
             </p>
             {data.free.free < 0 ? (
-              <p className="mt-1 text-sm text-red-700 dark:text-red-400">
+              <p className="mt-1.5 text-sm font-medium text-danger">
                 Committed beyond liquid
               </p>
             ) : null}
             <button
               type="button"
-              className="mt-2 min-h-11 text-sm font-medium text-accent"
+              className="btn-ghost -ml-3 mt-1"
               aria-expanded={freeOpen}
@@
-                <li className="flex justify-between gap-3 pt-1 font-medium tabular-nums">
+                <li className="flex justify-between gap-3 border-t border-line pt-2 font-semibold tabular-nums text-ink">
                   <span>Free</span>
@@
-            <p className="mt-3 text-sm text-ink">
+            <p className="mt-3 border-t border-line pt-3 text-sm text-ink">
               Est. free next month{" "}
-              <Amount className="font-medium tabular-nums">
+              <Amount className="font-semibold tabular-nums">
                 {formatInr(data.nextMonth.estimated)}
               </Amount>
             </p>
             <button
               type="button"
-              className="min-h-11 text-sm font-medium text-accent"
+              className="btn-ghost -ml-3"
               aria-expanded={nextOpen}
@@ tiles
           <section className="mt-3">
-            <h2 className="text-sm font-medium text-ink">This month</h2>
-            <div className="mt-2 grid grid-cols-2 gap-2">
+            <h2 className="text-sm font-semibold text-ink">This month</h2>
+            <div className="card mt-2 grid grid-cols-2 overflow-hidden">
               {tiles.map((tile) => (
                 <Link
                   key={tile.key}
                   to={tile.href}
-                  className="min-h-20 rounded-2xl border border-line bg-sheet p-3"
+                  className="min-h-20 border-b border-line p-3 odd:border-r active:bg-card-2 [&:nth-last-child(-n+2)]:border-b-0"
                 >
-                  <p className="text-xs text-muted">{tile.label}</p>
-                  <Amount className="mt-1 block text-base font-medium tabular-nums text-ink">
+                  <p className="text-[13px] text-muted">{tile.label}</p>
+                  <Amount className="mt-1 block text-lg font-semibold tabular-nums text-ink">
                     {formatInr(tile.amount)}
@@ recent
-              <h2 className="text-sm font-medium text-ink">Recent</h2>
-              <Link to="/ledger" className="min-h-11 inline-flex items-center text-sm font-medium text-accent">
+              <h2 className="text-sm font-semibold text-ink">Recent</h2>
+              <Link to="/ledger" className="btn-ghost -mr-3">
                 See all
               </Link>
@@
-                        <span
-                          aria-hidden="true"
-                          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-line text-sm font-medium text-ink"
-                        >
+                        <span aria-hidden="true" className="avatar">
                           {categoryInitial(category?.name ?? title)}
@@
-                          <span className="block truncate text-xs text-muted">
+                          <span className="block truncate text-[13px] text-muted">
                             {accountChip(entry, data.accounts)}
@@
                         <Amount
-                          className={`shrink-0 text-base font-medium tabular-nums ${amountClass(kind)}`}
+                          className={`shrink-0 text-base font-semibold tabular-nums ${amountClass(kind)}`}
@@ pace sheet link
             <Link
               to={`/ledger?${new URLSearchParams({ month, type: "expense", inBudget: "1" }).toString()}`}
-              className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent"
+              className="btn-ghost -ml-3 mt-2"
               onClick={() => setPaceOpen(false)}
```

Note on the tiles hunk: `[&:nth-last-child(-n+2)]:border-b-0` removes the bottom hairline on the last row (works for 6 tiles or any even count). If `monthTiles` ever returns an odd count, drop the selector and accept one extra hairline — no logic change.

### app/src/ui/LedgerScreen.tsx

The sticky month bar keeps its exact box height so `top-[7.25rem]` on day headers still lines up. The summary strip is coloured by flow (In = ok, Out = ink, Budget = muted) instead of three muted words.

```diff
--- a/app/src/ui/LedgerScreen.tsx
+++ b/app/src/ui/LedgerScreen.tsx
@@ LedgerRow
-      <span
-        aria-hidden="true"
-        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-line text-sm font-medium text-ink"
-      >
+      <span aria-hidden="true" className="avatar">
         {categoryInitial(category?.name ?? title)}
       </span>
       <span className="min-w-0 flex-1 text-left">
         <span className="block truncate text-base text-ink">{title}</span>
-        <span className="flex items-center gap-1.5 text-xs text-muted">
+        <span className="flex items-center gap-1.5 text-[13px] text-muted">
           <span className="truncate">{chip}</span>
           {entry.inBudget ? (
             <span
               title="In budget"
-              className="inline-flex size-4 items-center justify-center rounded-sm border border-line text-[10px] font-semibold"
+              className="inline-flex size-4 items-center justify-center rounded bg-card-2 text-[10px] font-semibold text-muted"
             >
@@
-      <span className={`shrink-0 text-base font-medium tabular-nums ${amountClass(kind)}`}>
+      <span className={`shrink-0 text-base font-semibold tabular-nums ${amountClass(kind)}`}>
@@ FilterSheet — five kickers, same change each
-        <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Type</p>
+        <p className="kicker mb-2">Type</p>
(repeat for Account, Category, In budget, Source)
@@
       <button
         type="button"
-        className="mt-2 min-h-11 w-full rounded-xl text-sm font-medium text-accent"
+        className="btn-ghost mt-2 w-full"
         onClick={() => onChange({ ...EMPTY_LEDGER_FILTERS, q: filters.q })}
@@ month bar
           <button
             type="button"
             aria-label="Previous month"
-            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg text-ink"
+            className="icon-btn text-lg"
             onClick={() => write(addMonths(month, -1), filters)}
@@
             disabled={!canNext}
-            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg text-ink disabled:opacity-30"
+            className="icon-btn text-lg"
             onClick={() => {
@@
             aria-pressed={searchOpen || filters.q !== ""}
-            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink"
+            className={`icon-btn ${searchOpen || filters.q ? "bg-card-2" : ""}`}
             onClick={() => setSearchOpen((open) => !open)}
@@
-            className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink"
+            className="icon-btn relative"
             onClick={() => setFilterOpen(true)}
@@
-              className="min-h-11 w-full rounded-xl border border-line bg-app px-3 text-base text-ink"
+              className="field"
             />
@@ summary strip (same font size + margin; only colour changes)
-        <p className="mt-3 text-sm text-muted">
-          In {formatInr(strip.inflow)}
-          <span className="mx-1.5 text-line">·</span>
-          Out {formatInr(strip.outflow)}
-          <span className="mx-1.5 text-line">·</span>
-          Budget {formatInr(strip.budgetSpent)}
+        <p className="mt-3 text-sm tabular-nums text-muted">
+          In <span className="font-medium text-ok">{formatInr(strip.inflow)}</span>
+          <span className="mx-1.5 text-line-strong">·</span>
+          Out <span className="font-medium text-ink">{formatInr(strip.outflow)}</span>
+          <span className="mx-1.5 text-line-strong">·</span>
+          Budget {formatInr(strip.budgetSpent)}
         </p>
@@ day headers
-              <h2 className="sticky top-[7.25rem] z-[1] bg-app py-1 text-xs font-medium tracking-wide text-muted uppercase">
+              <h2 className="sticky top-[7.25rem] z-[1] bg-app py-1.5 text-[13px] font-semibold text-muted">
                 {dayHeaderText(group)}
```

### app/src/ui/QuickAddSheet.tsx

```diff
--- a/app/src/ui/QuickAddSheet.tsx
+++ b/app/src/ui/QuickAddSheet.tsx
@@ picker view
           <button
             type="button"
             onClick={() => setPicker(null)}
-            className="min-h-11 rounded-full px-3 text-sm font-medium text-accent"
+            className="btn-ghost -ml-3"
           >
             Back
           </button>
-          <p className="text-base font-medium text-ink">{title}</p>
+          <p className="text-base font-semibold text-ink">{title}</p>
@@
-                  <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
+                  <h3 className="kicker mb-2">
                     {g.group}
                   </h3>
@@ category rows
-                        className={`min-h-11 rounded-xl px-3 text-left text-base ${
-                          row.id === categoryId ? "bg-accent text-accent-fg" : "bg-app text-ink"
+                        className={`min-h-11 rounded-xl px-3 text-left text-base transition-colors active:bg-card-2 ${
+                          row.id === categoryId ? "bg-accent-soft font-medium text-ink" : "text-ink"
                         }`}
@@ account rows
-                  className={`mb-1 min-h-11 w-full rounded-xl px-3 text-left text-base ${
+                  className={`mb-1 min-h-11 w-full rounded-xl px-3 text-left text-base transition-colors active:bg-card-2 ${
                     row.id === (picker === "from" ? fromId : toId)
-                      ? "bg-accent text-accent-fg"
-                      : "bg-app text-ink"
+                      ? "bg-accent-soft font-medium text-ink"
+                      : "text-ink"
                   }`}
@@ goal note
-          <p className="mb-3 rounded-xl border border-line bg-app px-3 py-2 text-sm text-ink">
+          <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-sm text-ink">
             This save also funds {goalName}.
@@ amount hero
-        <p className="text-xs font-medium tracking-wide text-muted uppercase">Amount</p>
-        <p className="text-4xl font-semibold tracking-tight text-ink" aria-live="polite">
+        <p className="kicker">Amount</p>
+        <p className="mt-1 text-[2.5rem] leading-none font-semibold tracking-tight tabular-nums text-ink" aria-live="polite">
           {amountLabel}
         </p>
         {amount.parts.length > 0 ? (
-          <p className="text-sm text-muted">{expr}</p>
+          <p className="mt-1.5 text-sm tabular-nums text-muted">{expr}</p>
         ) : null}
@@ From / To (both buttons)
-              className="min-h-11 rounded-xl border border-line px-3 py-2 text-left"
+              className="min-h-11 rounded-xl border border-line-strong bg-card px-3 py-2 text-left transition-colors active:bg-card-2"
             >
-              <span className="block text-xs text-muted">From</span>
+              <span className="block text-[13px] text-muted">From</span>
(same for the To button; label "To")
@@
-          <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
-            Category
-          </p>
+          <p className="kicker mb-2">Category</p>
@@ in-budget row
-              <p className="text-xs text-muted">
+              <p className="text-[13px] text-muted">
                 counts against {formatInr(cap)} cap
@@ switch (unchanged colours; thumb on card)
-              className={`relative h-7 w-12 shrink-0 rounded-full ${
-                inBudget ? "bg-accent" : "bg-line"
+              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
+                inBudget ? "bg-accent" : "bg-line-strong"
               }`}
             >
               <span
-                className={`absolute top-0.5 size-6 rounded-full bg-sheet transition-transform ${
+                className={`absolute top-0.5 size-6 rounded-full bg-card shadow-sm transition-transform ${
@@ note input
-            className="min-h-11 w-full rounded-xl border border-line bg-app px-3 text-base text-ink"
+            className="field"
@@ hints
-              <li key={`${hint.field}:${hint.message}`} className="text-sm text-amber-800 dark:text-amber-300">
+              <li key={`${hint.field}:${hint.message}`} className="text-sm font-medium text-warn">
@@ footer
-      <div className="shrink-0 pt-3">
+      <div className="shrink-0 border-t border-line pt-3">
         <button
           type="button"
           disabled={!canSave}
           onClick={() => submit(false)}
-          className="min-h-11 w-full rounded-xl bg-accent text-base font-medium text-accent-fg disabled:opacity-40"
+          className="btn-primary min-h-12 w-full"
         >
           Save
         </button>
         <button
           type="button"
           disabled={!canSave}
           onClick={() => submit(true)}
-          className="mt-2 min-h-11 w-full rounded-xl text-sm font-medium text-accent disabled:opacity-40"
+          className="btn-ghost mt-1 w-full"
         >
```

### app/src/ui/PlanScreen.tsx

```diff
--- a/app/src/ui/PlanScreen.tsx
+++ b/app/src/ui/PlanScreen.tsx
@@
 function bandFill(band: PaceBand): string {
-  if (band === "on_track") return "bg-emerald-600 dark:bg-emerald-500";
-  if (band === "watch") return "bg-amber-500";
-  return "bg-red-600 dark:bg-red-500";
+  if (band === "on_track") return "bg-ok";
+  if (band === "watch") return "bg-warn";
+  return "bg-danger";
 }
@@ PaceBar
-    <div className="relative mt-3 h-1.5 w-full rounded-full bg-line">
+    <div className="relative mt-3 h-2 w-full rounded-full bg-card-2">
@@
-        className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-ink"
+        className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-ink"
@@ screen title
-      <h1 className="text-3xl font-semibold tracking-tight text-ink">Plan</h1>
+      <h1 className="text-2xl font-semibold tracking-tight text-ink">Plan</h1>
       <p className="mt-1 text-sm text-muted">Planning never posts to the ledger.</p>
 
-      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
+      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
         {PLAN_TABS.map((id) => (
```
(The `-mx-5 … px-5` lets the chip row bleed to the screen edge so the last chip is visibly cut, signalling scroll. Same edit for the three inner chip rows below.)

```diff
@@ forecast drill-in sheet rows
-                <span className="shrink-0 tabular-nums text-ink">{formatInr(line.amount)}</span>
+                <span className="shrink-0 font-medium tabular-nums text-ink">{formatInr(line.amount)}</span>
@@ BudgetPanel month arrows (both)
-          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-lg text-ink disabled:opacity-30"
+          className="icon-btn text-lg"
@@ cap hero
-      <div className="mt-3 rounded-2xl border border-line bg-sheet p-4">
+      <div className="card mt-3 p-4">
         <div className="flex items-start justify-between gap-3">
           <div>
-            <p className="text-xs font-medium tracking-wide text-muted uppercase">Cap</p>
-            <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
+            <p className="kicker">Cap</p>
+            <p className="hero-num mt-1.5">
               {formatInr(data.pace.cap)}
             </p>
           </div>
           <button
             type="button"
             aria-label="Edit cap"
             onClick={onEditCap}
-            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-sm font-medium text-accent"
+            className="btn-ghost -mr-3 -mt-2"
           >
@@ spend by category
-      <h3 className="mt-5 text-sm font-medium text-ink">Spend by category</h3>
+      <h3 className="mt-5 text-sm font-semibold text-ink">Spend by category</h3>
@@
-                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
+                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-card-2">
                   <div
-                    className="h-full rounded-full bg-accent"
+                    className="h-full rounded-full bg-seg-emi"
```
(Category bars are data, not an action, so they leave the accent. `seg-emi` is the neutral data grey.)

```diff
@@ months list
-      <h3 className="mt-5 text-sm font-medium text-ink">Months</h3>
+      <h3 className="mt-5 text-sm font-semibold text-ink">Months</h3>
@@
-              className={`flex min-h-14 w-full items-center gap-3 py-2 text-left ${
-                row.month === month ? "text-accent" : "text-ink"
+              className={`-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left text-ink transition-colors active:bg-card-2 ${
+                row.month === month ? "bg-accent-soft font-medium" : ""
               }`}
@@
-                <span className="block text-xs text-muted">
+                <span className="block text-[13px] text-muted">
                   Cap {formatInr(row.cap)} · In {formatInr(row.income)} · Exp{" "}
@@
-              <span className="shrink-0 text-sm tabular-nums">
+              <span className="shrink-0 text-sm font-medium tabular-nums">
@@ RecurringPanel hero
-      <div className="rounded-2xl border border-line bg-sheet p-4">
-        <p className="text-xs font-medium tracking-wide text-muted uppercase">
-          Monthly fixed cost
-        </p>
-        <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
+      <div className="card p-4">
+        <p className="kicker">Monthly fixed cost</p>
+        <p className="hero-num mt-1.5">
           {formatInr(data.recurringHeader.monthlyFixed)}
         </p>
-        <p className="mt-1 text-sm text-muted">
+        <p className="mt-2 text-sm text-muted">
@@
-      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
+      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
         {RECURRING_FILTERS.map((id) => (
@@ add buttons — all three panels
-        className="mt-3 min-h-11 w-full rounded-xl border border-line text-sm font-medium text-accent"
+        className="btn-secondary mt-3 w-full text-sm"
@@ RecurringCard meta + switch
-        <span className="mt-0.5 block text-xs text-muted">
+        <span className="mt-0.5 block text-[13px] text-muted">
@@
-          className={`mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full px-1 ${
-            plan.active ? "bg-accent" : "bg-line"
+          className={`mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors ${
+            plan.active ? "bg-accent" : "bg-line-strong"
           }`}
         >
           <span
-            className={`size-5 rounded-full bg-sheet transition-transform ${
+            className={`size-5 rounded-full bg-card shadow-sm transition-transform ${
@@ OneTimePanel hero
-      <div className="rounded-2xl border border-line bg-sheet p-4">
-        <p className="text-xs font-medium tracking-wide text-muted uppercase">Next 30 days</p>
-        <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
+      <div className="card p-4">
+        <p className="kicker">Next 30 days</p>
+        <p className="hero-num mt-1.5">
           {formatInr(data.oneTimeHeader.next30)}
         </p>
-        <p className="mt-1 text-sm text-muted">
+        <p className="mt-2 text-sm text-muted">
@@
-      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
+      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
         {(["planned", "completed", "cancelled"] as const).map((id) => (
@@ one-time row
-                      <span className="mt-0.5 block text-xs text-muted">
+                      <span className="mt-0.5 block text-[13px] text-muted">
@@
-                    <span className="shrink-0 text-base font-medium tabular-nums text-ink">
+                    <span className="shrink-0 text-base font-semibold tabular-nums text-ink">
@@ one-time row actions
-                      className="min-h-11 rounded-full border border-line px-3 text-sm font-medium text-ink"
+                      className="btn-secondary rounded-full text-sm"
                     >
                       Complete
                     </button>
                     <button
                       type="button"
                       onClick={() => onCancel(plan)}
-                      className="min-h-11 rounded-full px-3 text-sm font-medium text-muted"
+                      className="btn-quiet"
@@ InflowsPanel hero
-      <div className="rounded-2xl border border-line bg-sheet p-4">
-        <p className="text-xs font-medium tracking-wide text-muted uppercase">
-          Expected, not counted
-        </p>
-        <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
+      <div className="card p-4">
+        <p className="kicker">Expected, not counted</p>
+        <p className="hero-num mt-1.5">
           {formatInr(data.inflowsHeader.expectedNotCounted)}
         </p>
-        <p className="mt-1 text-sm text-muted">
+        <p className="mt-2 text-sm text-muted">
@@
-      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
+      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
         {(["expected", "received", "dropped"] as const).map((id) => (
@@ inflow row
-                  <span className="block text-xs text-muted">
+                  <span className="block text-[13px] text-muted">
@@
-                <span className="shrink-0 text-base font-medium tabular-nums text-ink">
+                <span className="shrink-0 text-base font-semibold tabular-nums text-ink">
@@ ForecastPanel toggle-as-chip
-        className={`min-h-11 rounded-full px-3 text-sm font-medium ${
-          assumeInflows ? "bg-accent text-accent-fg" : "border border-line text-ink"
-        }`}
+        className={chipClass(assumeInflows)}
       >
         Assume expected inflows arrive
       </button>
-      <p className="mt-2 text-xs text-muted">Off by default. Inflows stay out of free cash either way.</p>
+      <p className="mt-2 text-[13px] text-muted">Off by default. Inflows stay out of free cash either way.</p>
 
-      <div className="mt-4 rounded-2xl border border-line bg-sheet p-4">
-        <h3 className="text-sm font-medium text-ink">Next 6 months</h3>
+      <div className="card mt-4 p-4">
+        <h3 className="text-sm font-semibold text-ink">Next 6 months</h3>
@@
-              <div className="flex h-20 w-7 flex-col justify-end overflow-hidden rounded-sm bg-line">
+              <div className="flex h-20 w-7 flex-col justify-end overflow-hidden rounded-md bg-card-2">
@@
-                      className="w-full bg-muted"
+                      className="w-full bg-seg-life"
@@
-                      className="w-full bg-ink"
+                      className="w-full bg-seg-emi"
@@
-              <span className="text-[10px] text-muted">{formatMonthShort(bar.month)}</span>
+              <span className="text-[11px] text-muted">{formatMonthShort(bar.month)}</span>
@@ legend
-        <p className="mt-2 text-[11px] text-muted">
-          <span className="mr-2 inline-block size-2 rounded-sm bg-ink align-middle" />
+        <p className="mt-2 text-[12px] text-muted">
+          <span className="mr-2 inline-block size-2 rounded-sm bg-seg-emi align-middle" />
           Loan/EMI
-          <span className="mx-2 inline-block size-2 rounded-sm bg-muted align-middle" />
+          <span className="mx-2 inline-block size-2 rounded-sm bg-seg-life align-middle" />
           Lifestyle
@@ totals card
-      <div className="mt-3 rounded-2xl border border-line bg-sheet p-4 text-sm">
-        <p className="font-medium text-ink">6-month total</p>
-        <p className="mt-1 text-muted">
+      <div className="card mt-3 p-4">
+        <p className="kicker">6-month total</p>
+        <p className="hero-num mt-1.5 text-2xl">
+          {formatInr(data.forecast.totals.total)}
+        </p>
+        <p className="mt-2 text-sm text-muted">
           Loan/EMI {formatInr(data.forecast.totals.loanEmi)} · Lifestyle{" "}
           {formatInr(data.forecast.totals.lifestyle)} · Investment{" "}
           {formatInr(data.forecast.totals.investment)}
         </p>
-        <p className="mt-1 text-base font-medium tabular-nums text-ink">
-          {formatInr(data.forecast.totals.total)}
-        </p>
       </div>
```
(Totals card: the number moves above its breakdown — same three `<p>`s, reordered, no new data.)

```diff
@@ ForecastCard
-    <li className="rounded-2xl border border-line bg-sheet p-4">
+    <li className="card p-4">
       <div className="flex items-center justify-between gap-2">
-        <h3 className="text-base font-medium text-ink">{formatMonthTitle(row.month)}</h3>
-        <span className="text-sm font-medium tabular-nums text-ink">{formatInr(row.total)}</span>
+        <h3 className="text-base font-semibold text-ink">{formatMonthTitle(row.month)}</h3>
+        <span className="text-base font-semibold tabular-nums text-ink">{formatInr(row.total)}</span>
       </div>
@@
-              className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm"
+              className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 text-left text-sm transition-colors active:bg-card-2"
@@
-        className={`mt-1 text-sm tabular-nums ${
-          row.projectedLiquid < 0 ? "text-red-700 dark:text-red-400" : "text-muted"
+        className={`mt-2 border-t border-line pt-2 text-sm tabular-nums ${
+          row.projectedLiquid < 0 ? "font-medium text-danger" : "text-muted"
         }`}
```

### app/src/ui/WealthScreen.tsx

Allocate CTA becomes the screen's one primary action instead of another card.

```diff
--- a/app/src/ui/WealthScreen.tsx
+++ b/app/src/ui/WealthScreen.tsx
@@ BucketRing
-      style={{ background: `conic-gradient(${stroke} ${pct}%, var(--line) 0)` }}
+      style={{ background: `conic-gradient(${stroke} ${pct}%, var(--card-2) 0)` }}
     >
-      <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-sheet text-[11px] font-medium tabular-nums text-ink">
+      <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-card text-[11px] font-semibold tabular-nums text-ink">
@@ NwRow
-      <Amount className="shrink-0 text-base font-medium tabular-nums text-ink">
+      <Amount className="shrink-0 text-base font-semibold tabular-nums text-ink">
@@ BucketCard
-    <article className="rounded-2xl border border-line bg-sheet p-4">
+    <article className="card p-4">
       <div className="flex items-start gap-3">
@@
-          <h2 className="text-base font-medium text-ink">{bucket.name}</h2>
+          <h2 className="text-base font-semibold text-ink">{bucket.name}</h2>
@@
-          <p className="mt-1 text-xs text-muted">{FILL_MODE_LABELS[bucket.fillMode]}</p>
+          <p className="mt-1 text-[13px] text-muted">{FILL_MODE_LABELS[bucket.fillMode]}</p>
@@
-        <p className="mt-3 text-xs text-muted">No accounts tagged yet.</p>
+        <p className="mt-3 text-[13px] text-muted">No accounts tagged yet.</p>
@@ WealthScreen
   const netClass =
-    (data?.netWorth ?? 0) < 0 ? "text-red-700 dark:text-red-400" : "text-ink";
+    (data?.netWorth ?? 0) < 0 ? "text-danger" : "";
@@
-          <h1 className="text-3xl font-semibold tracking-tight text-ink">Wealth</h1>
+          <h1 className="text-2xl font-semibold tracking-tight text-ink">Wealth</h1>
@@
-          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink"
+          className="icon-btn"
           aria-label="Edit bucket rules"
@@ net worth card
-          <div className="mt-4 rounded-2xl border border-line bg-sheet p-4">
+          <div className="card mt-4 p-4">
             <div className="flex items-start justify-between gap-3">
               <div>
-                <p className="text-xs font-medium tracking-wide text-muted uppercase">Net worth</p>
-                <p className={`mt-1 text-3xl font-semibold tracking-tight tabular-nums ${netClass}`}>
+                <p className="kicker">Net worth</p>
+                <p className={`hero-num mt-1.5 ${netClass}`}>
                   <Amount>{formatInr(data.netWorth)}</Amount>
                 </p>
               </div>
-              <Link to="/wealth/portfolio" className="text-sm font-medium text-accent">
+              <Link to="/wealth/portfolio" className="btn-ghost -mr-3 -mt-2">
                 Portfolio
               </Link>
@@ assets / liabilities (both cards)
-            <div className="rounded-2xl border border-line bg-sheet p-4">
-              <p className="text-xs font-medium tracking-wide text-muted uppercase">Assets</p>
-              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
+            <div className="card p-3">
+              <p className="kicker">Assets</p>
+              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
(same for Liabilities)
@@ goals card
-          <div className="mt-4 rounded-2xl border border-line bg-sheet p-4">
+          <div className="card mt-4 p-4">
             <div className="flex items-center justify-between gap-3">
-              <p className="text-xs font-medium tracking-wide text-muted uppercase">Goals</p>
-              <Link to="/wealth/goals" className="text-sm font-medium text-accent">
+              <p className="text-sm font-semibold text-ink">Goals</p>
+              <Link to="/wealth/goals" className="btn-ghost -mr-3 -my-2">
                 See all
               </Link>
@@
-                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${pillClass(shown.pill)}`}
+                          className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${pillClass(shown.pill)}`}
@@ invest card
-          <div className="mt-4 rounded-2xl border border-line bg-sheet p-4">
+          <div className="card mt-4 p-4">
             <div className="flex items-center justify-between gap-3">
-              <p className="text-xs font-medium tracking-wide text-muted uppercase">Invest</p>
-              <Link to="/wealth/invest" className="text-sm font-medium text-accent">
+              <p className="text-sm font-semibold text-ink">Invest</p>
+              <Link to="/wealth/invest" className="btn-ghost -mr-3 -my-2">
                 Open
               </Link>
@@ allocate CTA
           {data.free > 0 ? (
             <Link
               to="/wealth/allocate"
-              className="mt-4 block w-full rounded-2xl border border-line bg-sheet p-4 text-left"
+              className="btn-primary mt-5 min-h-12 w-full flex-col gap-0 rounded-2xl py-3 text-left"
             >
-              <p className="text-base font-medium text-ink">
+              <p className="w-full text-base font-medium">
                 Allocate this month — <Amount>{formatInr(data.free)}</Amount> free
               </p>
-              <p className="mt-0.5 text-sm text-muted">Preview the waterfall, then confirm transfers.</p>
+              <p className="mt-0.5 w-full text-sm opacity-80">Preview the waterfall, then confirm transfers.</p>
             </Link>
           ) : data.free < 0 ? (
-            <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
-              <p className="text-base font-medium text-red-700 dark:text-red-400">
+            <div className="card-danger mt-4 p-4">
+              <p className="text-base font-medium text-danger">
                 Committed beyond liquid
               </p>
```

### app/src/ui/MoreScreen.tsx — full replacement

```tsx
import { Link } from "react-router-dom";

export function MoreScreen() {
  return (
    <section className="px-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">More</h1>
      <nav className="card mt-5 divide-y divide-line overflow-hidden">
        <Link
          to="/more/accounts"
          className="flex min-h-14 items-center justify-between px-4 text-base text-ink transition-colors active:bg-card-2"
        >
          Accounts
          <span className="text-muted" aria-hidden="true">
            ›
          </span>
        </Link>
        <Link
          to="/more/categories"
          className="flex min-h-14 items-center justify-between px-4 text-base text-ink transition-colors active:bg-card-2"
        >
          Categories
          <span className="text-muted" aria-hidden="true">
            ›
          </span>
        </Link>
        <Link
          to="/more/settings"
          className="flex min-h-14 items-center justify-between px-4 text-base text-ink transition-colors active:bg-card-2"
        >
          Settings
          <span className="text-muted" aria-hidden="true">
            ›
          </span>
        </Link>
      </nav>
    </section>
  );
}
```

### app/src/ui/LedgerDetailScreen.tsx — action block

```diff
--- a/app/src/ui/LedgerDetailScreen.tsx
+++ b/app/src/ui/LedgerDetailScreen.tsx
@@
-          className="min-h-11 rounded-xl bg-accent text-base font-medium text-accent-fg disabled:opacity-40"
+          className="btn-primary"
         >
           Edit
@@
-          className="min-h-11 rounded-xl border border-line text-base font-medium text-ink disabled:opacity-40"
+          className="btn-secondary"
         >
           Duplicate
@@
-        <div className="mt-4 rounded-xl border border-line p-3">
+        <div className="card-danger mt-4 p-3">
           <p className="text-sm text-ink">Delete this row? Balances will move. This is a soft delete.</p>
@@
-              className="min-h-11 rounded-xl bg-red-700 text-base font-medium text-white disabled:opacity-40 dark:bg-red-800"
+              className="btn-danger"
             >
               Delete row
@@
-              className="min-h-11 rounded-xl text-base font-medium text-muted"
+              className="btn-quiet text-base"
             >
               Cancel
@@
-          className="mt-3 min-h-11 w-full rounded-xl text-sm font-medium text-red-700 dark:text-red-400"
+          className="btn-quiet mt-3 w-full text-danger"
         >
           Delete
```
Kickers in the `<dl>` (`Date`, `Note`, `In budget`, `Source`, `Recorded`, etc.) follow the mechanical rule below.

---

## 3. Mechanical replacements — remaining screens

Apply these exact string substitutions to: `LedgerDetailScreen`, `LedgerEditSheet`, `PlanFormSheets`, `AllocateScreen`, `BucketEditorScreen`, `GoalsScreen`, `GoalDetailScreen`, `GoalFormSheet`, `InvestScreen`, `InvestSheets`, `PortfolioScreen`, `HoldingDetailScreen`, `AccountsScreen`, `AccountDetailScreen`, `AccountFormSheet`, `ReconcileScreen`, `CategoriesScreen`, `CategoryFormSheet`, `SettingsScreen`. Order matters (longer strings first). After the pass, `grep -n "emerald-\|red-[0-9]\|amber-\|teal-\|stone-\|dark:\|bg-sheet\|bg-black" src/ui` should return only `BottomSheet.tsx`'s `bg-sheet` panel.

| # | Find (exact substring) | Replace with |
|---|---|---|
| 1 | `rounded-2xl border border-line bg-sheet` | `card` |
| 2 | `rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40` | `card-danger p-4` |
| 3 | `text-xs font-medium tracking-wide text-muted uppercase` | `kicker` |
| 4 | `text-3xl font-semibold tracking-tight text-ink` (screen `h1`s) | `text-2xl font-semibold tracking-tight text-ink` |
| 5 | `text-3xl font-semibold tracking-tight tabular-nums` and `text-3xl font-semibold tabular-nums text-ink` (hero numbers) | `hero-num` (drop any trailing `text-ink`; keep a conditional `text-danger`) |
| 6 | `min-h-11 rounded-xl bg-red-700 text-base font-medium text-white disabled:opacity-40 dark:bg-red-800` | `btn-danger` |
| 7 | `min-h-11 w-full rounded-xl bg-accent text-base font-medium text-accent-fg disabled:opacity-40` (with any `mt-N` prefix) | `btn-primary w-full` (keep the `mt-N`) |
| 8 | `min-h-12 rounded-2xl bg-accent px-4 text-base font-medium text-accent-fg disabled:opacity-50` / `min-h-11 w-full rounded-2xl bg-accent text-base font-medium text-accent-fg disabled:opacity-50` | `btn-primary min-h-12 w-full rounded-2xl` |
| 9 | `min-h-11 w-full rounded-full bg-accent text-sm font-medium text-accent-fg disabled:opacity-40` | `btn-primary w-full rounded-full text-sm` |
| 10 | `min-h-11 rounded-xl bg-accent text-base font-medium text-accent-fg disabled:opacity-40` | `btn-primary` |
| 11 | `min-h-11 flex-1 rounded-xl border border-line text-sm font-medium text-ink disabled:opacity-40` | `btn-secondary flex-1 text-sm` |
| 12 | `min-h-11 rounded-xl border border-line text-base font-medium text-ink disabled:opacity-40` | `btn-secondary` |
| 13 | `min-h-11 w-full rounded-xl border border-line text-sm font-medium text-accent` (the "+ Add …" rows) | `btn-secondary w-full text-sm` |
| 14 | `min-h-11 rounded-xl px-3 text-sm font-medium text-red-700 dark:text-red-400` | `btn-quiet text-danger` |
| 15 | `min-h-11 rounded-full px-3 text-sm font-medium text-accent disabled:opacity-40` and `min-h-11 rounded-full px-3 text-sm font-medium text-accent` | `btn-ghost` |
| 16 | `min-h-11 w-full rounded-xl border border-line bg-app px-3 text-base text-ink` (inputs, `selectClass`, textareas) | `field` |
| 17 | `text-red-700 dark:text-red-400` | `text-danger` |
| 18 | `text-amber-800 dark:text-amber-300` and `text-amber-700 dark:text-amber-400` | `text-warn` |
| 19 | `inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink` (icon buttons, with or without `text-lg` / `disabled:opacity-30`) | `icon-btn` (keep `text-lg`; drop the `disabled:` class) |
| 20 | `flex size-9 shrink-0 items-center justify-center rounded-full bg-line text-sm font-medium text-ink` | `avatar` |
| 21 | Row meta `text-xs text-muted` under a `text-base` title | `text-[13px] text-muted` |
| 22 | Right-aligned row amounts `text-base font-medium tabular-nums text-ink` | `text-base font-semibold tabular-nums text-ink` |
| 23 | Archived rows `opacity-60` / ended lists `opacity-70` | `opacity-50` |
| 24 | Switch track off state `bg-line` → `bg-line-strong`; thumb `bg-sheet` → `bg-card shadow-sm` | (see QuickAdd/Plan hunks) |
| 25 | Chip rows `flex gap-2 overflow-x-auto pb-1` at screen level | `-mx-5 flex gap-2 overflow-x-auto px-5 pb-1` (inside a sheet: leave as is) |

Do not change any `bg-accent` on a `role="switch"` element, the FAB, the filter count badge, `NetWorthSparkline`'s `text-accent`, or the `BucketRing` default stroke — those are the accent's correct jobs.

---

## 4. Do not touch

Inspected, left alone: `main.tsx`, `App.tsx`, `sw.js`, `screens.tsx`, `tabs.ts`, `icons.tsx` (stroke 1.8 / 2.2 stays), `PlaceholderScreen.tsx` (unused), `Privacy.tsx`, `LockGate.tsx`, `NetWorthSparkline.tsx`, `copy.ts`, `home.ts`, `quickAdd.ts`, `accounts.ts`, `wealth.ts`, `allocate.ts`, `invest.ts`, `portfolio.ts`, `categories.ts`, `privacy.ts`, `install.ts`, `lock.ts`. In `ledger.ts`, `plan.ts`, `goals.ts` only the class-returning functions above change. No file gains or loses a route, query key, request body, label string, or hook.

Tests: if a test asserts `bg-accent text-accent-fg` on a **primary button** it should now expect `btn-primary`; on a **selected chip** it should expect `chip chip-on`; `text-red-700` → `text-danger`; `text-emerald-700` → `text-ok`. Class-string assertions only; no behaviour changes.

---

## 5. QA checklist

Run each in **light and dark** at 360 px and 430 px.

- **Home** — Pace card: dot colour matches band word; one hero number; bar track visible on white. Free-to-allocate: hero at 2 rem is the largest thing on screen; negative state is red text + red-tinted card, copy "Committed beyond liquid" unchanged. "This month" is one card with a 2×N grid, hairlines between tiles, no border on last row. Forecast bars: grey / light-grey / green; legend matches. Recent: inflows blue, outflows ink, transfers muted.
- **Ledger** — Month bar height unchanged; day headers still stick at `7.25rem` with no gap. Summary strip: In blue, Out ink. Search field white with visible border on grey. B badge readable. Filter badge on the icon still green.
- **Quick Add** — Type chips: selected is ink-filled (not green). Amount at 2.5 rem. From/To read as tappable fields. Keypad keys grey, `+` outlined, Save green, "Save & add another" green text. Hint text amber. Picker rows: picked row soft-green tint, not filled.
- **Plan** — Tab chips bleed to the edge and scroll; selected chip ink. Each panel: one hero card, one Add button (outlined), list below on the app background. Months list: current month soft-green row. Forecast: totals card shows the total as hero. Category bars grey, not green.
- **Wealth** — Rings default to green with grey remainder, hole is white/card. Allocate CTA is the only filled green block on the screen. Goal pills: achieved/affordable blue tint, on-track outlined, behind amber tint, saving grey.
- **A form sheet** (Add recurring) — sheet corners 28 px, grabber visible, Close is quiet text, fields white with border on white sheet, Save full-width green at bottom, disabled at 40 %.
- **Delete** (Ledger detail) — Delete text red; confirm block red-tinted with red filled "Delete row" and quiet Cancel.
- **Lock** — Keys white on grey with hairline; Unlock green; error red.
- **Tabs** — Active tab: bold + green + 2 px bar; idle muted. FAB shadow tinted green, sits above list content.
- **Toast** — Ink on app inverted, readable over both a card and the sheet.
- **PWA** — Status bar/theme colour matches column (`#f3f4f1` / `#131513`); installed icon splash uses `#f3f4f1`.
- **Privacy** — Eye toggles blur on amounts only; labels stay crisp.
- **Contrast spot-check** — muted on card ≥ 5.5:1, ok/warn/danger text on card ≥ 5.5:1 (both modes), accent-fg on accent ≥ 7:1.
