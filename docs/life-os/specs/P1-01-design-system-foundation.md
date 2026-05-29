# P1-01: Establish the Life OS design-system foundation (tokens, Geist, density, themeable accent)

**Type**: Feature  **Phase**: 1  **Epic**: MCPAT-022  **Size**: M

> Size rationale: Three config/style files plus a font-loading decision and the canonical enum→class
> mapping. No component rewrites and no React logic — but it is load-bearing for all of Phase 1, so it
> warrants careful, fully-tested execution rather than a quick S.

---

## Description

This is the **prerequisite foundation** for the entire Life OS reskin. Per the epic overview
(`docs/life-os/specs/00-epic-overview.md` §3, §6, §7), `tailwind.config.js` is currently empty
(`extend: {}`) and `index.css` is bare `@tailwind` directives — there is no design-token layer, no
Geist font, no `--accent` theming, and no density mechanism. Every other Phase-1 spec (P1-02…P1-10)
is declared to *depend on* P1-01 and assumes these tokens already exist.

This spec ports the visual source of truth — the `:root` block in
`design_handoff_life_os/reference/styles.css` — into the real Tailwind theme and an `index.css`
`@layer base`, loads the Geist + Geist Mono typefaces, wires a runtime-themeable `--accent` CSS var,
adds the `[data-density]` row-height mechanism, and — critically — **defines the single canonical
status / priority / area → class mapping** so the enum-drift reconciliation called out in the epic
overview (§2 "Enum drift", §6 anti-patterns) happens *once, here*, and every later spec consumes it
instead of re-deriving it. No component is restyled in this spec; it only builds the layer they sit on.

See for context (do not duplicate — cite):
- `docs/life-os/specs/00-epic-overview.md` §3 (shared tokens), §4 (data shapes), §5 (conventions).
- `design_handoff_life_os/README.md` §3 (suggested `tailwind.config.js` + `index.css` base layer).
- `design_handoff_life_os/reference/styles.css` `:root` (the authoritative token list).

---

## Acceptance Criteria

- [ ] `src/ui/tailwind.config.js` `theme.extend` exposes the full token set from §3: `colors` for
      `bg`, `surface.{1,2,3}`, `ink.{DEFAULT,2,muted,faint}`, `accent.{DEFAULT,hover}`,
      `status.{red,amber,green,blue}`, `area.{client,personal,outsource,internal}`; `fontFamily.sans`
      = Geist-first stack and `fontFamily.mono` = Geist-Mono-first stack; `borderRadius.{card,input,badge,drawer}`
      = `8/6/4/12px`; and `transitionTimingFunction.spring` = `cubic-bezier(0.16,1,0.3,1)`.
- [ ] `accent` is a Tailwind color whose value is `var(--accent, #0070F3)` (and `accent.hover` =
      `var(--accent-hover, #0062D6)`), so `bg-accent` / `text-accent` follow the CSS var at runtime —
      verified by changing `--accent` on `:root` in devtools and seeing an `bg-accent` element recolor
      with no rebuild.
- [ ] `src/ui/src/index.css` adds an `@layer base` that sets `:root { --accent; --accent-hover;
      --accent-soft: color-mix(in srgb, var(--accent) 16%, transparent); }`, `html { color-scheme: dark; }`,
      and a `body` rule applying the Geist sans stack plus `font-feature-settings: "ss03","calt","kern","liga"`.
- [ ] Setting `document.documentElement.dataset.density = 'compact'` makes the row-height token resolve
      to **34px**; `'airy'` → **46px**; unset/`'default'` → **40px** (asserted via the `--row-h` custom
      property the row components read).
- [ ] Geist renders as the default body font (confirmed in-browser: computed `font-family` on `body`
      resolves to a loaded `Geist` face, not the system fallback).
- [ ] One curated accent from `{#0070F3, #7C5CFF, #F0653A, #2BD4A8}` applied by writing `--accent` to
      `:root` propagates to both `bg-accent` and the `--accent-soft` derived fill.
- [ ] A single exported source-of-truth module (`src/ui/src/lib/tokens.ts`) maps each canonical
      `Status` / `Priority` / `Area` enum value (from `src/types/task.ts` — `todo` **not** `queued`) to
      its dot/bar Tailwind class or token, with **no `queued` key present**.
- [ ] The undefined `bg-slate-750` reference (epic overview §2) is removed from the codebase and not
      reintroduced by this spec's changes.

---

## Technical Notes

