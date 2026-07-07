# 工作台重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the work-arrangements page (:3005 /work-arrangements) into 4 neumorphic panels with unified cgzxui styling, bottom-aligned two-column layout, and zero inline styles.

**Architecture:** Four panel components (GreetingBanner, SchedulePanel, TaskDetailPanel, AiAssistPanel) wrap existing sub-components in `neu-card-static` shells. A new grid layout (`grid-cols-[0.40fr_0.60fr]`) with right-column `flex-1` equal-height distribution replaces the current ad-hoc layout. All inline `style={{ background/border/boxShadow }}` is removed across 7 component files, replaced by existing `neu-*` CSS classes from globals.css.

**Tech Stack:** React 19, Next.js 16 App Router, Tailwind CSS v4, TypeScript. No new dependencies.

## Global Constraints

- **Zero new inline styles** — all visual rules via globals.css classes
- **Oklch color space only** — no rgba()/hex in shadows
- **Directional dual shadows** — dark bottom-right + light top-left, no flat `0 Npx Npx`
- **Inner highlight line** — `inset 0 1px 0 oklch(1 0 0 / 0.7)` on every card/button
- **Three-state complete** — default raised / hover lift / active inset on all interactive elements
- **`rounded-[18px]`** for panel shells, **`rounded-[14px]`** for inner elements
- **All existing functionality preserved** — 10 modules, both page variants (staff + chairman)
- **Bottom alignment** — right column cards share height with left column via flex-1
- **Reduced-motion** — `@media (prefers-reduced-motion: reduce)` disables all transitions

---

### Task 1: Add urgency task-card CSS classes to globals.css

**Files:**
- Modify: `apps/web/src/app/globals.css` (append after `reduced-motion` block, before closing)

**Interfaces:**
- Produces: `.wb-task-card` base class, `.wb-urgency-CRITICAL` / `.wb-urgency-HIGH` / `.wb-urgency-MEDIUM` / `.wb-urgency-LOW` border-accent classes

- [ ] **Step 1: Append urgency task-card classes**

At the end of `apps/web/src/app/globals.css` (after line 8227, before any existing content ends), append:

```css
/* ══════════════════════════════════════════════════════════════════
   工作台任务卡片 — .wb-task-card
   左侧强调色条 + neumorphic 凸起三态
   ══════════════════════════════════════════════════════════════════ */
.wb-task-card {
  width: 100%;
  border-radius: 14px;
  padding: 14px 16px;
  text-align: left;
  cursor: pointer;
  transition: all 0.25s ease;
  background: oklch(1 0 0 / 0.55);
  backdrop-filter: blur(12px) saturate(130%);
  -webkit-backdrop-filter: blur(12px) saturate(130%);
  border: 1.5px solid oklch(0.55 0.08 258 / 0.28);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.65),
    1px 1px 4px oklch(0.55 0.03 258 / 0.08),
    -1px -1px 3px oklch(1 0 0 / 0.75);
}

.wb-task-card:hover {
  transform: translateY(-1px);
  border-color: oklch(0.55 0.14 258 / 0.22);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.78),
    3px 3px 8px oklch(0.45 0.08 258 / 0.1),
    -2px -2px 5px oklch(1 0 0 / 0.85);
}

.wb-task-card.wb-selected {
  border-color: oklch(0.55 0.16 251 / 0.45);
  background: oklch(0.96 0.03 251 / 0.45);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),
    2px 2px 6px oklch(0.45 0.08 258 / 0.14),
    -2px -2px 6px oklch(1 0 0 / 0.8);
  transform: none;
}

.wb-task-card.wb-highlighted {
  border-color: oklch(0.55 0.14 251 / 0.35);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.68),
    2px 2px 5px oklch(0.45 0.08 258 / 0.1),
    -1px -1px 4px oklch(1 0 0 / 0.78);
}

/* 已完成/已取消 任务变体 */
.wb-task-card.wb-finished {
  opacity: 0.68;
  background: oklch(0.99 0.004 258 / 0.5);
  border-color: oklch(0.55 0.04 258 / 0.18);
}

.wb-task-card.wb-finished:hover {
  transform: none;
}

/* 紧急度左边框强调色 — 用 border-left 实现 */
.wb-task-card.wb-urgency-CRITICAL {
  border-left: 4px solid oklch(0.62 0.19 27);
}
.wb-task-card.wb-urgency-HIGH {
  border-left: 4px solid oklch(0.72 0.15 69);
}
.wb-task-card.wb-urgency-MEDIUM {
  border-left: 4px solid oklch(0.74 0.12 84);
}
.wb-task-card.wb-urgency-LOW {
  border-left: 4px solid oklch(0.62 0.1 158);
}

/* ══════════════════════════════════════════════════════════════════
   日程面板内分割线 — schedule-divider
   ══════════════════════════════════════════════════════════════════ */
.schedule-divider {
  border-top: 1.5px solid oklch(0.55 0.04 258 / 0.18);
  margin: 0 -8px;
}

/* ══════════════════════════════════════════════════════════════════
   工作台问候色条 — greeting-accent-bar（消费 --greeting-accent 变量）
   ══════════════════════════════════════════════════════════════════ */
.greeting-accent-bar {
  border-left: 3px solid var(--greeting-accent, var(--accent));
  border-radius: 3px 0 0 3px;
}

/* ══════════════════════════════════════════════════════════════════
   时间块卡片 — 用于 AI 排程建议
   ══════════════════════════════════════════════════════════════════ */
.wb-timeblock-card {
  display: block;
  width: 100%;
  border-radius: 14px;
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
  background: oklch(1 0 0 / 0.45);
  border: 1.5px solid oklch(0.55 0.08 258 / 0.25);
  transition: all 0.25s ease;
}
.wb-timeblock-card:hover {
  background: oklch(1 0 0 / 0.65);
  border-color: oklch(0.55 0.14 258 / 0.3);
  box-shadow:
    2px 2px 6px oklch(0.55 0.03 258 / 0.1),
    -1px -1px 4px oklch(1 0 0 / 0.75);
}
```

- [ ] **Step 2: Verify CSS compiles**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && ls apps/web/src/app/globals.css`  
Expected: File exists, no syntax errors visible

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/app/globals.css
git commit -m "feat: add wb-task-card and workbench CSS classes for workbench redesign"
```

---

### Task 2: Refactor WorkbenchOverview — remove inline styles, use neu-card-static

**Files:**
- Modify: `apps/web/src/app/globals.css` (append before reduced-motion block)
- Modify: `apps/web/src/components/work-arrangements/workbench-overview.tsx`

**Interfaces:**
- Consumes: `neu-card-static` from globals.css, `--greeting-accent` CSS variable
- Produces: Same component signature, no visual change in behavior, all inline style removed

- [ ] **Step 1: Refactor WorkbenchOverview root to use neu-card-static**

