# Ice-Blue Aurora Header & Footer Redesign

**Date:** 2026-07-06
**Status:** ⏳ Pending user review
**Scope:** `apps/public-portal` (:3002) — Header (`unified-header.tsx` + `globals.css`.flow-header-bg) + Footer (`home-client.tsx` .footer-glass) + WebGL fluid (`fluid-header.tsx`)
**Design theme:** 冰蓝极光冰幕 — Header 为冰蓝极光，Footer 为湖面倒影，同一片光幕被页面内容撑开

---

## 1. Motivation

当前首页 Header/Footer 使用淡青（cyan/teal）色系——偏绿的水彩色调。用户要求改为冰蓝色调（glacier ice blue），不是简单颜色替换，而是有设计感的流动重设计。本规格定义从淡青→冰蓝的全方位色彩迁移 + 极光带 CSS 光斑重构。

---

## 2. Color Migration — Cyan→Ice Blue

### 2.1 Header / Footer base background

| Element | Current (Cyan) | New (Ice Blue) | Notes |
|---------|---------------|----------------|-------|
| `.flow-header-bg` bg | `#e2f5f6` | `#dfe9f7` | Same lightness, hue swung from ~195→~250 |
| `.footer-glass` bg | `oklch(0.965 0.02 195 / 0.88)` | `oklch(0.965 0.015 250 / 0.88)` | Chroma slightly reduced for colder feel |
| `.footer-glass` border-top | `oklch(0.87 0.03 200 / 0.38)` | `oklch(0.88 0.025 248 / 0.38)` | Matching hue shift |

### 2.2 Aurora blob colors (CSS pseudo-elements)

All 5 blob colors migrate from cyan-green to ice-blue spectrum:

| Blob | Current | New | Visual role |
|------|---------|-----|-------------|
| #1 (before, primary) | `rgba(94,207,214,0.22)` | `rgba(129,174,230,0.20)` | Main aurora band, mid-ice-blue |
| #2 (before, secondary) | `rgba(13,148,136,0.15)` | `rgba(86,137,210,0.14)` | Brand-blue diluted, deeper tone |
| #3 (before, tertiary) | N/A (only 2 per layer) | `rgba(154,194,240,0.12)` | Background fill band, sky-ice |
| #4 (after, highlight) | `rgba(125,196,224,0.18)` | `rgba(180,208,245,0.16)` | Bright band, crystal white-blue |
| #5 (after, subtle) | `rgba(181,232,224,0.20)` | `rgba(170,180,230,0.10)` | Ice-purple rim glow |

### 2.3 Edge flow line

| Element | Current | New |
|---------|---------|-----|
| Gradient stops | `#5ecfd6 → #3db8c4 → #a8f0f0 → #3db8c4 → #5ecfd6` | `#9ec5f0 → #6090d8 → #88b8f0 → #6090d8 → #9ec5f0` |

### 2.4 WebGL fluid palette (fluid-header.tsx)

| Index | Current (cyan) | New (ice blue) | Impression |
|-------|---------------|----------------|------------|
| 0 | `(0.04, 0.20, 0.22)` | `(0.03, 0.12, 0.25)` | Deep ice |
| 1 | `(0.06, 0.24, 0.26)` | `(0.04, 0.16, 0.27)` | Glacier blue |
| 2 | `(0.05, 0.18, 0.20)` | `(0.05, 0.14, 0.26)` | Aurora blue |
| 3 | `(0.08, 0.22, 0.28)` | `(0.06, 0.18, 0.25)` | Crystal blue |
| 4 | `(0.03, 0.22, 0.20)` | `(0.04, 0.14, 0.23)` | Frost blue |

Pattern: green channel reduced ~30–40%, blue channel kept high, red channel stays minimal.

---

## 3. Aurora Band CSS Restructure (Header)

### 3.1 Shape change: circles → horizontal bands

**Current:** Two circular radial-gradient blobs per pseudo-element (`55% 140%`, `50% 130%`), drifting omnidirectionally.

