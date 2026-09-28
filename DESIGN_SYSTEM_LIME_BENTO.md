# Design System — Lime Bento Dashboard

> **Source:** derived from the reference screenshot (project-management dashboard UI). This is the visual direction to apply to the Digital Language Lab teacher/admin web app. Follow the tokens below exactly — they were measured from the reference, not invented — and apply them to this project's actual content (seat grid, sessions, reports), not the reference's content (which was project-management widgets).

---

## 1. Design Intent

A calm, editorial "bento grid" dashboard: a muted sage-green canvas holding a small number of high-contrast card types (near-black, off-white, and one acid-lime accent), each card sized to its content rather than forced into a uniform grid. Typography is bold, geometric, and confident — numbers are treated as hero content, not incidental data. The lime accent is used sparingly, as a signal (active state, primary action, key metric), never as a background wash.

**Why this fits a lab-control console:** a teacher scanning 41 seats and multiple live sessions needs the same thing this reference optimizes for — fast visual scanning of status and key numbers across differently-weighted panels, with one unmistakable accent color for "this needs attention" or "this is active."

---

## 2. Color Tokens

Use these as CSS custom properties / Tailwind theme extensions. Names are semantic, not literal, so component code never hardcodes a hex value.

```css
:root {
  /* Canvas */
  --color-canvas: #A9AF98;        /* muted sage-olive background */

  /* Accent (use sparingly — active states, primary CTAs, key metrics only) */
  --color-accent: #D7F83C;        /* acid lime */
  --color-accent-ink: #14150F;    /* text/icons placed ON the accent */

  /* Dark surface (stat cards, high-emphasis panels) */
  --color-surface-dark: #17181A;
  --color-surface-dark-ink: #F5F5F0;
  --color-surface-dark-ink-muted: #9A9C97;

  /* Light surface (default cards) */
  --color-surface-light: #F4F4EF;
  --color-surface-light-ink: #14150F;
  --color-surface-light-ink-muted: #6E7066;

  /* Borders / dividers — used sparingly, most separation is spacing not lines */
  --color-hairline: rgba(20, 21, 15, 0.08);
  --color-hairline-on-dark: rgba(245, 245, 240, 0.12);

  /* Status (extend the palette, don't replace the core four above) */
  --color-status-online: #6FCF6F;
  --color-status-offline: #C9503F;
  --color-status-pending: #E0B84A;
}
```

**Rules:**
- The lime accent (`--color-accent`) is a signal color, not a decoration. Budget: at most one accent element per screen region (one CTA button, one active-state badge, one highlighted metric) — never an accent background behind body text or an entire card section.
- Dark surface cards (`--color-surface-dark`) are for the single most important number/stat in a given card cluster — used the way the reference uses it for the sparkline/efficiency card. Don't default every card to dark; most cards should be the light surface.
- Never use pure black (`#000000`) or pure white (`#FFFFFF`) for text or backgrounds — use the ink/surface tokens above, which are softened.

---

## 3. Typography

**Typeface:** a geometric, slightly condensed grotesque sans — matches the reference's confident, tightly-tracked numerals and headings. Use **General Sans** (open license, self-hostable) as the primary family.

**Offline requirement — read before implementing:** this project is air-gapped at deployment. Do **not** load fonts from Google Fonts or any CDN. Download the General Sans variable font files (or a similar open-license alternative such as Inter Tight or Switzer) now, vendor them into `apps/web/src/assets/fonts/`, and load via `@font-face` with local file paths. Verify the app renders correctly with network access fully disabled before considering this done.

```css
@font-face {
  font-family: 'General Sans';
  src: url('/assets/fonts/GeneralSans-Variable.woff2') format('woff2-variations');
  font-weight: 200 700;
  font-display: swap;
}
```

**Type scale:**

