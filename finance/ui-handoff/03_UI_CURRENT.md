# Current UI system (as implemented)

This is **what ships today**, not the wish-list in `02_Screens_and_UX_Plan.md`. Use it to see why the screen feels muddy, then replace it with a tighter system.

---

## 1. Layout chrome

**Shell** (`AppShell.tsx`)

- Outer page: `body` background `--page`.
- App column: `mx-auto h-dvh max-w-[480px] bg-app`, 1 px hairline `shadow-[0_0_0_1px_var(--line)]`, safe-area padding L/R.
- Header: `px-5`, safe-area top, one line **“Finance OS”** `text-sm font-medium text-muted`. Screens then draw their own `h1`.
- Main: `flex-1 overflow-y-auto pb-28` (clears tab bar + FAB).
- FAB: `h-14 w-14` circle, `bg-accent text-accent-fg shadow-lg`, bottom-right above the tab bar (`bottom-[calc(4.75rem+safe)]`), `PlusIcon` 28 px.
- Tab bar: `grid-cols-5`, `border-t border-line bg-app`, safe-area bottom. Active `text-accent`, idle `text-muted`. Icon 20 px + label `text-sm`. `min-h-11`.
- Install banner sits **inside** main, above the screen (`mx-5 mb-3` card).

**Typography**

- Font: `"Segoe UI", ui-sans-serif, system-ui, sans-serif` (`--font-sans`).
- Body: 16 px / 1.45, antialiased, `text-ink`.
- Screen titles: mix of `text-2xl` (Home month) and `text-3xl` (Plan, Wealth, More, …) `font-semibold tracking-tight`.
- Hero money: `text-3xl` or `text-4xl` `tabular-nums font-semibold`.
- Labels: `text-xs font-medium tracking-wide text-muted uppercase` on card kicker lines.
- Secondary: `text-sm text-muted`.
- Fine print on charts: `text-[10px]` / `text-[11px]`.

**Spacing rhythm**

- Screen gutter: `px-5`.
- Cards: `mt-3` or `mt-4`, `p-4`, `rounded-2xl`.
- Lists: `divide-y divide-line`, row `min-h-11` / `min-h-14` + `py-2`.
- No 8-pt grid enforced; mix of `gap-1` `gap-2` `gap-3`.

**Safe areas** used on shell, sheet padding, FAB, tab bar, lock screen, toast. Keep them.

---

## 2. Colour tokens (the real palette)

Defined in `src/index.css`. `color-scheme: light dark`. Tailwind v4 `@theme` exposes them as `bg-page`, `bg-app`, `text-ink`, `text-muted`, `border-line`, `bg-accent`, `text-accent-fg`, `bg-sheet`.

| Token | CSS var | Light | Dark | Used for |
|---|---|---|---|---|
| page | `--page` | `#e4dfd2` warm gray-beige | `#0c0d0a` | Desktop/body around the column |
| app | `--app` | `#f4f1e8` paper | `#12140f` olive-black | Column, tab bar, inputs, keypad keys |
| ink | `--ink` | `#1c1b16` | `#ece9df` | Primary text, toast bg (inverted) |
| muted | `--muted` | `#6a665c` | `#a39e90` | Labels, idle tabs, secondary |
| line | `--line` | `#ddd6c6` | `#2c2e24` | Borders, progress track, avatar fill |
| accent | `--accent` | `#215c45` forest | `#6fbf91` mint | Tabs active, primary buttons, selected chips, links, sparkline, some bars |
| accent-fg | `--accent-fg` | `#f3fff8` | `#0c160f` | Text on accent |
| sheet | `--sheet` | `#fffcf5` cream | `#1b1e16` | Cards, bottom sheets, lock keys, ring hole |

PWA:

- HTML theme-color: light `#f4f1e8` (`--app`), dark `#12140f`.
- Manifest `background_color` `#f4f1e8`, `theme_color` `#215c45` (accent, light only — does not follow dark).

**Why it feels muddy (owner complaint):**

1. **Page / app / sheet** are three close warm neutrals (`#e4dfd2` / `#f4f1e8` / `#fffcf5`). Cards barely lift off the column. Borders `#ddd6c6` are low contrast on paper.
2. **Accent green** (`#215c45`) sits next to **Tailwind emerald** (inflows, pace “on track”, goal pills) and **teal** (goal on-track). Three greens.
3. **Muted** is used both as text **and** as a forecast bar segment (Lifestyle) **and** idle tab colour — too many jobs.
4. **Ink** is a forecast bar segment (Loan/EMI) **and** primary text **and** toast background.
5. Semantic surfaces (`bg-red-50`, `bg-emerald-100`, `bg-amber-100`, `bg-stone-200`) ignore the paper theme, so pills look glued on.
6. Dark mode tokens are olive-black; semantic `dark:` classes jump to default Tailwind palettes.

---

## 3. Extra colours **not** in the token file

Hard-coded Tailwind, scattered. These are the mix.

### Status — money direction (`ledger.ts` `amountClass`)