**Files touched (current state confirmed 2026-05-29):**
- `src/ui/tailwind.config.js` — currently `theme.extend: {}`. Replace with the §3 token map.
- `src/ui/src/index.css` — currently three bare `@tailwind` lines. Add `@layer base` after them.
- `src/ui/index.html` — add font preload/`<link>` here only if the self-host-via-link path is chosen.
- `src/ui/postcss.config.js` — already has `tailwindcss` + `autoprefixer`; no change expected.
  (`color-mix` is shipped as-is — it is native CSS, not a PostCSS transform; target is evergreen Chromium.)
- `src/ui/src/lib/tokens.ts` — **new** single source of truth for the enum→class mapping (below).

**Exact `:root` token list to port** (from `reference/styles.css` lines 7–57; map prototype names →
Tailwind theme keys):

| Reference `--var` | Hex | Tailwind theme key |
|---|---|---|
| `--bg` | `#09090B` | `colors.bg` |
| `--s1` / `--s2` / `--s3` | `#111113` / `#18181B` / `#27272A` | `colors.surface.{1,2,3}` |
| `--text` / `--text2` / `--muted` / `--muted-2` | `#FAFAFA` / `#A1A1AA` / `#71717A` / `#52525B` | `colors.ink.{DEFAULT,2,muted,faint}` |
| `--accent` / `--accent-hover` | `var(--accent,#0070F3)` / `var(--accent-hover,#0062D6)` | `colors.accent.{DEFAULT,hover}` |
| `--red` / `--amber` / `--green` / `--blue` | `#EF4444` / `#F59E0B` / `#22C55E` / `#3B82F6` | `colors.status.{red,amber,green,blue}` |
| `--area-client/personal/outsource/internal` | `#F59E0B` / `#22C55E` / `#8B5CF6` / `#6B7280` | `colors.area.{client,personal,outsource,internal}` |
| `--r-card` / `--r-input` / `--r-badge` + drawer 12px | `8` / `6` / `4` / `12` px | `borderRadius.{card,input,badge,drawer}` |
| `--ease-spring` | `cubic-bezier(0.16,1,0.3,1)` | `transitionTimingFunction.spring` |
| `--font-sans` / `--font-mono` | Geist / Geist Mono stacks | `fontFamily.{sans,mono}` |

Note `--accent-soft` (`color-mix(in srgb, var(--accent) 16%, transparent)`), `--row-h`, `--nav-w`
(216px), `--ambient-w` (296px), `--page-pad`, `--section-gap`, `[data-density]` overrides, and the
`[data-font="inter"]` toggle stay as **CSS custom properties in `index.css`** (they are layout/density
runtime knobs, not Tailwind palette entries). The `inter` fallback theme exists in the prototype but
Geist ships as the default (epic §3, README §3).

**Font-loading approach (recommended: self-host):** Self-host Geist + Geist Mono via
`@fontsource-variable/geist` + `@fontsource-variable/geist-mono` (or the static `@fontsource/*`
packages at weights 400/450/500/600/700), imported once at the top of `index.css` / `main.tsx`.
Tradeoff: self-hosting adds a dependency and ~bundle weight but removes a third-party network
round-trip, eliminates the Google-Fonts privacy/availability dependency, and gives deterministic
offline rendering on this localhost-only dashboard (no CDN reachability assumption) — preferable to a
Google Fonts `<link>` for a single-user local tool. The `<link>`/CDN alternative is the fallback if the
fontsource packages are unavailable; if taken, add the preconnect + stylesheet `<link>` to
`src/ui/index.html`. Decide and record in Open Questions.

**Canonical enum → class/color mapping (single source of truth — `src/ui/src/lib/tokens.ts`).**
Derived from `reference/board.jsx:91` (status dots), `reference/board.jsx`/`app.jsx` (priority), and
§3 area dots. Keys use the **real-store unions from `src/types/task.ts`** — prototype `queued` maps to
`todo`; later specs import from this module and never hardcode a color or re-add `queued`:

*Status → dot color:*

| `Status` (canonical) | Token / class | Source |
|---|---|---|
| `todo` | `ink.muted` (`#71717A`) | prototype `queued` → `todo` |
| `in_progress` | `status.blue` (`#3B82F6`) — `animate-pulse` ring only while running | |
| `done` | `status.green` (`#22C55E`) | |
| `blocked` | `status.red` (`#EF4444`) | |
| `cancelled` | `ink.faint` (`#52525B`) | |

*Priority → color (cycle order `critical → high → medium → low`, `app.jsx:284`):*