| Role | Size / Line-height | Weight | Notes |
|---|---|---|---|
| Hero number (e.g., "645 h", "34%") | 40–48px / 1.05 | 600 (Semibold) | Tight tracking (-0.02em). This is the reference's signature move — a big number IS the content of a card, not a caption under it. |
| Card title | 20–22px / 1.2 | 600 | e.g. "Upcoming Meetings", "Project Roadmap" |
| Section label | 14px / 1.4 | 500 | e.g. "Industry: SaaS" — sentence case, never all-caps (all-caps labels are a generic-AI tell, avoid) |
| Body / metadata | 13–14px / 1.4 | 400–450 | Card subtext, dates, counts |
| Micro label (chips, pills) | 12px / 1.3 | 500 | Status chips, day-of-week labels |

**Rules:**
- No all-caps text anywhere in the UI. The reference doesn't use it and it reads as generic/templated when added.
- Numbers get their own visual weight — when a card's job is to communicate one number (station count, session duration, average score), that number should dominate the card visually, sized larger than its own label, exactly as "645 h" dominates "Total project time" in the reference.

---

## 4. Spacing, Radius, Elevation

```css
:root {
  --radius-card: 28px;      /* large, consistent rounding on all cards */
  --radius-pill: 999px;     /* chips, status badges, date circles */
  --radius-control: 16px;   /* buttons, inputs — smaller than card radius */

  --space-card-padding: 24px;
  --space-grid-gap: 16px;
}
```

- Every card uses the same large radius (`--radius-card`). Do not mix radii across cards — the reference is consistent about this even though card sizes vary a lot.
- No drop shadows as the primary separation device. Cards separate from the canvas by **color contrast alone** (light/dark card against the sage background), not by shadow. A very subtle shadow is acceptable on interactive/hover states only, not as a resting-state default (the skill guidance flags "same soft grey shadow under every card" as a generic-AI tell — avoid it here).

---

## 5. Component Patterns (mapped from reference → this project)

Each pattern below names the reference widget it's drawn from, then how to apply it to actual Digital Language Lab content. Build these as reusable components in `packages/ui` / `apps/web/src/components/`, not one-off per screen.

### 5.1 Profile/Status Hero Card *(reference: "Alesha Hyocinth / OxeliaMetrix" card)*
- Light surface card, avatar + name + role top-left, icon buttons (notification, info) top-right.
- Below: large title, a labeled metadata row, a thin progress bar with a percentage, and a footer row with a dropdown-style control and a dark circular action button.
- **Apply to:** the teacher's own session card at the top of the Lab Control console — teacher name/role, current session name, a progress bar for session completion, a dropdown for report/export selection, and a "Start/End Session" circular action button in the lime or dark-ink treatment.

### 5.2 Calendar Strip Card *(reference: "Upcoming Meetings")*
- Light card, title + count/date summary top-left, a scoped dropdown (e.g. month picker) top-right, a horizontal row of day cells with one active cell highlighted in lime, dot pagination below.
- **Apply to:** a week-view session/class schedule strip — one cell per day, current day highlighted in the accent lime, click to jump to that day's sessions.

### 5.3 Roadmap / Progress List Card *(reference: "Project Roadmap")*
- Light card, title + "+ Add" action top-right, a vertical list of labeled progress bars (each with a percentage and avatar stack), a date axis along the bottom, one vertical "today" marker line through the list.
- **Apply to:** the CEFR curriculum/unit progress view — each row is a Unit or skill area with its class-average completion percentage and a small avatar stack of the top/struggling students, "today" marker showing current point in term.

### 5.4 Dark Stat Card with Sparkline *(reference: "Efficiency — +40%")*
- Full dark surface, small label + month dropdown top, a large "+40%"-style delta pill floating mid-card, a light sparkline chart along the bottom edge.
- **Apply to:** a single-metric spotlight card — e.g. "Average Score — +12%" or "Attendance — +8%" with a trend sparkline. Reserve this treatment for exactly one card per screen; it's the highest-emphasis pattern in the system.

### 5.5 Big-Number Stat Card *(reference: "Total project time — 645h")*
- Medium-dark or light surface, small icon-and-label header, then one dominant number filling most of the card.
- **Apply to:** "Total Lab Hours," "Active Stations," "Sessions This Week" — any single headline metric.

