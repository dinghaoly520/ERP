# Ice-Blue Aurora Header & Footer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the public-portal (:3002) header/footer from cyan-green to ice-blue aurora theme — restructure CSS blobs into horizontal aurora bands, add footer mirror layer, update WebGL palette, and unify edge flow lines.

**Architecture:** Three files touched: `globals.css` (header bg + pseudo-elements + footer glass + edge line + reduced motion), `unified-header.tsx` (header edge line inline gradient), `fluid-header.tsx` (WebGL palette array). No structural changes — pure CSS/color replacement.

**Tech Stack:** CSS (Tailwind v4, custom properties), TypeScript/React, WebGL (raw shaders)

## Global Constraints

- All color changes must use ice-blue spectrum (oklch hue ~248-250, not cyan ~195-200)
- Aurora blobs restructured from circular `radial-gradient(circle, ...)` to elliptical `radial-gradient(ellipse, ...)` with wide-X/narrow-Y aspect ratios
- Header animations must show horizontal drift + subtle vertical sway (not omnidirectional)
- Footer must gain aurora mirror pseudo-element with mirrored direction + halved speed
- All new CSS animations must have `prefers-reduced-motion: reduce` fallbacks
- No changes to search bar, nav text, logo, hero/card sections, neumorphic classes, or footer link colors

---

### Task 1: Header base color + aurora band CSS

**Files:**
- Modify: `apps/public-portal/src/app/globals.css:2809-2851`

**Produced:** `.flow-header-bg` with new bg color, elliptical aurora bands, and `aurora-drift-a`/`aurora-drift-b` keyframes

- [ ] **Step 1: Replace `.flow-header-bg` background-color**

In `globals.css`, find the `.flow-header-bg` rule at ~line 2809 and change the `background-color`:

```css
.flow-header-bg {
  background-color: #dfe9f7;  /* was #e2f5f6 — cyan→ice blue */
  isolation: isolate;
}
```

Old string to replace:
```
  background-color: #e2f5f6;
```

New string:
```
  background-color: #dfe9f7;  /* ice-blue aurora base — was #e2f5f6 (cyan) */
```

- [ ] **Step 2: Replace `::before` pseudo-element** — circular blobs → 3 elliptical aurora bands

Replace the entire `.flow-header-bg::before` rule (currently lines 2822-2829):

Old:
```css
.flow-header-bg::before {
  background-image:
    radial-gradient(circle, rgba(94, 207, 214, 0.22) 0%, transparent 60%),
    radial-gradient(circle, rgba(13, 148, 136, 0.15) 0%, transparent 62%);
  background-size: 55% 140%, 50% 130%;
  background-position: 15% 35%, 80% 20%;
  animation: flow-header-drift-a 18s ease-in-out infinite;
}
```

New:
```css
.flow-header-bg::before {
  background-image:
    radial-gradient(ellipse, rgba(129,174,230,0.20) 0%, transparent 55%),
    radial-gradient(ellipse, rgba(86,137,210,0.14) 0%, transparent 55%),
    radial-gradient(ellipse, rgba(154,194,240,0.12) 0%, transparent 55%);
  background-size: 80% 45%, 70% 38%, 60% 30%;
  background-position: 5% 30%, 85% 55%, 30% 25%;
  animation: aurora-drift-a 18s ease-in-out infinite;
}
```

- [ ] **Step 3: Replace `::after` pseudo-element** — circular blobs → 2 elliptical highlight bands

Replace the entire `.flow-header-bg::after` rule (currently lines 2830-2837):

Old:
```css
.flow-header-bg::after {
  background-image:
    radial-gradient(circle, rgba(125, 196, 224, 0.18) 0%, transparent 58%),
    radial-gradient(circle, rgba(181, 232, 224, 0.20) 0%, transparent 60%);
  background-size: 60% 150%, 48% 120%;
  background-position: 50% 72%, 22% 30%;
  animation: flow-header-drift-b 22s ease-in-out infinite;
}
```