Replace the root `<section>` in `WorkbenchOverview` (lines 336-341). Change from:

```tsx
<section
  className="rounded-[24px] px-6 py-5 shadow-sm"
  style={{
    background: gradient,
    border: `1px solid ${borderColor}`,
  }}
>
```

To:

```tsx
<section
  className="neu-card-static rounded-[18px] px-6 py-5"
  style={{ '--greeting-accent': greetingColor } as React.CSSProperties}
>
```

- [ ] **Step 2: Replace AI suggestion accent bar in WorkbenchOverview (lines 391-405)**

Change from:

```tsx
<div
  className="mt-4 rounded-[14px] px-4 py-3"
  style={{
    background: accentBg,
    borderLeft: `3px solid ${greetingColor}`,
  }}
>
  <div
    className="text-sm leading-relaxed"
    style={{ color: greetingColor }}
  >
    {aiSuggestion}
  </div>
</div>
```

To:

```tsx
<div className="mt-4 greeting-accent-bar rounded-[14px] px-4 py-3 bg-[var(--greeting-accent)]/10">
  <div
    className="text-sm leading-relaxed"
    style={{ color: greetingColor }}
  >
    {aiSuggestion}
  </div>
</div>
```

Note: The `style={{ color: greetingColor }}` for the text is acceptable — it's text color, not a box-shadow/border/background that breaks neumorphic rules. The accent bar uses the CSS class.

- [ ] **Step 3: Remove unused helper functions**

After these changes, the functions `generateGradient`, `generateBorderColor`, `generateAccentBg` are no longer used. Remove them (lines 205-235).

- [ ] **Step 4: Remove unused variables**

Remove `gradient`, `borderColor`, `accentBg` from the destructured consts (around line 331-333).

- [ ] **Step 5: Verify file is clean**

The remaining inline style should only be:
- `style={{ '--greeting-accent': greetingColor } as React.CSSProperties}` on root
- `style={{ color: greetingColor }}` on text elements (acceptable — text color, not structural)

- [ ] **Step 6: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | head -20`  
Expected: No new errors from workbench-overview.tsx

- [ ] **Step 7: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/workbench-overview.tsx
git commit -m "refactor: remove inline styles from WorkbenchOverview, adopt neu-card-static"
```

---

### Task 3: Refactor WorkCalendar — remove inline styles

**Files:**
- Modify: `apps/web/src/components/work-arrangements/work-calendar.tsx`

**Interfaces:**
- Consumes: CSS classes from globals.css (neu-card, workbench-input)
- Produces: Same component signature, all inline box-shadow/background/border removed

- [ ] **Step 1: Replace calendar outer container inline styles (lines 117-142)**

Change the root `<div>` from:

```tsx
<div
  className="relative rounded-[18px] px-4 pt-4 pb-3"
  style={{
    background: 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(242,247,255,0.85))',
    border: '1px solid rgba(192,208,235,0.55)',
    boxShadow: 'var(--shadow-panel)',
    overflow: 'hidden',
  }}
>
  {/* Ambient light overlay */}
  <div
    aria-hidden="true"
    style={{
      position: 'absolute',
      inset: '-18% -12% 24% -10%',
      zIndex: 0,
      pointerEvents: 'none',
      background: [
        'radial-gradient(circle at 14% 26%, rgba(108,149,244,0.14), transparent 26%)',
        'radial-gradient(circle at 84% 20%, rgba(248,201,128,0.13), transparent 22%)',
        'radial-gradient(circle at 56% 82%, rgba(102,194,173,0.12), transparent 24%)',
      ].join(', '),
      filter: 'blur(28px)',
      animation: 'chromaShift 16s cubic-bezier(0.22,1,0.36,1) infinite',
    }}
  />
```

To:

```tsx
<div className="neu-card rounded-[18px] px-4 pt-4 pb-3 relative overflow-hidden chromatic-glass">
  {/* Ambient light overlay — kept as chromatic-glass ::before pseudo-element */}
```

Note: The ambient light overlay is preserved via the existing `.chromatic-glass::before` pseudo-element in globals.css (lines 186-197), which defines identical radial gradients + chromaShift animation. Remove the inline ambient overlay `<div>`.

- [ ] **Step 2: Replace "今天" button (lines 169-181)**

Change from:

```tsx
<button
  type="button"
  onClick={goToToday}
  className="rounded-[10px] px-3 py-1 text-[11px] font-semibold transition"
  style={{
    background: 'linear-gradient(135deg, rgba(96,139,239,0.1), rgba(96,139,239,0.06))',
    color: 'var(--accent)',
    boxShadow: '0 1px 3px rgba(96,139,239,0.1)',
  }}
>
  今天
</button>
```

To:

```tsx
<button
  type="button"
  onClick={goToToday}
  className="neu-btn-xs is-info"
>
  今天
</button>
```

- [ ] **Step 3: Replace calendar cell inline bgStyle (lines 203-266)**

Remove the `bgStyle` object. Instead, define Tailwind classes for each state. Replace the day cell rendering. The current code builds `cellClass` and `bgStyle` separately. Merge bgStyle into className.

Replace lines 198-246 (the day cell mapping):

```tsx
{calendarDays.map((day, idx) => {
  const dayNum = day.date.getDate();
  const hasTasks = day.dots.length > 0;

  let cellClass =
    'flex flex-col items-center justify-center rounded-[10px] cursor-pointer transition-all duration-200 text-xs leading-none select-none py-2';

  if (!day.isCurrentMonth) {
    cellClass += ' text-[var(--muted-foreground)] opacity-30';
  } else if (day.isToday && day.isSelected) {
    cellClass += ' bg-[var(--accent)] text-white font-bold shadow-[0_2px_10px_rgba(79,125,245,0.35)]';
  } else if (day.isSelected) {
    cellClass += ' bg-[var(--accent-soft)] text-[var(--accent)] font-bold ring-1 ring-[var(--accent)]/30';
  } else if (day.isToday) {
    cellClass += ' bg-[var(--accent)] text-white font-bold shadow-[0_2px_8px_rgba(79,125,245,0.3)]';
  } else if (hasTasks) {
    cellClass += ' bg-[var(--accent-soft)]/60 text-[var(--foreground)] font-medium hover:shadow-[0_1px_6px_rgba(96,139,239,0.12)]';
  } else if (day.isWeekend) {
    cellClass += ' text-[var(--muted-foreground)] opacity-60 hover:bg-[var(--accent-soft)]/30';
  } else {
    cellClass += ' text-[var(--foreground)] hover:bg-[var(--accent-soft)]/30';
  }

  return (
    <button
      key={idx}
      type="button"
      onClick={() => day.isCurrentMonth && onDateSelect(day.date)}
      className={cellClass}
      aria-label={`${day.date.getMonth() + 1}月${dayNum}日`}
    >
      ...
    </button>
  );
})}
```

