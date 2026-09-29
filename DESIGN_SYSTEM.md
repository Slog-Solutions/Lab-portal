# Design System — Digital Language Lab

> **Source:** the Digital Language Lab logo. The two brand colours are taken
> from the artwork itself — deep green `#064E3B` and cream `#F8E7C9` — so the
> interface and the mark are the same palette rather than neighbours.
>
> Supersedes `DESIGN_SYSTEM_LIME_BENTO.md` (sage canvas + acid-lime accent),
> which was derived from an unrelated reference screenshot and had no
> relationship to the product's branding.

---

## 1. Design Intent

A calm, warm, editorial console: a cream canvas holding off-white cards, with
deep green reserved for **chrome and commitment** — the sidebar, primary
buttons, active states, the one panel that matters most on a screen. Cream is
the highlight that answers the green: an active nav item, a secondary button,
a badge.

**Why this fits a lab-control console.** A teacher scans 41 seats and several
live sessions for long stretches. A cream canvas is low-glare and easy to sit
in front of for an hour; green appears rarely enough that when it does appear
— an active route, a primary action, a live session — it genuinely means
something.

**The accent budget.** `--color-accent` is a *hover/focus surface*, not a
shout. Roughly one full-strength green element per screen region: one primary
CTA, one active nav item, one emphasised panel. Green everywhere is green
nowhere.

---

## 2. Colour Tokens

Tailwind v4, CSS-first. **Every token lives in the `@theme` block of
`apps/web/src/styles/index.css` and nowhere else.** Component code never
writes a hex value.

### Brand

| Token | Value | Use |
|---|---|---|
| `--color-brand` | `#064E3B` | Chrome, primary CTAs, active states |
| `--color-brand-hover` | `#053D2E` | Hover/pressed on green fills |
| `--color-brand-muted` | `#0A6B51` | Icons, secondary marks on green |
| `--color-brand-ink` | `#F8E7C9` | Text/icons **on** green |
| `--color-brand-ink-muted` | `#AFC6B8` | De-emphasised text on green |
| `--color-brand-soft` | `#E7EFEA` | Green-tinted chip on a light surface |
| `--color-cream` | `#F8E7C9` | Highlight chips, active nav fill |
| `--color-cream-deep` | `#F1DCB8` | Hover on cream fills |

### Semantic

| Token | Value | Notes |
|---|---|---|
| `--color-background` | `#FDF6E9` | The cream **canvas**, not a card colour |
| `--color-foreground` | `#0B2E22` | Green-black ink |
| `--color-card` / `--color-popover` | `#FFFDF8` | Warm off-white |
| `--color-primary` | `#064E3B` | fg `#F8E7C9` |
| `--color-secondary` | `#F8E7C9` | fg `#064E3B` |
| `--color-muted` | `#F2EADA` | fg `#5C6B63` |
| `--color-destructive` | `#B3402E` | Terracotta, not a pure red |
| `--color-accent` | `#F1E3CB` | **Hover/focus surface** |
| `--color-accent-foreground` | `#064E3B` | Text on an accent surface |
| `--color-border` | `rgba(11,46,34,.10)` | |
| `--color-input` | `rgba(11,46,34,.16)` | |
| `--color-ring` | `#064E3B` | Focus ring |

### Status

`--color-status-online` `#15803D` · `--color-status-offline` `#B3402E` ·
`--color-status-pending` `#C98A2B` · `--color-status-info` `#1F6F8B`

`online` is deliberately brighter and more saturated than `--color-brand` so a
status dot still reads when placed on the green chrome.

### Aliases

`--color-canvas`, `--color-surface-light[-ink][-muted]`,
`--color-surface-dark[-ink][-muted]`, `--color-hairline[-on-dark]` are kept
from the previous system and re-pointed at the new palette. `surface-dark` is
now the **brand green** — it is the high-emphasis surface, not a near-black.
They exist so `components/bento/*` and `ui/card.tsx` re-skin without edits;
prefer the semantic names above in new code.

**Rules**

- Never pure black (`#000`) or pure white (`#FFF`) for text or surfaces. The
  one exception is video: `bg-black` behind a `<video>` is correct
  letterboxing, and `StudentConsole` uses it deliberately.
- Status colour comes from `status-*` only — never `emerald-*` / `amber-*` /
  `sky-*`, so a badge and a dot for the same state can't drift apart.

---

## 3. Typography

**Typeface: Noto Sans.** Humanist, large x-height, very wide glyph coverage —
including the IPA Extensions the offline dictionary needs.

**Vendored, never from a CDN.** This project is air-gapped at deployment. Four
variable `.woff2` subsets (roman + italic × latin + latin-ext, `wght 100–900`)
live in `apps/web/src/assets/fonts/` and are declared with matching
`unicode-range` in `index.css`.

> **Reference them relatively** — `url('../assets/fonts/…')`. `vite.config.ts`
> sets `base: './'` so one build serves both HTTP and Electron's `app://`
> scheme. Vite rewrites relative `url()` in CSS (fingerprinting and
> base-resolving it) but leaves a root-absolute `/fonts/…` untouched, which
> 404s under `app://`.