New:
```css
.flow-header-bg::after {
  background-image:
    radial-gradient(ellipse, rgba(180,208,245,0.16) 0%, transparent 50%),
    radial-gradient(ellipse, rgba(170,180,230,0.10) 0%, transparent 50%);
  background-size: 85% 30%, 65% 28%;
  background-position: 80% 45%, 15% 30%;
  animation: aurora-drift-b 24s ease-in-out infinite;
}
```

- [ ] **Step 4: Replace old keyframes with new aurora-drift keyframes**

Replace the entire `flow-header-drift-a` and `flow-header-drift-b` keyframe blocks (currently lines 2838-2847):

Old:
```css
@keyframes flow-header-drift-a {
  0%   { background-position: 15% 35%, 80% 20%; }
  50%  { background-position: 68% 62%, 28% 78%; }
  100% { background-position: 15% 35%, 80% 20%; }
}
@keyframes flow-header-drift-b {
  0%   { background-position: 50% 72%, 22% 30%; }
  50%  { background-position: 20% 32%, 75% 60%; }
  100% { background-position: 50% 72%, 22% 30%; }
}
```

New:
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

- [ ] **Step 5: Verify no orphan references to old keyframe names**

Run grep to ensure no remaining references to `flow-header-drift-a` or `flow-header-drift-b`:

```bash
grep -n "flow-header-drift" apps/public-portal/src/app/globals.css
```

Expected: no output (all renamed).

- [ ] **Step 6: Commit**

```bash
git add apps/public-portal/src/app/globals.css
git commit -m "feat: ice-blue aurora header — bg color + elliptical bands + drift keyframes

- Replace .flow-header-bg bg from #e2f5f6 (cyan) to #dfe9f7 (ice blue)
- Restructure ::before/::after from 2 circular blobs to 3+2 elliptical aurora bands
- Rename flow-header-drift-a/b → aurora-drift-a/b with horizontal-drift animation
- Spec section 2.1, 2.2, 3.1, 3.2, 3.3"
```

---

### Task 2: Header edge flow line gradient

**Files:**
- Modify: `apps/public-portal/src/components/unified-header.tsx:244-248`

**Consumes:** Task 1's CSS keyframes (header-edge-flow still exists)

**Produces:** Header bottom edge line with ice-blue gradient

- [ ] **Step 1: Replace the edge line gradient in unified-header.tsx**

Find the edge line div at ~line 244 and change the gradient colors:

Old:
```tsx
      <div className="absolute bottom-0 left-0 right-0 h-px z-30" style={{
        background: 'linear-gradient(90deg, transparent 0%, #5ecfd6 20%, #3db8c4 40%, #a8f0f0 50%, #3db8c4 60%, #5ecfd6 80%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'header-edge-flow 4s ease-in-out infinite',
      }} />
```

New:
```tsx
      <div className="absolute bottom-0 left-0 right-0 h-px z-30" style={{
        background: 'linear-gradient(90deg, transparent 0%, #9ec5f0 20%, #6090d8 40%, #88b8f0 50%, #6090d8 60%, #9ec5f0 80%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: 'header-edge-flow 4s ease-in-out infinite',
      }} />
```

- [ ] **Step 2: Commit**

```bash
git add apps/public-portal/src/components/unified-header.tsx
git commit -m "feat: ice-blue header edge line — cyan→ice-blue gradient

- Replace #5ecfd6/#3db8c4/#a8f0f0 (cyan) → #9ec5f0/#6090d8/#88b8f0 (ice blue)
- Spec section 2.3, 6.1"
```

---

### Task 3: WebGL fluid palette

**Files:**
- Modify: `apps/public-portal/src/components/fluid-header.tsx:36-42`

**Produces:** WebGL fluid simulation renders in ice-blue tones

- [ ] **Step 1: Replace the palette array**

Find the `palette` constant at ~line 36:

Old:
```typescript
    const palette: ColorRGB[] = [
      { r: 0.04, g: 0.20, b: 0.22 },   // 深青
      { r: 0.06, g: 0.24, b: 0.26 },   // 湖蓝
      { r: 0.05, g: 0.18, b: 0.20 },   // 水绿深
      { r: 0.08, g: 0.22, b: 0.28 },   // 青蓝
      { r: 0.03, g: 0.22, b: 0.20 },   // 薄荷绿
    ];
```

New:
```typescript
    const palette: ColorRGB[] = [
      { r: 0.03, g: 0.12, b: 0.25 },   // 深冰蓝
      { r: 0.04, g: 0.16, b: 0.27 },   // 冰川蓝
      { r: 0.05, g: 0.14, b: 0.26 },   // 极光蓝
      { r: 0.06, g: 0.18, b: 0.25 },   // 冰晶蓝
      { r: 0.04, g: 0.14, b: 0.23 },   // 霜蓝
    ];
```

- [ ] **Step 2: Commit**

```bash
git add apps/public-portal/src/components/fluid-header.tsx
git commit -m "feat: ice-blue WebGL fluid palette — cyan→ice-blue

- Reduce green channel ~30-40%, keep blue channel high
- Spec section 2.4, 5"
```

---

### Task 4: Footer glass base + edge line

**Files:**
- Modify: `apps/public-portal/src/app/globals.css:2856-2869`

**Consumes:** Task 1's CSS (same file, different section)

- [ ] **Step 1: Update `.footer-glass` background and border-top**

Find the `.footer-glass` rule at ~line 2856:

Old:
```css
.footer-glass {
  background: oklch(0.965 0.02 195 / 0.88);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  border-top: 1px solid oklch(0.87 0.03 200 / 0.38);
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7);
  isolation: isolate;
}
```

New:
```css
.footer-glass {
  position: relative;                              /* anchor for ::before aurora band */
  background: oklch(0.965 0.015 250 / 0.88);      /* was 0.02 195 — cyan→ice blue */
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  border-top: 1px solid oklch(0.88 0.025 248 / 0.38); /* was 0.87 0.03 200 */
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7);
  isolation: isolate;
}
.footer-glass > * {
  position: relative;
  z-index: 1;   /* ensure links/copyright bar render above ::before aurora */
}
```

- [ ] **Step 2: Update `.footer-edge-line` gradient**

Find the `.footer-edge-line` rule at ~line 2864:

Old:
```css
.footer-edge-line {
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, #5ecfd6 20%, #3db8c4 40%, #a8f0f0 50%, #3db8c4 60%, #5ecfd6 80%, transparent 100%);
  background-size: 200% 100%;
  animation: header-edge-flow 4s ease-in-out infinite;
}
```

New:
```css
.footer-edge-line {
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, #9ec5f0 20%, #6090d8 40%, #88b8f0 50%, #6090d8 60%, #9ec5f0 80%, transparent 100%);
  background-size: 200% 100%;
  animation: header-edge-flow 4s ease-in-out infinite;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/public-portal/src/app/globals.css
git commit -m "feat: ice-blue footer glass + edge line

- .footer-glass: position:relative, bg 195→250 oklch, border 200→248
- .footer-glass > *: z-index:1 for content above aurora layer
- .footer-edge-line: cyan→ice-blue gradient
- Spec sections 2.1, 4, 6.2"
```

---

### Task 5: Footer aurora mirror pseudo-element

**Files:**
- Modify: `apps/public-portal/src/app/globals.css` — append after `.footer-glass > *` rule (added in Task 4)

**Consumes:** Task 4's `.footer-glass` (now has `position: relative`)

- [ ] **Step 1: Add `.footer-glass::before` aurora mirror + `aurora-mirror` keyframe**

Insert after the `.footer-glass > *` rule block. Add the footer aurora pseudo-element and its keyframe immediately before the existing `.footer-edge-line` rule (~line 2864 area):