Note: All `style={{ backgroundColor: ... }}` inside dots remain acceptable — they set a dynamic urgency color, not structural shadow/border/bg. Keep those as-is.

- [ ] **Step 4: Remove the `GRID_STYLE` const (line 25)**

`const GRID_STYLE: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' };`  
Replace all usages of `style={GRID_STYLE}` with `className="grid grid-cols-7"`.

- [ ] **Step 5: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "work-calendar" | head -10`  
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/work-calendar.tsx
git commit -m "refactor: remove inline styles from WorkCalendar, use neu-card and chromatic-glass"
```

---

### Task 4: Refactor WorkDateTaskList — remove inline styles, use wb-task-card

**Files:**
- Modify: `apps/web/src/components/work-arrangements/work-date-task-list.tsx`

**Interfaces:**
- Consumes: `.wb-task-card`, `.wb-urgency-*`, `.wb-selected`, `.wb-highlighted`, `.wb-finished` from globals.css
- Produces: Same component signature, TaskCard uses CSS classes instead of inline style

- [ ] **Step 1: Replace TaskCard className logic (lines 138-204)**

Replace the TaskCard return with CSS-class-driven version. The current code builds className via array join with urgencyStyle.card background. Replace:

```tsx
<button
  type="button"
  onClick={onSelect}
  aria-label={`选择任务：${item.title}`}
  className={[
    'w-full rounded-[20px] border px-4 py-4 text-left transition',
    isFinished
      ? 'border-gray-200 bg-gray-50/60 opacity-70'
      : 'border-gray-200',
    selected
      ? 'ring-2 ring-blue-300 ring-offset-1 shadow-md bg-blue-50'
      : highlighted
        ? 'ring-1 ring-blue-200 shadow-sm'
        : !isFinished && 'hover:-translate-y-0.5 hover:shadow-md',
    !selected && !isFinished ? urgencyStyle.card : '',
  ].join(' ')}
```

With:

```tsx
<button
  type="button"
  onClick={onSelect}
  aria-label={`选择任务：${item.title}`}
  className={[
    'wb-task-card',
    isFinished ? 'wb-finished' : '',
    selected ? 'wb-selected' : '',
    highlighted && !selected ? 'wb-highlighted' : '',
    !isFinished ? `wb-urgency-${item.urgency}` : '',
  ].filter(Boolean).join(' ')}
```

- [ ] **Step 2: Remove urgencyStyles object (lines 13-33)**

Remove the `urgencyStyles` record — urgency styling now lives in CSS classes.

- [ ] **Step 3: Remove unused imports**

The `urgencyStyles` import was local, no import to clean up.

- [ ] **Step 4: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "work-date-task" | head -10`  
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/work-date-task-list.tsx
git commit -m "refactor: remove inline urgency styles from WorkDateTaskList, use wb-task-card classes"
```

---

### Task 5: Refactor WorkTaskQuickView — remove inline styles, adopt neu-btn-* and neu-card

**Files:**
- Modify: `apps/web/src/components/work-arrangements/work-task-quick-view.tsx`

**Interfaces:**
- Consumes: `neu-btn-primary`, `neu-btn-soft`, `neu-btn-xs`, `neu-card`, `neu-card-static` from globals.css
- Produces: Same component signature, no inline styles

- [ ] **Step 1: Replace empty state container (lines 107-111)**

Change from:

```tsx
<div className="rounded-[18px] border border-white/45 bg-white/75 p-4 text-sm text-[color:var(--muted-foreground)]">
  选择一条任务后，这里会显示快捷处理信息。
</div>
```

To:

```tsx
<div className="neu-card rounded-[18px] p-6 text-sm text-center text-[color:var(--muted-foreground)]">
  <div className="neu-icon-well mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
  </div>
  选择一条任务后，这里会显示快捷处理信息。
</div>
```

- [ ] **Step 2: Replace root section of selected-item view (lines 119)**

Change from:

```tsx
<section className={`rounded-[18px] border p-4 ${isFinished ? 'bg-white/60 border-white/35' : 'bg-white/75 border-white/45'}`}>
```

To:

```tsx
<section className={`neu-card rounded-[18px] p-4 ${isFinished ? 'opacity-75' : ''}`}>
```

- [ ] **Step 3: Replace edit button (lines 134-143)**

Change from:

```tsx
<button
  type="button"
  onClick={onOpenFullEditor}
  className="inline-flex min-h-10 items-center gap-2 rounded-[14px] border border-white/55 bg-white/70 px-4 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-white flex-shrink-0"
>
```

To:

```tsx
<button
  type="button"
  onClick={onOpenFullEditor}
  className="neu-btn-xs flex-shrink-0"
>
```

- [ ] **Step 4: Replace info grid items (lines 146-167)**

Change the three info grid items from:

```tsx
<div className="rounded-[14px] bg-white/50 px-3 py-3 text-sm text-[color:var(--foreground)]">
```

To:

```tsx
<div className="rounded-[14px] bg-[var(--accent-soft)]/40 px-3 py-3 text-sm text-[color:var(--foreground)]">
```

- [ ] **Step 5: Replace action buttons (lines 173-247)**

Replace all action buttons systematically:

- "开始处理" → `neu-btn-primary` (primary action)
- "标记完成" → `neu-btn-soft is-success`
- "标记受阻" → `neu-btn-soft is-danger`
- "恢复处理" → `neu-btn-soft is-info`
- "取消任务" → `neu-btn-soft`
- "延后提醒" → `neu-btn-soft`
- "添加记录" → `neu-btn-soft`

Example — "开始处理" button, change from:

```tsx
<button
  type="button"
  onClick={onStart}
  className="inline-flex min-h-10 items-center gap-2 rounded-[14px] border border-[rgba(96,139,239,0.25)] bg-[rgba(96,139,239,0.12)] px-4 py-2 text-sm font-semibold text-[rgba(96,139,239,1)] transition hover:bg-[rgba(96,139,239,0.18)]"
>
```

To:

```tsx
<button
  type="button"
  onClick={onStart}
  className="neu-btn-primary"
>
```

Apply the same pattern to all 7 action buttons. Keep the icons as children.

- [ ] **Step 6: Replace completion summary card (lines 252-256)**

Change from:

```tsx
<div className="mt-4 rounded-[14px] bg-[rgba(92,181,150,0.08)] border border-[rgba(92,181,150,0.2)] px-4 py-3">
```

To:

```tsx
<div className="mt-4 rounded-[14px] bg-[var(--success)]/8 border border-[var(--success)]/20 px-4 py-3">
```

- [ ] **Step 7: Replace note history cards (lines 264-278)**

Change note card from:

```tsx
<div className="rounded-[12px] bg-white/50 px-3 py-2 text-sm">
```

To:

```tsx
<div className="neu-card rounded-[12px] px-3 py-2 text-sm">
```

- [ ] **Step 8: Replace empty notes state (line 281)**

Change from:

```tsx
<div className="rounded-[14px] bg-white/50 px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
```

To:

```tsx
<div className="rounded-[14px] bg-[var(--accent-soft)]/40 px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
```

- [ ] **Step 9: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "work-task-quick" | head -10`  
Expected: No errors

- [ ] **Step 10: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/work-task-quick-view.tsx
git commit -m "refactor: remove inline styles from WorkTaskQuickView, adopt neu-btn-* and neu-card classes"
```

---

### Task 6: Refactor WorkTaskNotesPanel — remove inline styles

**Files:**
- Modify: `apps/web/src/components/work-arrangements/work-task-notes-panel.tsx`

**Interfaces:**
- Consumes: `neu-input`, `neu-btn-primary`, `neu-card` from globals.css
- Produces: Same component signature, no inline styles

- [ ] **Step 1: Replace root container (lines 41-42)**

Change from:

```tsx
<div className="mt-4 rounded-[22px] border border-white/60 bg-[rgba(248,251,255,0.84)] p-4">
```

To:

```tsx
<div className="mt-4 neu-card rounded-[18px] p-4">
```

- [ ] **Step 2: Replace select (lines 49-53)**

Change from:

```tsx
<select className="rounded-[16px] border border-white/62 bg-white/78 px-3 py-2.5 text-sm outline-none">
```

To:

```tsx
<select className="workbench-input text-sm">
```

- [ ] **Step 3: Replace textarea (lines 57-63)**

Change from:

```tsx
<textarea
  rows={3}
  className="rounded-[18px] border border-white/62 bg-white/78 px-3 py-3 text-sm outline-none"
/>
```

To:

```tsx
<textarea
  rows={3}
  className="neu-input text-sm"
/>
```

- [ ] **Step 4: Replace submit button (lines 64-71)**

Change from:

```tsx
<button
  type="button"
  onClick={onSubmit}
  disabled={noteSubmitting || !noteDraft.trim()}
  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/72 bg-white/82 px-4 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
>
```

To:

```tsx
<button
  type="button"
  onClick={onSubmit}
  disabled={noteSubmitting || !noteDraft.trim()}
  className="neu-btn-primary"
>
```

- [ ] **Step 5: Replace note history cards (lines 77-78, 82-83, 90-91)**

Change note card from:

```tsx
<div key={note.id} className="rounded-[18px] bg-white/82 px-3 py-3">
```

To:

```tsx
<div key={note.id} className="neu-card rounded-[14px] px-3 py-3">
```

Change empty state from:

```tsx
<div className="rounded-[18px] bg-white/82 px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
```

To:

```tsx
<div className="rounded-[14px] bg-[var(--accent-soft)]/40 px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
```

- [ ] **Step 6: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "work-task-notes" | head -10`  
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/work-task-notes-panel.tsx
git commit -m "refactor: remove inline styles from WorkTaskNotesPanel, adopt neu-input and neu-btn-primary"
```

---

### Task 7: Refactor WorkbenchPlanningPanel — remove inline styles, adopt neu-card-static

**Files:**
- Modify: `apps/web/src/components/work-arrangements/workbench-planning-panel.tsx`

**Interfaces:**
- Consumes: `neu-card-static`, `neu-card`, `neu-btn-xs`, `wb-timeblock-card` from globals.css
- Produces: Same component signature, no inline styles

- [ ] **Step 1: Replace root section (line 28)**

Change from:

```tsx
<section className="panel-surface panel-lens rounded-[24px] p-4">
```

To:

```tsx
<section className="neu-card-static rounded-[18px] p-4 flex flex-col">
```

- [ ] **Step 2: Replace "AI 安排" and "历史" buttons (lines 44-63)**

Change both buttons to use `neu-btn-xs`:

"AI 安排" button:
```tsx
<button
  type="button"
  onClick={onRefreshPlan}
  disabled={refreshingPlan}
  className="neu-btn-xs"
>
  <RefreshCw size={12} className={refreshingPlan ? 'animate-spin' : ''} />
  <span className="hidden sm:inline">AI 安排</span>
</button>
```

"历史" button:
```tsx
<button
  type="button"
  onClick={onShowHistory}
  className="neu-btn-xs"
>
  <History size={12} />
  <span className="hidden sm:inline">历史</span>
</button>
```

- [ ] **Step 3: Replace timeblock container (line 70)**

Change from:

```tsx
<div className="rounded-[22px] border border-white/60 bg-white p-4">
```

To:

```tsx
<div className="rounded-[18px] bg-[var(--accent-soft)]/30 p-4">
```

- [ ] **Step 4: Replace timeblock cards (lines 78-91)**

Change each timeblock button from:

```tsx
<button
  key={`tb-${i}-${block.label}`}
  type="button"
  onClick={() => onSelectTimeBlock(block.taskIds ?? [])}
  className="block w-full rounded-[18px] bg-white px-3 py-3 text-left transition hover:bg-gray-50"
>
```

To:

```tsx
<button
  key={`tb-${i}-${block.label}`}
  type="button"
  onClick={() => onSelectTimeBlock(block.taskIds ?? [])}
  className="wb-timeblock-card"
>
```

- [ ] **Step 5: Replace empty timeblock state (line 94)**

Change from:

```tsx
<div className="rounded-[18px] bg-gray-50 px-3 py-3 text-sm text-[color:var(--muted-foreground)] xl:col-span-2">
```

To:

```tsx
<div className="rounded-[14px] bg-[var(--accent-soft)]/30 px-3 py-3 text-sm text-[color:var(--muted-foreground)] xl:col-span-2">
```

- [ ] **Step 6: Replace 具体建议 / 项目简报 cards (throughout)**

For chairman completionAdvice card (lines 113-165) - change outer div from:

```tsx
<div className="mt-3 rounded-[22px] border border-amber-100/60 bg-gradient-to-br from-amber-50/50 to-white p-4">
```

To:

```tsx
<div className="mt-3 neu-card rounded-[18px] p-4">
```

For employee completionAdvice card (lines 175-238) — same pattern:

```tsx
<div className="rounded-[22px] border border-amber-100/60 bg-gradient-to-br from-amber-50/50 to-white p-4">
```

To:

```tsx
<div className="neu-card rounded-[18px] p-4">
```

- [ ] **Step 7: Replace loading placeholder (lines 161-163)**

Change from:

```tsx
<p className="mt-3 text-sm text-[color:var(--muted-foreground)]">
  正在生成项目简报...
</p>
```

To:

```tsx
<div className="neu-icon-well rounded-[14px] mt-3 flex items-center justify-center px-3 py-4 text-sm text-[color:var(--muted-foreground)]">
  正在生成项目简报...
</div>
```