Helpers (in `index.css`): `.text-hero-num`, `.text-card-title`,
`.text-section-label`. Tracking is looser than the previous General Sans
values — Noto Sans's wider letterforms collapse at `-0.025em`.

Section headers are sentence case, not Title Case.

---

## 4. Logo

`apps/web/src/components/brand/BrandLogo.tsx` is the only place branding is
declared. Never inline an `<img>` or re-create the mark in markup.

```tsx
<BrandLogo variant="full" />              // wordmark + mark lockup
<BrandLogo variant="mark" decorative />   // square "D" only
```

- `variant="full"` — `dll-logo-full.png`, 480×162
- `variant="mark"` — `dll-mark.png`, 256×256
- `decorative` — sets `alt=""` and `aria-hidden`; use when adjacent text
  already names the product, so screen readers don't announce it twice.
- Masters are kept at `src/assets/brand/_source/`; the favicon lives at
  `public/brand/favicon-64.png` because `index.html` cannot use an ESM import.

> **The artwork is deep green on transparent.** On the cream canvas it needs
> no plate. **On the green chrome it is invisible** — give it a cream plate,
> as `TeacherLayout`'s sidebar header does.

---

## 5. Shape and Spacing

| Token | Value | Use |
|---|---|---|
| `--radius-card` | `24px` | Panels, cards, dialogs, the sidebar |
| `--radius-control` | `12px` | Buttons, inputs, selects, nav items |
| `--radius-pill` | `999px` | Badges, chips, status pills |

Use `rounded-card` / `rounded-control` / `rounded-pill` — not `rounded-md`,
`rounded-lg` or `rounded-[28px]`. Most separation is **spacing, not lines**;
reach for a `border-hairline` only when spacing alone fails.

`--spacing-card-padding` (24px) and `--spacing-grid-gap` (16px) are in
`@theme`, so `p-card-padding` and `gap-grid-gap` are real utilities.

---

## 6. Components

`apps/web/src/components/ui/` — shadcn-convention primitives over Radix,
**hand-placed**. There is no `components.json`, so the shadcn CLI will not
manage them; edit them directly.

> **There is no animation plugin.** `tailwindcss-animate` / `tw-animate-css`
> are not installed — that is why `index.css` hand-rolls the `sheet-in-left`
> keyframes. Pasted-in shadcn markup relying on `animate-in`, `fade-in-0` or
> `data-[state=open]:animate-in` will silently not animate.

`Card` supplies `p-6`; `CardHeader` / `CardContent` / `CardFooter` contribute
vertical rhythm only. Don't re-add padding to the sub-parts — that was the
original double-inset bug.

`components/bento/` is the editorial card set (`BentoCard`, `HeroCard`,
`DarkStatCard`, `BigNumberCard`, `CalendarStripCard`, `ProgressListCard`,
`DateBadge`), currently consumed by `features/admin/StatusBoardPage.tsx`.

---

## 7. Configuration

**This project is Tailwind v4 with CSS-first config.** There is no
`tailwind.config.ts` and no `postcss.config.*`, and adding one is not how you
extend the theme here. Tailwind is registered as a Vite plugin
(`@tailwindcss/vite` in `vite.config.ts`), and the `@theme` block in
`apps/web/src/styles/index.css` *is* the configuration.

To add a colour, radius or spacing token, add a custom property to `@theme`.
v4 emits it onto `:root` automatically and generates the matching utilities —
`--color-foo` gives you `bg-foo`, `text-foo`, `border-foo`; `--radius-foo`
gives `rounded-foo`. **Do not hand-write a duplicate `:root` block**; the
previous system did, and it was two places to edit and one to forget.

Light theme only. There is no `.dark` class, no theme provider and no toggle.
Bare `dark:` utilities are a bug, not dormant code: v4 resolves `dark:` to the
`prefers-color-scheme` media query, so they fire on any machine set to dark
mode and restyle text against an unchanged light surface.

---

## 8. Applying the theme to a new page

1. **Never write a hex value.** Use the semantic tokens: `bg-card`,
   `text-foreground`, `text-muted-foreground`, `border-hairline`.
2. **Canvas vs card.** `bg-background` is the cream canvas. Content sits on
   `bg-card`. Pages inside `TeacherLayout` render into an `<Outlet>` — they
   must **not** set their own `min-h-screen` or full-bleed background, or they
   paint a box over the layout.
3. **Radius** from the three tokens in §5.
4. **Status** from `status-*`; badges via `<Badge variant="success | warning |
   info | destructive">`.
5. **Green sparingly** — one primary action per region. Everything else is
   `secondary`, `outline` or `ghost`.
6. **Brand** only through `<BrandLogo/>`.

---

*Maintained alongside `apps/web/src/styles/index.css`. If a token changes,
change it there and update §2 — they are meant to be read together.*