**New:** Three horizontal elliptical bands per pseudo-element with wide X / narrow Y aspect ratios:

```css
.flow-header-bg::before {
  background-image:
    radial-gradient(ellipse, rgba(129,174,230,0.20) 0%, transparent 55%),
    radial-gradient(ellipse, rgba(86,137,210,0.14) 0%, transparent 55%),
    radial-gradient(ellipse, rgba(154,194,240,0.12) 0%, transparent 55%);
  background-size: 80% 45%, 70% 38%, 60% 30%;
  animation: aurora-drift-a 18s ease-in-out infinite;
}

.flow-header-bg::after {
  background-image:
    radial-gradient(ellipse, rgba(180,208,245,0.16) 0%, transparent 50%),
    radial-gradient(ellipse, rgba(170,180,230,0.10) 0%, transparent 50%);
  background-size: 85% 30%, 65% 28%;
  animation: aurora-drift-b 24s ease-in-out infinite;
}
```

### 3.2 Animation: horizontal drift + subtle vertical sway

**Current:** `flow-header-drift-a` / `-b` — full-range omnidirectional position drift.

**New:** Wide horizontal sweep (~70% of bar width) with narrow vertical oscillation (~15% of bar height):

```css
@keyframes aurora-drift-a {
  0%   { background-position: 5% 30%, 85% 55%, 30% 25%; }
  50%  { background-position: 75% 40%, 20% 65%, 70% 35%; }
  100% { background-position: 5% 30%, 85% 55%, 30% 25%; }
}

@keyframes aurora-drift-b {
  0%   { background-position: 80% 45%, 15% 30%; }
  50%  { background-position: 15% 55%, 70% 40%; }
  100% { background-position: 80% 45%, 15% 30%; }
}
```

Key design rule: X movement > Y movement, horizontal is primary, vertical is micro-oscillation. This creates the "wind-blown aurora curtain" illusion.

### 3.3 RENAME KEYFRAMES
`flow-header-drift-a`/`-b` → `aurora-drift-a`/`-b` to reflect new design intent.

---

## 4. Footer Aurora Mirror (new CSS layer)

Footer currently has NO blob layer — only a static glass background + edge line. New design adds its own pseudo-element aurora bands:

```css
.footer-glass::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-repeat: no-repeat;
  background-image:
    radial-gradient(ellipse, rgba(129,174,230,0.10) 0%, transparent 50%),
    radial-gradient(ellipse, rgba(154,194,240,0.08) 0%, transparent 48%);
  background-size: 75% 40%, 65% 35%;
  animation: aurora-mirror 28s ease-in-out infinite;
}

@keyframes aurora-mirror {
  0%   { background-position: 80% 40%, 20% 55%; }
  50%  { background-position: 20% 50%, 75% 38%; }
  100% { background-position: 80% 40%, 20% 55%; }
}
```

Design spec:
- **Direction mirrored:** moves right→left (header moves left→right predominantly)
- **Speed halved:** 28s cycle vs header's 18s
- **Opacity cut ~40%:** blobs at 0.08–0.10 vs header's 0.12–0.22
- **`.footer-glass` must gain `position: relative`** — required for `::before` absolute positioning (currently only has `isolation: isolate` with static positioning)
- **Footer children need `position: relative; z-index: 1`** — ensure links/copyright bar render above the pseudo-element aurora layer. Add a CSS rule: `.footer-glass > * { position: relative; z-index: 1; }`

---

## 5. WebGL Fluid Palette (fluid-header.tsx)

Line ~36–42: Replace the `palette` array:

```typescript
const palette: ColorRGB[] = [
  { r: 0.03, g: 0.12, b: 0.25 },   // 深冰蓝
  { r: 0.04, g: 0.16, b: 0.27 },   // 冰川蓝
  { r: 0.05, g: 0.14, b: 0.26 },   // 极光蓝
  { r: 0.06, g: 0.18, b: 0.25 },   // 冰晶蓝
  { r: 0.04, g: 0.14, b: 0.23 },   // 霜蓝
];
```

