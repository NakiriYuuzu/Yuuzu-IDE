# shadcn/ui — Design System

A filesystem design system that reproduces **shadcn/ui**, the open-source component
collection by [shadcn](https://twitter.com/shadcn). shadcn/ui is not a component
library you install from npm — it is a set of **beautifully designed, copy-paste
components built with Radix UI primitives and styled with Tailwind CSS**. You own
the code; the project hands you accessible, unstyled-then-restyled building blocks
you paste into your app and customize.

This folder lets a design agent generate interfaces, mockups, and prototypes that
look and feel native to shadcn/ui — the slate-neutral palette, Inter type, 0.5rem
radii, restrained shadows, and the calm black-on-white aesthetic the project is
known for.

## Sources

- **Figma:** "@shadcn_ui - Design System (Community)" — recreated in Figma by
  Pietro Schirano (**@skirano**). Mounted read-only for this build. Pages: Cover,
  Components (27 component frames), Typography, Colors, Primitives (28 atomic
  parts), Icons (877 icon frames).
- **Canonical reference:** [ui.shadcn.com](https://ui.shadcn.com) — the official
  docs, themes, and component source. The tokens here mirror the **default theme
  with `slate` base color** and `--radius: 0.5rem`.
- **Underlying tech:** [Radix UI](https://www.radix-ui.com) (behavior/a11y),
  [Tailwind CSS](https://tailwindcss.com) (styling tokens), and
  [Lucide](https://lucide.dev) (icons).

> Everything inside the .fig (layer names, demo copy like "The Joke Tax Chronicles",
> the @skirano credit) is content authored in that community file. The brand itself
> is shadcn/ui.

---

## Product context

shadcn/ui has no single "app." Its surfaces are:

1. **The documentation site (ui.shadcn.com)** — a clean docs experience: left
   sidebar nav, a component demo + code tab layout, the Themes generator, and a
   blocks gallery. This is the primary surface people mean by "shadcn." The UI kit
   in `ui_kits/docs-site/` recreates it.
2. **The component set itself** — Button, Input, Card, Dialog, Dropdown Menu,
   Tabs, Accordion, Select, Switch, Tooltip, Badge, Avatar, etc. These are the
   reusable building blocks, captured in `ui_kits/components/`.

Because shadcn/ui is a *system for building apps*, the most useful thing this
folder provides is a faithful component kit you can assemble into any product
screen (dashboards, settings, auth, marketing) — all of which inherit the same
tokens.

---

## CONTENT FUNDAMENTALS

How shadcn/ui writes — voice, casing, and tone.

- **Lowercase wordmark.** The brand is always written **`shadcn/ui`** — all
  lowercase, with the slash. Never "Shadcn UI" or "ShadCN." The person is
  **shadcn**, lowercase.
- **Tagline:** *"Beautifully designed components that you can copy and paste into
  your apps."* (Earlier: *"built with Radix UI and Tailwind CSS."*) Calm,
  confident, understated — no hype, no exclamation points.
- **Sentence case everywhere.** Headings, buttons, nav, labels are sentence case
  ("Add to library", "Install Next.js", "Copy", "Edit profile") — *not* Title Case
  and not ALL CAPS. Component doc titles are the lowercase component name ("button",
  "dropdown menu").
- **Voice: you / your.** Docs address the reader directly and practically:
  "You own the code." "Pick the components you need." "Copy and paste into your
  project." Imperative, instructional, second person.
- **Terse, technical, friendly.** Microcopy is short and literal — "Cancel",
  "Continue", "Save changes", "Loading...", "Add to calendar". Helper text is a
  plain sentence ("Enter your email address.").
- **Demo copy has a wink.** Example content throughout the file is playful — the
  Joke Tax Chronicles, "The People of the Kingdom", "everyone enjoys a good joke,
  so it's only fair that they should pay for the privilege." When you need filler,
  match that dry, whimsical register rather than lorem ipsum.
- **No emoji** in product UI or docs chrome. Code, monospace, and real component
  names are used instead of decorative glyphs.
- **Code is first-class.** Copy frequently references commands (`npx shadcn@latest
  add button`), file names, and props in inline `code` styling. The CLI voice is
  matter-of-fact.

---

## VISUAL FOUNDATIONS

The look: **quiet, high-contrast, neutral, and precise.** Black text on white,
slate everywhere in between, one tiny accent of color only for destructive/status.

- **Color.** Built on the **Slate** neutral ramp (50→950). Light theme is
  white background, near-black (`#020817`) text, slate-100 (`#f1f5f9`) for muted
  surfaces, slate-200 (`#e2e8f0`) for every border. **Primary is slate-900**
  (`#0f172a`) — i.e. the "brand color" is essentially black. The *only* chromatic
  color in the base system is **destructive red** (`#ef4444`). No gradients, no
  brand blue/purple. (The `#9747FF` purple in the .fig is Figma annotation guide
  color, not part of the system.) A full dark theme inverts to a near-black
  (`#020817`) background.
- **Type.** **Inter** for everything UI and display; system/JetBrains **mono** for
  code. Display headings are **extrabold + tight tracking** (`-0.025em`); body is
  16px / 28px (`leading-7`). Sizes follow the Tailwind ramp. See "Typography" below.
- **Radius.** One knob: `--radius: 0.5rem` (8px). Cards/popovers use **8px** (lg),
  buttons/inputs use **6px** (md), badges **4px** (sm). Rounded but never pill —
  except deliberately round things (avatars, switches).
- **Spacing.** Tailwind's 4px scale. Components breathe with `gap` and padding in
  4 / 8 / 12 / 16 / 24 / 32 multiples. Generous but not airy.
- **Borders.** **1px solid slate-200** is the workhorse — it defines cards,
  inputs, separators, table rows, dropdowns. Hairline, low-contrast, everywhere.
  The system leans on *borders more than shadows* to separate surfaces.
- **Shadows.** Restrained. Cards use **shadow-sm**; floating surfaces (dropdown,
  popover, dialog, hover-card, tooltip) use **shadow-md**. No big colorful glows.
  Tooltips are the exception — they invert to a dark (slate-900) fill with white
  text.
- **Backgrounds.** Flat. Solid white (or solid near-black in dark). **No** images,
  textures, patterns, or gradients in chrome. Imagery appears only as *content*
  (avatars, aspect-ratio demo photos), never as decoration.
- **Focus.** A 2px **ring** offset from the element (`ring` token = near-black,
  `ring-offset` = background) on keyboard focus. Always visible, never removed.
- **Hover states.** Subtle. Primary buttons darken slightly (~90% opacity of
  slate-900); ghost/secondary items get a slate-100 (`accent`) background wash;
  links underline. No scale-up on hover.
- **Press / active.** No bounce. Buttons may shift to the accent/darker fill; the
  feel is instant and flat. Switches/checkboxes animate their thumb/check with a
  fast (~150ms) ease.
- **Animation.** Minimal and functional. Radix-driven enter/exit:
  fade + slight scale (`0.95→1`) + a few px of slide for popovers/dialogs;
  accordions animate height; ~150–200ms, ease-out. **No** decorative or looping
  motion. Respect `prefers-reduced-motion`.
- **Transparency / blur.** Dialog/sheet overlays use a **black 80% scrim**
  (`bg-black/80`), sometimes with a subtle backdrop blur. Otherwise surfaces are
  opaque.
- **Cards.** White fill, 1px slate-200 border, 8px radius, shadow-sm, padding 24px.
  Header (title + muted description) / content / footer rhythm. The quintessential
  shadcn container.
- **Imagery vibe.** Neutral, true-color, unfiltered. The system itself is
  monochrome; any photography is incidental content, not styled warm/cool.

---

## ICONOGRAPHY

- **Lucide is the icon system.** shadcn/ui ships with and documents
  [Lucide](https://lucide.dev) (the community fork of Feather). Components import
  from `lucide-react`. This kit links Lucide from CDN
  (`https://unpkg.com/lucide@latest`) — see any UI-kit `index.html`.
- **Style:** outline / stroke icons, **2px stroke width**, **24×24** viewBox,
  round line caps and joins, no fill. Rendered at 16px (`size-4`) inside buttons
  and inputs, 20px (`size-5`) standalone. Icon color inherits `currentColor` —
  usually `foreground` or `muted-foreground`.
- **Common glyphs:** `chevron-down`, `chevron-right`, `check`, `x`, `search`,
  `plus`, `mail`, `loader-2` (spin), `arrow-right`, `more-horizontal`, `settings`,
  `user`, `sun`/`moon` (theme toggle), `circle` (radio), `copy`.
- **No emoji**, no icon-font glyphs, no unicode symbols used as icons. Everything
  is an inline SVG via Lucide.
- The .fig's "Icons" page mirrors this Lucide set (877 icon frames). Rather than
  copy 877 SVGs, link Lucide from CDN — it is the exact source set.

---

## Index — what's in this folder

| Path | What it is |
|---|---|
| `README.md` | This file — context, content & visual foundations, iconography, index. |
| `SKILL.md` | Agent-Skill manifest so this folder works as a Claude Skill. |
| `colors_and_type.css` | **Source of truth** for tokens: slate scale, semantic light/dark vars, radius, shadow, type families, type scale, and `.ds-*` typography classes. |
| `assets/` | Visual assets (demo avatar image). Logos are the text wordmark `shadcn/ui`. |
| `preview/` | Small HTML specimen cards that populate the Design System tab. |
| `ui_kits/components/` | The shadcn component kit — Button, Input, Card, Dialog, Tabs, etc. as JSX + an interactive `index.html`. |
| `ui_kits/docs-site/` | Recreation of the ui.shadcn.com docs experience (sidebar, component demo + code, themes). |

### Fonts
- **Inter** — exact match, loaded from Google Fonts in `colors_and_type.css`.
- **Mono** — the .fig uses macOS **Menlo**; this kit substitutes **JetBrains Mono**
  (web-available) in the same `ui-monospace` stack. ⚠️ *Substitution — see Caveats.*

---

## Caveats

- **Mono font substitution:** Menlo is a macOS system font with no web license; I
  use JetBrains Mono as the closest web-available monospace. If you want pixel-exact
  code rendering on Mac, the stack falls back to Menlo locally anyway.
- **Icons via CDN:** Lucide is linked from unpkg rather than vendored, to avoid
  copying 877 SVGs. Pin a version for production.
- The `#9747FF` purple seen in the .fig is Figma's annotation guide color, **not**
  a brand token, and is intentionally excluded.