| `Priority` | Token |
|---|---|
| `critical` | `status.red` |
| `high` | `status.amber` |
| `medium` | `status.blue` |
| `low` | `ink.muted` |

*Area → dot color (§3):*

| `Area` | Token |
|---|---|
| `client` | `area.client` (`#F59E0B`) |
| `personal` | `area.personal` (`#22C55E`) |
| `outsource` | `area.outsource` (`#8B5CF6`) |
| `internal` | `area.internal` (`#6B7280`) |

Expose these as typed `Record<Status,…>` / `Record<Priority,…>` / `Record<Area,…>` maps (strict, no
`any`, exhaustive over the unions) so adding a future status fails type-check until the map is updated.

**`bg-slate-750` bug:** epic overview §2 flags `bg-slate-750` as referenced-but-undefined (renders as
no background). Remove the reference as part of laying down the surface tokens; the correct replacement
is the appropriate `surface.{1,2,3}` token, but the *full* hardcoded-utility migration is P1-03+ — here
only delete the broken `slate-750` usage so it does not silently render transparent.

---

## Failure Modes

- **Geist fails to load** (package missing, CDN unreachable): the `fontFamily.sans` stack ends in
  `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` and `mono` in `ui-monospace, "SF Mono",
  monospace`, so text remains legible in a system fallback rather than an invisible/`serif` default.
  The Geist-loaded AC must fail loudly (visible system font) rather than pass on a fallback.
- **FOUT (flash of unstyled text):** self-hosting with `font-display: swap` (the fontsource default) is
  acceptable on a localhost tool — a brief swap from the system stack to Geist is preferred over blocking
  render. Do not use `font-display: block` (risks invisible text). With self-host the swap window is sub-frame
  in practice; the CDN path has a larger FOUT window — another reason to prefer self-host.
- **`color-mix` unsupported:** target is evergreen Chromium where `color-mix` is native; no fallback hex
  is required, but `--accent-soft` must be defined via `color-mix` (not a hardcoded blue) so it tracks a
  swapped accent.

---

## Out of Scope

- Restyling individual components, views, or the shell — `TaskCard`, `Header`, `App.tsx`, etc. stay
  visually untouched here; consuming these tokens is P1-02 (shell) and P1-03+ (surfaces).
- Migrating the ~25 files of hardcoded `slate/violet/indigo` utilities (P1-03+); only the broken
  `bg-slate-750` reference is removed here.
- Shipping `reference/tweaks-panel.jsx` or any mock data layer (epic §6, §10).
- The **actual settings UI** for the accent/density toggles is optional and deferred — this spec only
  guarantees the *mechanism* (the `--accent` var and `[data-density]` attribute) exists so a future
  toggle can write `lifeos-accent` / `lifeos-density`. No settings panel is built here.

---

## Dependencies

None. This is the first spec on the Phase-1 critical path (`P1-01 → P1-02 → P1-03..P1-10`).

---

## Testing

- `npm run type-check` passes (strict, no `any`) — the `tokens.ts` enum maps are exhaustive over the
  `src/types/task.ts` unions.
- `npm run build` succeeds (Vite/tsup) with the new Tailwind theme and font imports.
- Visual / in-browser check (run the `serve-ui` UI):
  - `body` computed `font-family` resolves to a loaded **Geist** face (not the system fallback).
  - Writing each curated accent (`#0070F3`, `#7C5CFF`, `#F0653A`, `#2BD4A8`) to `:root --accent` in
    devtools recolors a `bg-accent` element **and** the `--accent-soft` fill, with no rebuild.
  - Toggling `document.documentElement.dataset.density` between `compact` / unset / `airy` resolves
    `--row-h` to `34` / `40` / `46` px respectively.
- Confirm no `bg-slate-750` occurrences remain (grep returns nothing).

---

## Open Questions

- **Self-host vs CDN fonts:** recommendation is self-host via `@fontsource(-variable)/geist[-mono]` for
  offline determinism and no third-party round-trip on this localhost dashboard; the Google Fonts
  `<link>` is the documented fallback. Confirm the fontsource package choice (variable vs static
  weights 400/450/500/600/700) at implementation time.
- **Settings panel now or deferred:** ship only the `--accent` var + `[data-density]` mechanism now
  (toggle UI deferred), or add a minimal settings affordance in this spec? Default: defer the UI; revisit
  when P1-02 wires global state / `localStorage` (`lifeos-accent`, `lifeos-density`).