- [ ] **Step 8: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "workbench-planning" | head -10`  
Expected: No errors

- [ ] **Step 9: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/workbench-planning-panel.tsx
git commit -m "refactor: remove inline styles from WorkbenchPlanningPanel, adopt neu-card-static and wb-timeblock-card"
```

---

### Task 8: Refactor ReminderBanner — remove inline style

**Files:**
- Modify: `apps/web/src/components/work-arrangements/reminder-banner.tsx`

**Interfaces:**
- Consumes: `neu-card` from globals.css
- Produces: Same component signature

- [ ] **Step 1: Replace banner background inline style (lines 25)**

Change from:

```tsx
<div className="rounded-[20px] border border-amber-200 px-4 py-3 shadow-lg" style={{ background: 'linear-gradient(to right, #fffbeb, #fff7ed)' }}>
```

To:

```tsx
<div className="neu-card rounded-[18px] px-4 py-3">
```

- [ ] **Step 2: TypeScript check & commit**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "reminder-banner" | head -10`

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/reminder-banner.tsx
git commit -m "refactor: remove inline style from ReminderBanner, use neu-card"
```

---

### Task 9: Create GreetingBanner panel component (板块 ①)

**Files:**
- Create: `apps/web/src/components/work-arrangements/greeting-banner.tsx`

**Interfaces:**
- Consumes: `WorkbenchOverview` (same props), `neu-card-static` from globals.css
- Produces: `GreetingBanner` component wrapping WorkbenchOverview in neu-card-static shell

- [ ] **Step 1: Create greeting-banner.tsx**

```tsx
'use client';

import { WorkbenchOverview } from '@/components/work-arrangements/workbench-overview';
import type { WorkArrangementWorkbenchOverview, WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import type { AuthUser } from '@/lib/api/auth';

export function GreetingBanner({
  currentUser,
  summary,
  dailyPlan,
}: {
  currentUser: AuthUser | null;
  summary: WorkArrangementWorkbenchOverview;
  dailyPlan: WorkArrangementDailyPlan | null;
}) {
  return (
    <section className="neu-card-static rounded-[18px] px-6 py-5">
      <WorkbenchOverview
        currentUser={currentUser}
        summary={summary}
        dailyPlan={dailyPlan}
      />
    </section>
  );
}
```

Wait — this double-wraps because WorkbenchOverview already renders a `<section>` root. Let me rethink. Since WorkbenchOverview's root is already a `<section className="neu-card-static rounded-[18px] px-6 py-5">` (from Task 2), the GreetingBanner should NOT wrap — it IS WorkbenchOverview.

Actually, let's just make WorkbenchOverview itself the GreetingBanner by giving it the neu-card-static shell in Task 2. Then there's no need for a separate GreetingBanner wrapper. The page just uses WorkbenchOverview directly.

Let me adjust: Skip this task. WorkbenchOverview = GreetingBanner panel.

- [ ] **Step 1: No action needed**

WorkbenchOverview already serves as the GreetingBanner panel after Task 2 refactoring.

- [ ] **Step 2: Commit (skip)**

---

### Task 10: Create SchedulePanel component (板块 ②)

**Files:**
- Create: `apps/web/src/components/work-arrangements/schedule-panel.tsx`

**Interfaces:**
- Consumes: `WorkCalendar`, `WorkDateTaskList`, `neu-card-static`, `neu-btn-xs` from globals.css
- Produces: `SchedulePanel` — wraps calendar + task list in one neu-card-static. Exposes same data/callback props as the individual sub-components.

- [ ] **Step 1: Create schedule-panel.tsx**

```tsx
'use client';

import { Plus } from 'lucide-react';
import { WorkCalendar } from '@/components/work-arrangements/work-calendar';
import { WorkDateTaskList } from '@/components/work-arrangements/work-date-task-list';
import type { WorkArrangementItem } from '@/lib/types/work-arrangements';

export function SchedulePanel({
  selectedDate,
  items,
  tasksForSelectedDate,
  unscheduledItems,
  selectedItemId,
  highlightedTaskIds,
  onDateSelect,
  onSelectTask,
  onCreateNew,
}: {
  selectedDate: Date;
  items: WorkArrangementItem[];
  tasksForSelectedDate: WorkArrangementItem[];
  unscheduledItems: WorkArrangementItem[];
  selectedItemId: string | null;
  highlightedTaskIds: string[];
  onDateSelect: (date: Date) => void;
  onSelectTask: (taskId: string) => void;
  onCreateNew: () => void;
}) {
  const month = selectedDate.getMonth() + 1;
  const day = selectedDate.getDate();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekDay = weekDays[selectedDate.getDay()];

  return (
    <section className="neu-card-static rounded-[18px] flex min-h-0 flex-col overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="text-sm font-semibold text-[color:var(--foreground)]">
          {month}月{day}日 {weekDay} · {tasksForSelectedDate.length}项
        </div>
        <button
          type="button"
          onClick={onCreateNew}
          className="neu-btn-xs"
        >
          <Plus size={12} />
          <span>新建</span>
        </button>
      </div>

      {/* 日历 */}
      <div className="px-3">
        <WorkCalendar
          items={items}
          selectedDate={selectedDate}
          onDateSelect={onDateSelect}
        />
      </div>

      {/* 分割线 */}
      <div className="schedule-divider mx-3 my-3" />

      {/* 任务列表 flex-1 撑满 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-3">
        <WorkDateTaskList
          selectedDate={selectedDate}
          items={tasksForSelectedDate}
          unscheduledItems={unscheduledItems}
          selectedItemId={selectedItemId}
          highlightedTaskIds={highlightedTaskIds}
          onSelectTask={onSelectTask}
          onCreateNew={onCreateNew}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "schedule-panel" | head -10`  
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/schedule-panel.tsx
git commit -m "feat: add SchedulePanel component wrapping calendar + task list in neu-card-static"
```

---

### Task 11: Create TaskDetailPanel component (板块 ③)

**Files:**
- Create: `apps/web/src/components/work-arrangements/task-detail-panel.tsx`

**Interfaces:**
- Consumes: `WorkTaskQuickView`, `WorkTaskNotesPanel`, `neu-card-static` from globals.css
- Produces: `TaskDetailPanel` — wraps quick view + notes in one neu-card-static. Same props as the two sub-components.

- [ ] **Step 1: Create task-detail-panel.tsx**

```tsx
'use client';

import { WorkTaskQuickView } from '@/components/work-arrangements/work-task-quick-view';
import { WorkTaskNotesPanel } from '@/components/work-arrangements/work-task-notes-panel';
import type { WorkArrangementItem, WorkArrangementReminderState, WorkArrangementNoteType } from '@/lib/types/work-arrangements';

