# Finance OS — pack for a visual / UI AI

This folder is a **handoff**. You redesign **how the app looks and feels on screen**. Another engineer will apply your diffs to the real repo.

You are **not** changing money math, APIs, routes, or what a tap *does*. You **are** changing colours, contrast, type, spacing, cards, buttons, sheets, scroll chrome, and visual states so the phone UI is **clear, clean, and easy to read**.

## Why this pack exists

The current UI is hard to scan. Colours mix (paper beige + forest green tokens + Tailwind emerald/teal/amber/red/stone). Cards, borders, and text sit too close in value. Status colour and brand colour compete. The owner wants a cleaner visual system, then concrete code to apply it.

## Read in this order

| # | File | What it is |
|---|---|---|
| 1 | `00_README.md` (this file) | Your job, rules, output format |
| 2 | `01_INDEX.md` | Every source file, what it is for, what you may touch |
| 3 | `02_APP.md` | What the product is, screens, navigation, frozen product rules |
| 4 | `03_UI_CURRENT.md` | Tokens, components, colours, interactions **as they exist today** |
| 5 | `04_SOURCE.txt` | Full current source of every UI-relevant file, with `FILE: app/...` headers |

Real checkout path (do not invent another tree):

```
toolkit/finance/new proper web app/app/
```

`04_SOURCE.txt` dumps those files. Edit targets are the paths after `FILE:`.

## Your job

1. Propose a **small, consistent visual system** (tokens first, then components).
2. Apply it across the product screens in `src/ui/*.tsx` and `src/index.css`.
3. Return **code** the implementing AI can paste: CSS variable changes + Tailwind class changes + any tiny markup needed for contrast/hierarchy.

Priority (owner complaint):

1. **Contrast and clarity** — text vs background, numbers vs labels, cards vs page.
2. **One colour language** — stop mixing semantic Tailwind greens/teals with the forest `--accent` without a rule.
3. **Hierarchy** — one hero number per card; quieter chrome; less “everything is a bordered sheet card”.
4. **Touch** — keep ≥ 44 px targets; make primary vs secondary vs destructive obvious.
5. **Motion / gesture chrome** only if it is visual (sheet handle, scroll, sticky headers). Do **not** invent new product features.

## Hard rules (do not break)

**Visual-only.** Allowed:

- `app/src/index.css` tokens (`:root` / dark `@media`)
- Tailwind `className` strings
- Layout/spacing/type in JSX (padding, gaps, rounded, font size/weight)
- Replacing ad-hoc `bg-emerald-*` / `bg-red-50` with **named tokens** you add to CSS
- Icon size/stroke if it stays the same SVG meaning
- `index.html` theme-color / `manifest.webmanifest` colours to match tokens
- CSS for sticky headers, sheet overlay, keypad, privacy blur

**Not allowed:**

- New routes, renamed routes, removed screens
- Changing `queryKey`, fetch functions, POST/PATCH/DELETE bodies
- Changing validation, amounts, labels that encode product meaning (e.g. “Committed beyond liquid”)
- Engine, server, SQLite, import, `/dev/*`
- New dependencies (no extra UI libraries)
- A second desktop layout — desktop **is** the phone column, `max-w-[480px]`, centred
- Horizontal page scroll (chip rows that already use `overflow-x-auto` may stay; do not add new carousels)
- Typing a balance, hiding the ledger, or changing From → To behaviour
- Rewriting helper `.ts` **logic**. You may change **returned class strings** (`amountClass`, `chipClass`, `pillClass`, `paceDotClass`, `bandFill`) because those are visual.

Keep:

| Constraint | Value |
|---|---|
| Viewport | Phone 360–430 px; shell `max-w-[480px]` |
| Text | ≥ 14 px body; amounts `tabular-nums` |
| Tap | `min-h-11` (44 px) or larger |
| Safe area | Existing `env(safe-area-inset-*)` |
| Dark mode | `prefers-color-scheme` (already wired via tokens + some `dark:` classes) |
| Privacy | `.privacy-blur` on amounts via `<Amount>` |
| Nav | 5 bottom tabs + floating **+** Quick Add |
| Forms | Bottom sheets, not new full-page forms |

## How to change colours

Today tokens live in `src/index.css`:

`--page --app --ink --muted --line --accent --accent-fg --sheet`

Tailwind v4 maps them as `bg-app`, `text-ink`, `border-line`, `bg-accent`, `text-accent-fg`, `bg-sheet`, etc.

**Do this:** extend `@theme` / `:root` with any extra tokens you need (`--danger`, `--ok`, `--warn`, `--card`, …) and **use those tokens everywhere** instead of raw `emerald-600`, `red-50`, `stone-200`. Then product screens share one palette.

Light and dark must both stay readable. Manifest `theme_color` / `background_color` and HTML `theme-color` should follow `--app` / `--accent`.

## Output format (required)

Return work the implementing AI can apply without guessing.

1. **Visual system (short)** — token table (name, light hex, dark hex, usage). 1 paragraph on hierarchy.
2. **File patches** — one heading per file, then a unified diff against `04_SOURCE.txt`. Example:

- Heading: `### app/src/index.css`
- Then a `diff` fenced block (`--- a/app/src/index.css` / `+++ b/app/src/index.css`).

If a file is small (`Toast.tsx`, `FetchError.tsx`, `index.css`), a full replacement is OK instead of a diff.

3. **Do not touch list** — files you inspected and left alone.
4. **QA checklist** — screens to eyeball (Home, Ledger, Quick Add, Plan chips, Wealth rings, a form sheet, Lock, dark mode).

If a change needs a new wrapper `div` for a card header vs body, say so. Do not restructure React state, hooks, or data fetching to get a visual win.

## Suggested attack order

1. `src/index.css` — tokens + any shared utility classes.
2. Shared chrome: `AppShell.tsx`, `BottomSheet.tsx`, `Toast.tsx`, `Keypad.tsx`, `FetchError.tsx`, `InstallBanner.tsx`, `LockScreen.tsx`.
3. Class helpers: `ledger.ts` `amountClass`, `plan.ts` `chipClass` / `paceDotClass`, `goals.ts` `pillClass`, duplicated `chipClass` / `bandFill` in screens.
4. Screens: Home → Ledger → Plan → Wealth → sheets.

Do not “redesign navigation”. Five tabs and the + button stay.

## What success looks like

- Numbers readable at arm’s length on a phone.
- One accent colour for **actions**; semantic colours only for **status** (in/out, pace, danger).
- Cards do not blend into the page; muted text still passes contrast.
- Primary button, secondary button, chip, destructive, and text-link are visually distinct and reused.
- Dark mode is not an afterthought.

The implementing AI will apply your code to `app/` and keep behaviour tests green. If a test asserts a class name (`bg-accent`, `text-red-700`, …), either keep a compatible class or note that the test must be updated **for the class string only**.