---

## 6. Edge Flow Lines (Header + Footer)

### 6.1 Header bottom edge (unified-header.tsx line ~244)

```tsx
<div className="absolute bottom-0 left-0 right-0 h-px z-30" style={{
  background: 'linear-gradient(90deg, transparent 0%, #9ec5f0 20%, #6090d8 40%, #88b8f0 50%, #6090d8 60%, #9ec5f0 80%, transparent 100%)',
  backgroundSize: '200% 100%',
  animation: 'header-edge-flow 4s ease-in-out infinite',
}} />
```

### 6.2 Footer top edge (globals.css .footer-edge-line)

```css
.footer-edge-line {
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, #9ec5f0 20%, #6090d8 40%, #88b8f0 50%, #6090d8 60%, #9ec5f0 80%, transparent 100%);
  background-size: 200% 100%;
  animation: header-edge-flow 4s ease-in-out infinite;
}
```

### 6.3 Unification rationale
Both edges share the same keyframe (`header-edge-flow`) and identical color spectrum. They appear as the top and bottom edges of a single ice-blue light curtain, with page content "stretching" it apart.

---

## 7. Unchanged Elements (explicit no-op list)

These elements use independent color systems and are NOT touched:
- Search bar border colors (blue-grey `#dce5f2` → `#2563ae`) — these are brand blue, not cyan
- Navigation text colors (`#0a2540`, `#1d5fa8`)
- Logo and brand title
- Hero section, announcement cards, feature cards — use their own color systems
- All neumorphic classes (neu-*, flow-back, etc.) — shadows derived from `--bg`, not cyan
- Back-to-top button
- Footer link colors (`#26364e` text, `#0891a0` underline — the underline stays teal as it's the decorative accent, not part of header/footer theme)

---

## 8. Reduced Motion

All new animations must respect `@media (prefers-reduced-motion: reduce)`:

```css
@media (prefers-reduced-motion: reduce) {
  .flow-header-bg::before,
  .flow-header-bg::after,
  .footer-glass::before { animation: none; }
  .footer-edge-line { animation: none; }
}
```

Existing reduced-motion rules at globals.css ~2940-2950 already cover `header-edge-flow` via the universal `*` reset — confirm no conflict with new aurora keyframes.

---

## 9. Files to Modify

| File | Changes | Risk |
|------|---------|------|
| `src/app/globals.css` | `.flow-header-bg` bg + pseudo-elements (blobs → bands, colors, keyframes rename). Add `.footer-glass` `position: relative` + `::before` aurora + `> * { z-index: 1 }` + `aurora-mirror` keyframe. Update `.footer-glass` bg/border. Update `.footer-edge-line` gradient. Update reduced-motion. | Medium — 2951-line file, precise edits needed |
| `src/components/unified-header.tsx` | Edge line gradient colors (line ~244–248) | Low — single inline style change |
| `src/components/fluid-header.tsx` | `palette` array (line ~36–42) | Low — 5 value replaces |
| `src/app/home-client.tsx` | No changes (footer edge line lives in globals.css `.footer-edge-line`, content structure unchanged) | None |

---

## 10. Verification Checklist

- [ ] Open :3002 homepage — header background is ice-blue (`#dfe9f7`), not cyan
- [ ] CSS aurora bands visible as wide horizontal ellipses drifting slowly left↔right
- [ ] Hover mouse over header — WebGL fluid ripples in ice-blue tones (g/b ratio visibly shifted from green to blue)
- [ ] Header bottom edge glow line pulses in ice-blue spectrum
- [ ] Scroll to footer — footer glass is ice-blue, aurora blobs drift slowly right→left (mirror direction)
- [ ] Footer top edge line matches header bottom edge (same color, same animation)
- [ ] Take screenshot — compare against current cyan version, verify "flowing design" feel
- [ ] Test `prefers-reduced-motion: reduce` — all animations stop
- [ ] Mobile responsive — aurora bands still visible, no horizontal overflow