### 5.6 Highlight/Accent CTA Card *(reference: "AI Smart Assistant" card with portrait photo)*
- The one card per screen allowed to use a large photographic or illustrative element, with a small lime circular arrow/action badge in the corner.
- **Apply to:** sparingly — e.g. a "Need help? Ask the AI content assistant" entry point, or a featured/promoted content module thumbnail in the Media Library. Do not overuse this pattern; it's meant to stay rare so it keeps its visual weight.

### 5.7 Date Badge *(reference: circular "19 / Tue, January" badge)*
- Small light-surface pill: a bold day number in a circle (with a lime dot accent) beside a stacked weekday/month label.
- **Apply to:** next-session or next-deadline indicators throughout the UI (next scheduled class, next assignment due date).

---

## 6. Layout — Bento Grid Rules

- Use a responsive CSS grid (`grid-template-columns: repeat(12, 1fr)` at desktop width), with each card pattern above spanning a deliberate number of columns/rows rather than forcing uniform tile sizes. The reference's visual interest comes entirely from *varied* card proportions — a wide card next to two stacked smaller ones, not a uniform 3x3 grid of identical boxes.
- Maintain consistent `--space-grid-gap` between all cards regardless of their size.
- On narrower viewports (tablet-width teacher device), collapse to a single column, largest/most-important card first (session hero → live stats → schedule → progress lists).
- The 41-seat grid in Lab Control is its own dense, uniform grid (small square status tiles) — it does **not** use the bento pattern. Treat it as a distinct, purpose-built layout that sits inside one bento card slot (e.g., "Live Seats" as one large card containing the tile grid), not as the whole page's layout.

---

## 7. Tailwind Implementation Notes

Extend `tailwind.config.ts`, don't hardcode hex values in components:

```ts
theme: {
  extend: {
    colors: {
      canvas: 'var(--color-canvas)',
      accent: {
        DEFAULT: 'var(--color-accent)',
        ink: 'var(--color-accent-ink)',
      },
      surface: {
        dark: 'var(--color-surface-dark)',
        'dark-ink': 'var(--color-surface-dark-ink)',
        'dark-ink-muted': 'var(--color-surface-dark-ink-muted)',
        light: 'var(--color-surface-light)',
        'light-ink': 'var(--color-surface-light-ink)',
        'light-ink-muted': 'var(--color-surface-light-ink-muted)',
      },
      status: {
        online: 'var(--color-status-online)',
        offline: 'var(--color-status-offline)',
        pending: 'var(--color-status-pending)',
      },
    },
    borderRadius: {
      card: 'var(--radius-card)',
      pill: 'var(--radius-pill)',
      control: 'var(--radius-control)',
    },
    fontFamily: {
      sans: ['General Sans', 'system-ui', 'sans-serif'],
    },
  },
}
```

Build the five card patterns in section 5 as shared components (`<HeroCard>`, `<CalendarStripCard>`, `<ProgressListCard>`, `<DarkStatCard>`, `<BigNumberCard>`) accepting typed props for their content — do not copy-paste card markup per screen; every screen composes from this shared set.

---

## 8. Accessibility Checks (verify, don't assume)

- Confirm text contrast: `--color-accent-ink` on `--color-accent` (dark text on lime) and `--color-surface-dark-ink` on `--color-surface-dark` (light text on near-black) both need to be checked against WCAG AA (4.5:1 for body text, 3:1 for large text) — run an actual contrast check, don't eyeball it.
- The lime accent must never be the *only* signal for a status (e.g., "online" vs "offline") — pair it with a text label or icon shape difference, not color alone, since some users can't distinguish it from the sage canvas by hue alone.
- Verify keyboard focus states are visible on all interactive elements (buttons, dropdowns, day-cells) — the reference has no visible focus rings, so this needs to be added deliberately, not skipped because the source design doesn't show it.

---

## 9. What NOT to carry over from the reference

- Don't copy the reference's actual content (project names, fake people, SaaS metrics) — every card's content should be real Digital Language Lab data (stations, sessions, students, scores).
- Don't add card content that has no real data source yet just to fill the bento layout — an empty or lower-priority slot should show a genuine empty state ("No sessions scheduled today") in this system's voice, not a placeholder metric.
- Don't apply the dark-stat-card treatment to more than one card per screen — overusing the highest-contrast pattern flattens the hierarchy it's meant to create.