Add the following new CSS block:

```css
/* ── 页脚极光倒影 — Header 极光带的镜面，方向镜像 + 速度减半 + 不透明度降低 ── */
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
  background-position: 80% 40%, 20% 55%;
  animation: aurora-mirror 28s ease-in-out infinite;
}
@keyframes aurora-mirror {
  0%   { background-position: 80% 40%, 20% 55%; }
  50%  { background-position: 20% 50%, 75% 38%; }
  100% { background-position: 80% 40%, 20% 55%; }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/public-portal/src/app/globals.css
git commit -m "feat: footer aurora mirror — mirrored bands at half speed

- .footer-glass::before: 2 elliptical aurora bands, right→left drift
- @keyframes aurora-mirror: 28s cycle (vs header's 18s), mirrored direction
- Opacity reduced 40% vs header bands
- Spec section 4"
```

---

### Task 6: Reduced motion

**Files:**
- Modify: `apps/public-portal/src/app/globals.css:2848-2851`

**Consumes:** Tasks 1, 5 (aurora keyframes must exist)

- [ ] **Step 1: Update the existing reduced-motion block**

Find the existing `@media (prefers-reduced-motion: reduce)` block at ~line 2848:

Old:
```css
@media (prefers-reduced-motion: reduce) {
  .flow-header-bg::before,
  .flow-header-bg::after { animation: none; }
}
```

New:
```css
@media (prefers-reduced-motion: reduce) {
  .flow-header-bg::before,
  .flow-header-bg::after,
  .footer-glass::before { animation: none; }
}
```

- [ ] **Step 2: Also add `.footer-edge-line` disable to the existing footer reduced-motion block**

Find the footer reduced-motion block at ~line 2890:

Old:
```css
@media (prefers-reduced-motion: reduce) {
  .footer-edge-line { animation: none; }
  .footer-link, .footer-link::after { transition: none; }
}
```

This block is already correct — no change needed. Verify it exists.

- [ ] **Step 3: Commit**

```bash
git add apps/public-portal/src/app/globals.css
git commit -m "feat: reduced motion for aurora animations

- Add .footer-glass::before to header reduced-motion block
- Spec section 8"
```

---

### Task 7: Visual verification

**Files:** None (verification only)

- [ ] **Step 1: Start the dev server**

```bash
cd apps/public-portal && pnpm dev:public
```

Wait for the server to start on :3002.

- [ ] **Step 2: Take a screenshot of the current page for comparison**

Use the browser tools to take a screenshot.

- [ ] **Step 3: Verify header visual checks against spec checklist**

Open http://localhost:3002 and verify:

- [ ] Header background is ice-blue (`#dfe9f7`), not cyan
- [ ] CSS aurora bands visible as wide horizontal ellipses drifting left↔right
- [ ] Header bottom edge glow line pulses in ice-blue spectrum
- [ ] WebGL fluid appears in ice-blue tones (move mouse over header)

- [ ] **Step 4: Verify footer visual checks**

Scroll to footer and verify:

- [ ] Footer glass is ice-blue (oklch 250 hue), not cyan-green
- [ ] Footer aurora blobs drift right→left (mirrored direction)
- [ ] Footer top edge line matches header bottom edge (same gradient, same animation)
- [ ] Footer content (links, copyright) renders above the aurora layer (not hidden)

- [ ] **Step 5: Verify reduced motion**

Enable `prefers-reduced-motion: reduce` in browser DevTools (Rendering tab) and verify all aurora animations stop.

- [ ] **Step 6: Verify mobile responsive**

Resize browser to mobile width (375px). Verify aurora bands still visible, no horizontal overflow.

- [ ] **Step 7: Final screenshot and compare**

Take final screenshot and compare against pre-change screenshot. Confirm "flowing design" feel — verify the aurora bands create a unified ice-blue curtain from header through footer.