| Kind | Classes |
|---|---|
| In (income, refund) | `text-emerald-700 dark:text-emerald-400` |
| Out (expense, invest, CC pay) | `text-red-700 dark:text-red-400` |
| Through (transfer, adjust) | `text-muted` |

### Status — budget pace (`bandFill` in Home + Plan, `paceDotClass` in `plan.ts`)

| Band | Bar / dot |
|---|---|
| on_track | `bg-emerald-600 dark:bg-emerald-500` |
| watch | `bg-amber-500` |
| over | `bg-red-600 dark:bg-red-500` |

Pace **copy** is still `text-ink` / `text-muted`; only the thin bar is coloured.

### Status — goals (`goals.ts` `pillClass`)

| Pill | Classes |
|---|---|
| affordable_now / achieved | `bg-emerald-100 text-emerald-800` + dark emerald-950/300 |
| on_track | `bg-teal-100 text-teal-800` + dark teal |
| behind | `bg-amber-100 text-amber-900` + dark amber |
| saving | `bg-stone-200 text-stone-700` + dark stone |

### Danger / warning surfaces

| Use | Classes |
|---|---|
| Negative free cash card | `border-red-300 bg-red-50` / `dark:border-red-900 dark:bg-red-950/40` + `text-red-700 dark:text-red-400` |
| Errors, FetchError | `text-red-700 dark:text-red-400` |
| Destructive fill (delete, wipe in detail) | `bg-red-700 text-white` / `dark:bg-red-800` |
| Destructive text button | `text-red-700 dark:text-red-400` |
| Stale reconcile, filter hints, drift hint | `text-amber-700 dark:text-amber-400` or `text-amber-800 dark:text-amber-300` |
| Overlay | `bg-black/40` |

### Forecast stacked bars (Home + Plan)

Bottom → top in the CSS column (visually stacked):

| Segment | Fill |
|---|---|
| Loan/EMI | `bg-ink` |
| Lifestyle | `bg-muted` |
| Investment | `bg-accent` |
| Track | `bg-line` |

Legend is 8 px squares of the same. **Ink-as-data vs ink-as-text** is a contrast problem.

### Bucket rings (`WealthScreen` `BucketRing`)

Conic-gradient: `bucket.colour` if set, else `var(--accent)`, remainder `var(--line)`. Inner disc `bg-sheet`. Default seed colours are often **empty string**, so all three rings can be the same accent green.

---

## 4. Component catalogue (actual, not the spec table)

There is **no** shared `Button.tsx` / `Card.tsx` / `Chip.tsx`. Patterns are copy-pasted class strings.

### Card

Default:

```
rounded-2xl border border-line bg-sheet p-4
```

Used for almost every block on Home, Wealth, Plan heroes, Install, More group (`rounded-2xl border … divide-y`).

Danger card: same radius, red border + red-50 fill.

### Primary button

```
min-h-11 w-full rounded-xl bg-accent text-base font-medium text-accent-fg disabled:opacity-40
```

Sometimes `rounded-full` + `px-4` (Retry, Install).

### Secondary button

```
min-h-11 rounded-xl border border-line text-base font-medium text-ink
```

or `text-accent` on a bordered full-width “+ Add …” row.

### Text / tertiary

```
min-h-11 text-sm font-medium text-accent   // links, “Show breakdown”, “See all”
min-h-11 … text-muted                      // Cancel, Not now, Close
```

### Chip / segment (selected vs idle)

```
shrink-0 min-h-11 rounded-full px-3 text-sm font-medium
on:  bg-accent text-accent-fg
off: border border-line text-ink
```

Used: Quick Add types, Plan tabs, ledger filters, one-time/inflow status, forecast “assume inflows” switch-as-chip.

Plan tab chips sit in `flex gap-2 overflow-x-auto` (horizontal scroll **inside** the chip row).

### Icon button (44 px circle, no fill)

```
inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink
```

Search, filter, eye, gear, month chevrons.

### Switch (recurring active)

Track `h-7 w-12 rounded-full` — `bg-accent` vs `bg-line`. Thumb `size-5 rounded-full bg-sheet` translates.

### List row

Avatar: `size-9 rounded-full bg-line` + category initial.  
Title `text-base text-ink` truncate. Meta `text-xs text-muted`. Amount right-aligned.

In-budget **B**: `size-4` square `border border-line text-[10px] font-semibold`.

### Bottom sheet

- Overlay button full-screen `bg-black/40`.
- Panel `rounded-t-2xl bg-sheet shadow-[0_-8px_32px_rgba(0,0,0,0.18)]`.
- Tall: `h-[min(92dvh,760px)]` (Quick Add, forms). Else `max-h` same cap.
- Grabber `h-1 w-10 rounded-full bg-line`.
- Title `text-lg font-semibold`; Close is text, not an X icon.
- Escape and overlay click dismiss. **No drag-to-dismiss.**

### Toast

Absolute top of the **column** (not the sheet): `rounded-xl bg-ink px-4 py-3 text-sm text-app shadow-lg`. Inverse of the paper theme.

### Keypad

Grid 3×4 + a full-width `+`. Keys `min-h-11 rounded-xl bg-app text-xl`. On lock screen keys are `min-h-14 bg-sheet`.

