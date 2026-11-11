---
name: neumorphic-design
description: Applies neumorphic raised border design to buttons, cards, list containers, and link buttons. Directional dual shadows (light highlight top-left, dark shadow bottom-right) derived from page background color. Use when building/restyling UI components, adding raised border effects, or designing interactive surfaces.
---

# Neumorphic Raised Border Design

Applies a distinctive neumorphic "raised from the page" visual to interactive components using directional shadow pairs and inner highlight lines.

## How to use

- `/neumorphic-design`
  Apply raised border styling to all interactive components in the current task.

- `/neumorphic-design <component-selector>`
  Apply neumorphic styling to a specific component or section. Provide the CSS selectors to target.

## Color System

All shadows derive from the page background color. For this project (`public-portal`), the baseline is `oklch(0.975 0.012 258)` — a very light cool blue-gray.

| Role | Color | Opacity Range | Usage |
|------|-------|---------------|-------|
| Light highlight | `oklch(1 0 0)` | 0.7–0.95 | Top/left raised edge glow |
| Dark shadow | `oklch(0.55 0.03 258)` | 0.08–0.18 | Bottom/right depth |
| Dark shadow (hover lift) | `oklch(0.45 0.08 258)` | 0.10–0.12 | Deeper tone at distance |
| Inner highlight line | `inset 0 1px 0 oklch(1 0 0)` | 0.7–0.85 | Card top edge light catch |

## State Patterns

### Buttons
```css
/* Default — raised */
background: #f8faff; /* slightly above page bg */
box-shadow:
  2px 2px 4px oklch(0.55 0.03 258 / 0.12),
  -1px -1px 3px oklch(1 0 0 / 0.9);

/* Hover — lift */
transform: translateY(-1px);
box-shadow:
  3px 3px 6px oklch(0.55 0.03 258 / 0.16),
  -2px -2px 5px oklch(1 0 0 / 0.95);

/* Active — pressed inset */
box-shadow:
  inset 2px 2px 5px oklch(0.55 0.03 258 / 0.18),
  inset -2px -2px 5px oklch(1 0 0 / 0.6);
```

### Cards / Containers

Cards and containers rely on **directional dual shadows + inner highlight line** for depth — **never** use an outer `border`. An outer border flattens the neumorphic "raised from the page" illusion into a framed box.

```css
/* Default — raised with inner light line, no border */
/* border: none — depth comes from shadows alone */
box-shadow:
  inset 0 1px 0 oklch(1 0 0 / 0.7),
  2px 2px 6px oklch(0.55 0.03 258 / 0.12),
  -2px -2px 6px oklch(1 0 0 / 0.85);

/* Hover — deeper lift, still no border */
transform: translateY(-4px);
box-shadow:
  inset 0 1px 0 oklch(1 0 0 / 0.85),
  5px 5px 14px oklch(0.45 0.08 258 / 0.12),
  -3px -3px 10px oklch(1 0 0 / 0.9);
```

### List Items
```css
/* Hover — subtle individual lift */
transform: translateY(-1px);
box-shadow:
  2px 2px 4px oklch(0.55 0.03 258 / 0.08),
  -1px -1px 3px oklch(1 0 0 / 0.6);
```

### Link Buttons (subtle)
```css
/* Default — gentle raised */
background: #f4f7fc;
box-shadow:
  inset 0 1px 0 oklch(1 0 0 / 0.7),
  2px 2px 4px oklch(0.55 0.03 258 / 0.1),
  -1px -1px 3px oklch(1 0 0 / 0.85);
```

## Anti-Patterns

- NEVER use flat/omnidirectional `box-shadow` (e.g., `0 4px 20px rgba(…)`) — always use directional pairs
- NEVER apply neumorphism to text, inline elements, tags, or badges — it is for block-level interactive surfaces only
- NEVER exceed dark shadow alpha 0.18 or blur radius 14px — the effect must remain subtle
- NEVER mix with Material Design elevation shadows on the same component
- AVOID `overflow: hidden` on neumorphic containers — shadows will be clipped at edges; use `border-radius` clipping with `overflow: hidden` on inner content instead
- NEVER remove the `@media (prefers-reduced-motion: reduce)` fallback — set `transition: none` or `transform: none !important` on neumorphic selectors

## Integration Notes

- This is a CSS-only system — no JavaScript or additional dependencies required
- All shadows use `oklch()` for perceptual uniformity across the lightness range
- Use `cubic-bezier(0.16, 1, 0.3, 1)` easing for hover transitions — it gives a snappy but smooth lift feel
- The `inset 0 1px 0 oklch(1 0 0 / …)` inner highlight line is the single most important detail — it creates the illusion of a physical edge catching light