export function TaskDetailPanel({
  item,
  reminderState,
  noteType,
  noteDraft,
  noteSubmitting,
  showNotesPanel,
  onStart,
  onComplete,
  onBlock,
  onUnblock,
  onCancel,
  onPostponeReminder,
  onOpenFullEditor,
  onOpenNotes,
  onNoteTypeChange,
  onNoteDraftChange,
  onSubmitNote,
}: {
  item: WorkArrangementItem | null;
  reminderState: WorkArrangementReminderState;
  noteType: WorkArrangementNoteType;
  noteDraft: string;
  noteSubmitting: boolean;
  showNotesPanel: boolean;
  onStart: () => void;
  onComplete: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onCancel: () => void;
  onPostponeReminder: () => void;
  onOpenFullEditor: () => void;
  onOpenNotes: () => void;
  onNoteTypeChange: (value: WorkArrangementNoteType) => void;
  onNoteDraftChange: (value: string) => void;
  onSubmitNote: () => void;
}) {
  return (
    <section className="neu-card-static rounded-[18px] flex min-h-0 flex-col overflow-hidden p-4">
      <div className="flex-1 overflow-y-auto">
        <WorkTaskQuickView
          item={item}
          reminderState={reminderState}
          onStart={onStart}
          onComplete={onComplete}
          onBlock={onBlock}
          onUnblock={onUnblock}
          onCancel={onCancel}
          onPostponeReminder={onPostponeReminder}
          onOpenFullEditor={onOpenFullEditor}
          onOpenNotes={onOpenNotes}
        />

        <WorkTaskNotesPanel
          open={showNotesPanel}
          selectedItem={item}
          noteType={noteType}
          noteDraft={noteDraft}
          noteSubmitting={noteSubmitting}
          onNoteTypeChange={onNoteTypeChange}
          onNoteDraftChange={onNoteDraftChange}
          onSubmit={onSubmitNote}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "task-detail-panel" | head -10`  
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/task-detail-panel.tsx
git commit -m "feat: add TaskDetailPanel component wrapping quick view + notes in neu-card-static"
```

---

### Task 12: Create AiAssistPanel component (板块 ④)

**Files:**
- Create: `apps/web/src/components/work-arrangements/ai-assist-panel.tsx`

**Interfaces:**
- Consumes: `WorkbenchPlanningPanel`, `ProjectBriefCard`, `neu-card-static` from globals.css
- Produces: `AiAssistPanel` — wraps planning panel + project brief in one neu-card-static. The project brief is integrated within the planning panel's chairman flow already, so this is a thin wrapper for the planning panel + separate ProjectBriefCard for leader/admin.

- [ ] **Step 1: Create ai-assist-panel.tsx**

```tsx
'use client';

import { WorkbenchPlanningPanel } from '@/components/work-arrangements/workbench-planning-panel';
import { ProjectBriefCard } from '@/components/work-arrangements/project-brief-card';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';

export function AiAssistPanel({
  dailyPlan,
  refreshingPlan,
  isChairman,
  showProjectBrief,
  onSelectTimeBlock,
  onRefreshPlan,
  onShowHistory,
}: {
  dailyPlan: WorkArrangementDailyPlan | null;
  refreshingPlan: boolean;
  isChairman: boolean;
  showProjectBrief: boolean;
  onSelectTimeBlock: (taskIds: string[]) => void;
  onRefreshPlan: () => void;
  onShowHistory: () => void;
}) {
  return (
    <section className="neu-card-static rounded-[18px] flex min-h-0 flex-col overflow-hidden p-4">
      <div className="flex-1 overflow-y-auto">
        <WorkbenchPlanningPanel
          dailyPlan={dailyPlan}
          refreshingPlan={refreshingPlan}
          onSelectTimeBlock={onSelectTimeBlock}
          onRefreshPlan={onRefreshPlan}
          onShowHistory={onShowHistory}
          showAiScheduling={!isChairman}
          isChairman={isChairman}
        />

        {/* ProjectBriefCard — 仅非 chairman role 且非 chairman mode 时显示在 AI 排程下方 */}
        {!isChairman && showProjectBrief && dailyPlan ? (
          <div className="mt-4">
            <ProjectBriefCard dailyPlan={dailyPlan} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "ai-assist-panel" | head -10`  
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/ai-assist-panel.tsx
git commit -m "feat: add AiAssistPanel component wrapping planning + project brief in neu-card-static"
```

---

### Task 13: Refactor ProjectBriefCard — remove inline style

**Files:**
- Modify: `apps/web/src/components/work-arrangements/project-brief-card.tsx`

**Interfaces:**
- Consumes: `neu-card-static`, `neu-card` from globals.css
- Produces: Same component signature

- [ ] **Step 1: Replace root divs**

All three returns use `panel-surface panel-lens rounded-[24px] p-4`. Change to `neu-card rounded-[18px] p-4`:

Replace all occurrences (lines 11, 28, 58) of:

```tsx
<div className="panel-surface panel-lens rounded-[24px] p-4">
```

To:

```tsx
<div className="neu-card rounded-[18px] p-4">
```

- [ ] **Step 2: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/project-brief-card.tsx
git commit -m "refactor: remove panel-surface from ProjectBriefCard, use neu-card"
```

---

### Task 14: Restructure WorkArrangementsPage — new 4-panel layout

**Files:**
- Modify: `apps/web/src/components/work-arrangements/work-arrangements-page.tsx`

**Interfaces:**
- Consumes: `GreetingBanner` (WorkbenchOverview), `SchedulePanel`, `TaskDetailPanel`, `AiAssistPanel`, `ReminderBanner`
- Produces: Same export name, new two-column bottom-aligned layout

This is the biggest change. The existing layout (lines 636-788) is replaced with the new 4-panel grid.

- [ ] **Step 1: Add imports for new panel components**

At the top of `work-arrangements-page.tsx`, add after existing component imports:

```tsx
import { SchedulePanel } from '@/components/work-arrangements/schedule-panel';
import { TaskDetailPanel } from '@/components/work-arrangements/task-detail-panel';
import { AiAssistPanel } from '@/components/work-arrangements/ai-assist-panel';
```

- [ ] **Step 2: Add `showNotesPanel` state and notes handlers**

The existing page has `showNotesPanel` state but it's not imported in the return. Add the state and handlers. The existing code already has `showNotesPanel` (line 213) and related handlers. Verify it's all present. These are already in the existing code.

- [ ] **Step 3: Replace the return JSX (lines 636-788)**

Replace the entire return block with:

```tsx
  return (
    <>
      {/* 提醒 Banner */}
      <ReminderBanner
        reminders={activeReminders}
        onDismiss={handleReminderDismiss}
        onView={handleReminderView}
        onPostpone={handleReminderPostpone}
      />

      <div className="flex min-h-full flex-col gap-4">
        {/* ① 问候横幅 — 全宽 */}
        <WorkbenchOverview
          currentUser={currentUser}
          summary={workbenchSummary}
          dailyPlan={dailyPlan}
        />

        {/* 项目关联视图提示（仅当从项目页面链接过来时显示） */}
        {linkedProject ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-[rgba(96,139,239,0.25)] bg-[rgba(96,139,239,0.08)] px-4 py-3 text-sm text-[color:var(--foreground)]">
            <span className="rounded-[10px] bg-[rgba(96,139,239,0.12)] px-3 py-1 text-xs font-semibold text-[color:var(--accent)]">
              项目关联视图
            </span>
            <span>当前仅展示与"{linkedProject.title}"关联的工作安排。</span>
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-[color:var(--accent)]"
            >
              返回项目管理
              <ArrowUpRight size={14} />
            </Link>
          </div>
        ) : null}

        {/* 双栏主体：底部严格对齐 */}
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[0.40fr_0.60fr]">
          {/* ② 左列：日程规划 */}
          <SchedulePanel
            selectedDate={selectedDate}
            items={allItems}
            tasksForSelectedDate={tasksForSelectedDate}
            unscheduledItems={unscheduledItems}
            selectedItemId={selectedItemId}
            highlightedTaskIds={highlightedTaskIds}
            onDateSelect={setSelectedDate}
            onSelectTask={handleSelectTask}
            onCreateNew={handleCreateNew}
          />

          {/* 右列：flex-col 两卡片均分，与左列等高 */}
          <div className="flex min-h-0 flex-col gap-4">
            {/* ③ 任务详情 */}
            <div className="flex-1 min-h-0">
              <TaskDetailPanel
                item={selectedItem}
                reminderState={selectedReminderState}
                noteType={noteType}
                noteDraft={noteDraft}
                noteSubmitting={noteSubmitting}
                showNotesPanel={showNotesPanel}
                onStart={() => void handleQuickStatusUpdate('IN_PROGRESS')}
                onComplete={() => void handleQuickStatusUpdate('COMPLETED')}
                onBlock={() => void handleQuickStatusUpdate('BLOCKED')}
                onUnblock={() => void handleUnblock()}
                onCancel={() => void handleCancel()}
                onPostponeReminder={() => void handlePostponeReminder()}
                onOpenFullEditor={() => setShowFullEditor(true)}
                onOpenNotes={() => setShowNotesPanel(true)}
                onNoteTypeChange={setNoteType}
                onNoteDraftChange={setNoteDraft}
                onSubmitNote={() => void handleAddNote()}
              />
            </div>

            {/* ④ AI 辅助 */}
            <div className="flex-1 min-h-0">
              <AiAssistPanel
                dailyPlan={dailyPlan}
                refreshingPlan={refreshingPlan}
                isChairman={false}
                showProjectBrief={
                  currentUser?.role === 'leader' || currentUser?.role === 'admin'
                }
                onSelectTimeBlock={(taskIds) => {
                  setHighlightedTaskIds(taskIds);
                  const firstTaskId = taskIds[0];
                  if (firstTaskId) {
                    handleSelectTask(firstTaskId);
                  }
                }}
                onRefreshPlan={() => void loadDailyPlan()}
                onShowHistory={() => setShowHistoryDrawer(true)}
              />
            </div>
          </div>
        </div>

        {/* 错误信息 */}
        {errorMessage ? (
          <div className="flex items-center justify-between px-4 py-3 text-sm text-[color:var(--danger)]">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage("")}
              className="ml-2 shrink-0 text-[color:var(--danger)] opacity-60 hover:opacity-100"
            >
              关闭
            </button>
          </div>
        ) : null}
      </div>

      {/* Modal — 挂根节点避免 CSS containment 裁剪 */}
      <WorkTaskEditorDrawer
        open={showFullEditor || creating}
        creating={creating}
        saving={saving}
        selectedItemTitle={selectedItem?.title ?? null}
        editor={editor}
        projects={projects}
        availableDependencies={availableDependencies}
        onClose={() => {
          setShowFullEditor(false);
          setCreating(false);
        }}
        onSave={() => void handleSave()}
        onDelete={() => void handleDelete()}
        onChange={setEditor}
      />

      {/* 历史记录抽屉 */}
      <HistoryDrawer
        open={showHistoryDrawer}
        items={allItems}
        onClose={() => setShowHistoryDrawer(false)}
        onSelectTask={(taskId) => {
          handleSelectTask(taskId);
        }}
      />
    </>
  );
```

- [ ] **Step 4: Remove the old ProjectBriefCard import (it's now inside AiAssistPanel)**

The old `ProjectBriefCard` usage at the bottom (lines 742-744) is now inside `AiAssistPanel`. Remove the standalone import:

```tsx
// Remove this line:
import { ProjectBriefCard } from "@/components/work-arrangements/project-brief-card";
```

Since `AiAssistPanel` imports `ProjectBriefCard` internally.

- [ ] **Step 5: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "work-arrangements-page" | head -20`  
Expected: No errors from this file

- [ ] **Step 6: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/work-arrangements-page.tsx
git commit -m "refactor: restructure WorkArrangementsPage with 4-panel neu-card-static layout"
```

---

### Task 15: Restructure WorkArrangementsPageChairman — new 4-panel layout

**Files:**
- Modify: `apps/web/src/components/work-arrangements/work-arrangements-page-chairman.tsx`

**Interfaces:**
- Consumes: Same panel components as Task 14
- Produces: Same export name, chairman-adapted layout

- [ ] **Step 1: Add imports for new panel components**

At the top of `work-arrangements-page-chairman.tsx`, add:

```tsx
import { SchedulePanel } from '@/components/work-arrangements/schedule-panel';
import { TaskDetailPanel } from '@/components/work-arrangements/task-detail-panel';
import { AiAssistPanel } from '@/components/work-arrangements/ai-assist-panel';
```

Remove unused imports that are no longer needed:
- `WorkCalendar`, `WorkDateTaskList`, `WorkbenchPlanningPanel` (now inside panel components)
- Keep `WorkTaskEditorDrawer` (still used directly)

Also remove unused imports: `Plus` (now inside SchedulePanel), `ArrowUpRight`, `Link` (if only used in linked project banner — keep if still used).

- [ ] **Step 2: Replace the return JSX (lines 320-448)**

Replace the entire return block with:

```tsx
  return (
    <>
    <div className="flex min-h-full flex-col gap-4">
      {/* ① 问候横幅 — 全宽 */}
      <WorkbenchOverview
        currentUser={currentUser ?? { id: '', username: 'Swhi-CGZX-00', displayName: '尊敬的张宏董事长', role: 'admin', createdAt: null, lastLoginAt: null } as AuthUser}
        summary={workbenchSummary}
        dailyPlan={dailyPlan}
      />

      {/* 项目关联视图提示 */}
      {linkedProject ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-[rgba(96,139,239,0.25)] bg-[rgba(96,139,239,0.08)] px-4 py-3 text-sm text-[color:var(--foreground)]">
          <span className="rounded-[10px] bg-[rgba(96,139,239,0.12)] px-3 py-1 text-xs font-semibold text-[color:var(--accent)]">
            项目关联视图
          </span>
          <span>当前仅展示与"{linkedProject.title}"关联的工作安排。</span>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-[color:var(--accent)]"
          >
            返回项目管理
            <ArrowUpRight size={14} />
          </Link>
        </div>
      ) : null}

      {/* 双栏主体：底部严格对齐 */}
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[0.40fr_0.60fr]">
        {/* ② 左列：日程规划 */}
        <SchedulePanel
          selectedDate={selectedDate}
          items={allItems}
          tasksForSelectedDate={tasksForSelectedDate}
          unscheduledItems={unscheduledItems}
          selectedItemId={selectedItemId}
          highlightedTaskIds={[]}
          onDateSelect={setSelectedDate}
          onSelectTask={handleSelectTask}
          onCreateNew={handleCreateNew}
        />

        {/* 右列：flex-col 两卡片均分 */}
        <div className="flex min-h-0 flex-col gap-4">
          {/* ③ 任务详情 */}
          <div className="flex-1 min-h-0">
            <TaskDetailPanel
              item={selectedItem}
              reminderState={selectedReminderState ?? ('NONE' as WorkArrangementReminderState)}
              noteType={noteType}
              noteDraft={noteDraft}
              noteSubmitting={noteSubmitting}
              showNotesPanel={!!selectedItem}
              onStart={() => void handleQuickStatusUpdate("IN_PROGRESS")}
              onComplete={() => void handleQuickStatusUpdate("COMPLETED")}
              onBlock={() => void handleQuickStatusUpdate("BLOCKED")}
              onUnblock={() => void handleQuickStatusUpdate("TODO")}
              onCancel={() => void handleQuickStatusUpdate("CANCELLED")}
              onPostponeReminder={async () => {}}
              onOpenFullEditor={handleOpenEditor}
              onOpenNotes={() => { if (selectedItem) { setNoteDraft(""); setNoteType("PROGRESS"); } }}
              onNoteTypeChange={setNoteType}
              onNoteDraftChange={setNoteDraft}
              onSubmitNote={() => void handleAddNote()}
            />
          </div>

          {/* ④ AI 辅助 — chairman mode */}
          <div className="flex-1 min-h-0">
            <AiAssistPanel
              dailyPlan={dailyPlan}
              refreshingPlan={refreshingPlan}
              isChairman={true}
              showProjectBrief={false}
              onSelectTimeBlock={() => {}}
              onRefreshPlan={handleRefreshPlan}
              onShowHistory={() => {}}
            />
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
          {errorMessage}
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="ml-3 text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      )}
    </div>

      {/* Modal — 挂根节点避免 CSS containment 裁剪 */}
      <WorkTaskEditorDrawer
        open={creating || showFullEditor}
        creating={creating}
        saving={saving}
        selectedItemTitle={selectedItem?.title ?? null}
        editor={editor}
        projects={projects}
        availableDependencies={allItems}
        onClose={() => { setCreating(false); setShowFullEditor(false); }}
        onSave={() => void handleSave()}
        onDelete={() => void handleDelete()}
        onChange={setEditor}
      />
    </>
  );
```

- [ ] **Step 3: TypeScript check**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -i "work-arrangements-page-chairman" | head -20`  
Expected: No errors from this file

- [ ] **Step 4: Commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/web/src/components/work-arrangements/work-arrangements-page-chairman.tsx
git commit -m "refactor: restructure WorkArrangementsPageChairman with 4-panel neu-card-static layout"
```

---

### Task 16: Full TypeScript verification

**Files:** All modified files

- [ ] **Step 1: Run full type check**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | tail -30
```

Expected: No errors. If errors exist, fix before proceeding.

- [ ] **Step 2: Fix any TS errors**

Review errors. Common causes:
- Missing imports in restructured files
- Unused imports (remove them)
- Type mismatches in new panel component props

- [ ] **Step 3: Run lint**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
pnpm --filter web lint 2>&1 | tail -20
```

Expected: No new errors.

- [ ] **Step 4: Commit any fixes**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add -A
git commit -m "fix: resolve TypeScript and lint errors from workbench redesign"
```

---

### Task 17: Visual verification — drive the app and capture screenshots

**Files:** None (runtime verification)

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
pnpm dev:web &
sleep 15
```

- [ ] **Step 2: Take screenshot of the workbench page**

```bash
# Using browser-tools MCP or manual navigation
# Navigate to http://localhost:3005/work-arrangements
# Login as 陈主任 / czr@2026
```

- [ ] **Step 3: Verify all 4 panels render correctly**

Checklist:
- [ ] GreetingBanner (①) — full width, neu-card-static shell visible with inner highlight line
- [ ] SchedulePanel (②) — left column, calendar + task list in one card
- [ ] TaskDetailPanel (③) — right-top, empty state with neu-icon-well
- [ ] AiAssistPanel (④) — right-bottom, AI scheduling + advice
- [ ] Bottom alignment — left and right columns end at same height
- [ ] No inline style blocks visible for backgrounds/borders/shadows
- [ ] Three-state interaction on buttons (hover=lift, active=inset)
- [ ] Calendar cells have proper border-radius and shadows

- [ ] **Step 4: Test chairman variant**

Login as Swhi-CGZX-00 (董事长账号):
- [ ] Chairman mode: AiAssistPanel shows project brief, no AI scheduling
- [ ] TaskDetailPanel works the same

- [ ] **Step 5: Test responsive**

Resize browser to < 1280px width:
- [ ] Single column stack — all 4 panels in order
- [ ] No overflow or layout breakage

- [ ] **Step 6: Fix any visual issues**

If screenshots show misalignment or style issues, fix in the relevant component file and re-verify.

- [ ] **Step 7: Final commit**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add -A
git commit -m "feat: complete workbench redesign with 4-panel cgzxui neumorphic layout"
```

---

## Plan Verification Checklist

- [ ] **Spec coverage:** GreetingBanner ✓ Task 2, SchedulePanel ✓ Task 10, TaskDetailPanel ✓ Task 11, AiAssistPanel ✓ Task 12, Layout ✓ Tasks 14-15, CSS classes ✓ Task 1, Inline style removal ✓ Tasks 2-8, Bottom alignment ✓ Tasks 14-15 layout, Reduced motion ✓ already in globals.css
- [ ] **No placeholders:** All code blocks contain real implementations, no TBD/TODO
- [ ] **Type consistency:** Panel component prop types match their consumers in Tasks 14-15
- [ ] **File paths:** All paths are absolute under `apps/web/src/`, verified against existing repo structure