### Inputs

```
min-h-11 w-full rounded-xl border border-line bg-app px-3 text-base text-ink
```

Selects on Allocate reuse the same (`selectClass`).

### Progress

Pace: track `h-1.5 rounded-full bg-line`, fill band colour, elapsed marker `h-3 w-0.5 bg-ink`.  
Category spend: same track, fill `bg-accent` (not band colour).

### FAB vs tab accent

FAB is filled accent circle. Active tab is **outline icon + accent text**, no filled indicator. Easy to miss which tab is active on a busy Home.

---

## 5. Interactions that exist today

| Gesture / control | What happens |
|---|---|
| Tap tab | Client route; tab stays mounted in shell |
| Tap FAB | Opens Quick Add `BottomSheet` `tall` |
| Overlay / Close / Escape | Closes sheet |
| Scroll main | Vertical only; `pb-28` for chrome |
| Ledger month ← → | Previous any; next disabled after current month (`opacity-30`) |
| Ledger search icon | Toggles search input |
| Ledger filter icon | Sheet; badge `bg-accent` count |
| Tap ledger row | Push detail page |
| Home eye | Toggles `privacy-blur` (10 px blur, no select) |
| Home pace card | Opens Pace sheet |
| “Show breakdown” | Inline expand (not a sheet) |
| Plan chips | Query `?tab=` |
| Recurring switch | PATCH active immediately |
| Pull-to-refresh | **None** |
| Swipe row | **None** |
| Drag reorder | **None** |
| Keyboard | Sheets listen for Escape; inputs are native |

Scroll: main is the only scroller for screens. Tall sheets scroll **inside** the sheet body (`overflow-y-auto` or flex column with keypad pinned). Ledger day headers `sticky` under the month bar (`top-[7.25rem]` — brittle if header height changes).

Hover is irrelevant; this is a phone UI. `:active` / press states are **not** styled (only `disabled:opacity-40` / `30`).

Tap highlight: `button, a { -webkit-tap-highlight-color: transparent; }`.

---

## 6. States you must restyle consistently

Every data screen repeats:

| State | Typical look |
|---|---|
| Loading | `py-8 text-sm text-muted` “Loading Home…” etc. |
| Error | `FetchError` red text + filled Retry |
| Empty | `text-lg font-medium text-ink` + muted hint, or muted one-liner |
| Disabled | `opacity-40` or `opacity-30` or `opacity-60` (inconsistent) |
| Negative money | red text and/or red card |
| Privacy on | blur 10 px on `<Amount>` children only (labels stay) |

Lock: full-column overlay `z-[60] bg-app`, PIN bullets `tracking-[0.4em]`.

---

## 7. Screen-by-screen visual notes

**Home** — densest. Many identical `bg-sheet` cards stacked with `mt-3`. Hero free-cash is `text-3xl` on a card that also contains two expand buttons. Forecast bars are short (`h-16 w-7`). Recent rows copy ledger rows.

**Ledger** — sticky month chrome `bg-app`. Summary strip is muted inline “In · Out · Budget”, not coloured by flow. Day headers uppercase muted. Good candidate for clearer sectioning without extra colour.

**Quick Add** — type chips + huge amount + keypad. Long form; tall sheet. Selected chip = accent fill (same as Save).

**Plan** — horizontal chip tabs then another chip row on Recurring. Two layers of chips + hero card = noisy. Forecast repeats Home bars taller (`h-20`).

**Wealth** — net-worth card + sparkline; three bucket cards with rings; 2-col assets/liabilities (tight on 360 px); goals + invest cards; allocate CTA is **another** default card, not a primary button.

**More** — cleanest screen: one grouped list. Use as the “quiet” reference.

**Settings / forms** — stacked labels + inputs + full-width Save. Amounts open the keypad sheet.

**Delete** — confirm in a sheet; filled red button.

---

## 8. Iconography

Custom 24×24 stroke SVGs, `strokeWidth` 1.8 (Plus 2.2), `currentColor`. No filled tab icons. Category “icons” are **initials in a gray circle**, not a colour system.

---

## 9. Dark mode

Automatic via `prefers-color-scheme`. No in-app toggle. Tokens swap; many semantics use `dark:` Tailwind (emerald/red/amber/teal/stone). Test **both**. Manifest theme_color stays forest green even in dark.

---

## 10. What a cleaner system should probably do

Not mandatory — your call — but this is the hole to fill:

1. **Tokens for:** background, surface, surface-2, text, text-muted, border, accent, accent-contrast, ok, warn, danger, overlay. Map in/out/pace/pills onto ok/warn/danger — **not** a second green family.
2. **One card elevation** (border *or* subtle shadow, not both fighting the beige).
3. **Primary vs selected-chip vs link** — today all three are `--accent`.
4. **Tab active** more than a colour shift (indicator, weight).
5. **Forecast segments** that are not `ink` and `muted` (those are type tokens).
6. **Press/disabled** unified.
7. Light **and** dark checked on Home + Ledger + a sheet.

Keep ₹ `tabular-nums`, 44 px targets, 480 px column, five tabs, FAB, sheets.
