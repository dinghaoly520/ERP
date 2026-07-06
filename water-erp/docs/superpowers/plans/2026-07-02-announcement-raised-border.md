# 公告区域组件边框凸起 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为3002首页公告区域4类组件增加新拟态边框凸起效果，使用页面背景色 `oklch(0.975 0.012 258)` 为基准推导阴影配色。

**Architecture:** 纯 CSS 修改——单文件 `globals.css`，不改变 JSX/DOM 结构。每个组件叠加方向性双影（亮高光左上 + 暗投影右下）+ 内高光线实现"浮出页面"效果。Tab 激活态使用 inset shadow 实现"按下"内凹。

**Tech Stack:** CSS (Tailwind v4 项目中的自定义 CSS class)，无新增依赖。

## Global Constraints

- 阴影色值以页面背景 `oklch(0.975 0.012 258)` 为基准推导
- 亮高光: `oklch(1 0 0 / 0.85)`，暗投影: `oklch(0.55 0.03 258 / 0.15)`
- 内高光线: `inset 0 1px 0 oklch(1 0 0 / 0.7)`
- 保持 reduced-motion 媒体查询兼容
- 不修改 `home-client.tsx` 或任何 JSX 文件

---

### Task 1: Tab 按钮凸起（`.announce-tab` 系列）

**Files:**
- Modify: `apps/public-portal/src/app/globals.css:1606-1634`

**Interfaces:**
- Produces: `.announce-tab` default raised shadow + brightened bg; `.announce-tab:hover` lift 1px; `.announce-tab.is-active` inset pressed shadow

- [ ] **Step 1: 修改 `.announce-tab` 默认态**

Find the `.announce-tab` block (line 1606–1622), replace `background: transparent;` and add `box-shadow`:

```
Edit apps/public-portal/src/app/globals.css:
old:
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);

new:
  background: #f8faff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  box-shadow:
    2px 2px 4px oklch(0.55 0.03 258 / 0.12),
    -1px -1px 3px oklch(1 0 0 / 0.9);
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
```

- [ ] **Step 2: 修改 `.announce-tab:hover:not(.is-active)` 悬停态**

```
Edit apps/public-portal/src/app/globals.css:
old:
.announce-tab:hover:not(.is-active) {
  color: #064ea2;
  background: rgba(255, 255, 255, 0.7);
}

new:
.announce-tab:hover:not(.is-active) {
  color: #064ea2;
  background: #fff;
  transform: translateY(-1px);
  box-shadow:
    3px 3px 6px oklch(0.55 0.03 258 / 0.16),
    -2px -2px 5px oklch(1 0 0 / 0.95);
}
```

- [ ] **Step 3: 修改 `.announce-tab.is-active` 激活态（内凹）**

```
Edit apps/public-portal/src/app/globals.css:
old:
.announce-tab.is-active {
  box-shadow:
    0 2px 8px color-mix(in srgb, var(--tab-color, #064ea2) 35%, transparent),
    0 0 0 1px color-mix(in srgb, var(--tab-color, #064ea2) 20%, transparent);
  transform: scale(1.02);
}

new:
.announce-tab.is-active {
  box-shadow:
    inset 2px 2px 5px oklch(0.55 0.03 258 / 0.18),
    inset -2px -2px 5px oklch(1 0 0 / 0.6);
  transform: scale(1.02);
}
```

- [ ] **Step 4: 修改 `.announce-tabs` 容器背景微调（与凸起 tab 协调）**

```
Edit apps/public-portal/src/app/globals.css:
old:
.announce-tabs {
  display: flex;
  gap: 6px;
  background: #f0f3f8;

new:
.announce-tabs {
  display: flex;
  gap: 6px;
  background: #eef1f6;
```

- [ ] **Step 5: 验证**

Run: `cd apps/public-portal && npx next dev -p 3002 --webpack`
Open: `http://localhost:3002` → 滚动到公告区域 → 验证 Tab 按钮有外凸立体感，悬停时抬升，激活 Tab 呈内凹"按下"状态。

---

### Task 2: 精选卡片凸起（`.announce-featured` 系列）

**Files:**
- Modify: `apps/public-portal/src/app/globals.css:1685-1756`

**Interfaces:**
- Produces: `.announce-featured` outer with directional raised shadow; `.announce-featured-inner` enhanced inner highlight; hover states with stronger directional shadows

- [ ] **Step 6: 修改 `.announce-featured` 外层默认态**

```
Edit apps/public-portal/src/app/globals.css:
old:
  border: 1.5px solid oklch(0.55,0.08,258/0.45);
  box-shadow: 0 4px 20px oklch(0.45,0.1,258/0.08);
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease, border-color 0.3s ease;

new:
  border: 1.5px solid oklch(0.55,0.08,258/0.35);
  box-shadow:
    3px 3px 8px oklch(0.55 0.03 258 / 0.14),
    -3px -3px 8px oklch(1 0 0 / 0.85);
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease, border-color 0.3s ease;
```

- [ ] **Step 7: 修改 `.announce-featured:hover` 悬停态**

```
Edit apps/public-portal/src/app/globals.css:
old:
.announce-featured:hover {
  transform: translateY(-4px);
  box-shadow:
    0 12px 40px rgba(6, 78, 162, 0.08),
    0 4px 12px rgba(6, 78, 162, 0.04);
}

new:
.announce-featured:hover {
  transform: translateY(-4px);
  box-shadow:
    5px 5px 14px oklch(0.45 0.08 258 / 0.12),
    -3px -3px 10px oklch(1 0 0 / 0.9);
  border-color: oklch(0.55,0.14,258/0.25);
}
```

- [ ] **Step 8: 修改 `.announce-featured-inner` 内层默认态**

```
Edit apps/public-portal/src/app/globals.css:
old:
  box-shadow: inset 0 1px 0 oklch(1,0,0/0.6), 0 4px 20px oklch(0.45,0.1,258/0.06);

new:
  box-shadow: inset 0 1px 0 oklch(1,0,0/0.75);
```

- [ ] **Step 9: 修改 `.announce-featured:hover .announce-featured-inner` 内层悬停态**

```
Edit apps/public-portal/src/app/globals.css:
old:
  box-shadow: inset 0 1px 0 oklch(1,0,0/0.8), 0 8px 32px oklch(0.45,0.1,258/0.1);

new:
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.85);
```

- [ ] **Step 10: 验证**

刷新 `http://localhost:3002` → 验证精选卡片有外凸立体感，悬停时卡片整体抬升 4px，内高光线明亮。

---

### Task 3: 侧边列表凸起（`.announce-side` 系列）

**Files:**
- Modify: `apps/public-portal/src/app/globals.css:1893-2031`

**Interfaces:**
- Produces: `.announce-side` container raised shadow + inner highlight; `.announce-side-item:hover` lift 1px + subtle shadow

- [ ] **Step 11: 修改 `.announce-side` 容器默认态**

```
Edit apps/public-portal/src/app/globals.css:
old:
.announce-side {
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  overflow: hidden;
  background: oklch(1,0,0/0.55);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1.5px solid oklch(0.55,0.08,258/0.45);
  box-shadow: 0 4px 20px oklch(0.45,0.1,258/0.06);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
  min-height: 0;
}

new:
.announce-side {
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  overflow: hidden;
  background: oklch(1,0,0/0.55);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1.5px solid oklch(0.55,0.08,258/0.35);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),
    2px 2px 6px oklch(0.55 0.03 258 / 0.12),
    -2px -2px 6px oklch(1 0 0 / 0.85);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
  min-height: 0;
}
```

- [ ] **Step 12: 修改 `.announce-side:hover` 容器悬停态**

```
Edit apps/public-portal/src/app/globals.css:
old:
.announce-side:hover {
  border-color: oklch(0.55,0.14,258/0.35);
  box-shadow: inset 0 1px 0 oklch(1,0,0/0.8), 0 8px 32px oklch(0.45,0.1,258/0.1);
}

new:
.announce-side:hover {
  border-color: oklch(0.55,0.14,258/0.25);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.85),
    4px 4px 10px oklch(0.45 0.08 258 / 0.1),
    -2px -2px 8px oklch(1 0 0 / 0.9);
}
```

- [ ] **Step 13: 修改 `.announce-side-item:hover` 列表项悬停抬升**

```
Edit apps/public-portal/src/app/globals.css:
old:
.announce-side-item:hover {
  background: linear-gradient(90deg, rgba(6, 78, 162, 0.03), transparent);
}

new:
.announce-side-item:hover {
  background: linear-gradient(90deg, rgba(6, 78, 162, 0.03), transparent);
  transform: translateY(-1px);
  box-shadow:
    2px 2px 4px oklch(0.55 0.03 258 / 0.08),
    -1px -1px 3px oklch(1 0 0 / 0.6);
}
```

- [ ] **Step 14: 验证**

刷新 `http://localhost:3002` → 验证侧边列表整体有凸起感，悬停容器时投影增强，悬停列表项时单项抬升 1px。

---

### Task 4: "全部公告"按钮凸起（`.announce-view-all`）

**Files:**
- Modify: `apps/public-portal/src/app/globals.css:1649-1666`

**Interfaces:**
- Produces: `.announce-view-all` default raised shadow + brighter bg; hover deeper shadow

- [ ] **Step 15: 修改 `.announce-view-all` 默认态**

```
Edit apps/public-portal/src/app/globals.css:
old:
.announce-view-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  color: #5a6d8a;
  background: #f0f3f8;
  border-radius: 8px;
  text-decoration: none;
  transition: all 0.3s ease;
}

new:
.announce-view-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  color: #5a6d8a;
  background: #f4f7fc;
  border-radius: 8px;
  text-decoration: none;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),
    2px 2px 4px oklch(0.55 0.03 258 / 0.1),
    -1px -1px 3px oklch(1 0 0 / 0.85);
  transition: all 0.3s ease;
}
```

- [ ] **Step 16: 修改 `.announce-view-all:hover` 悬停态**

```
Edit apps/public-portal/src/app/globals.css:
old:
.announce-view-all:hover {
  color: #064ea2;
  background: #e8ecf4;
}

new:
.announce-view-all:hover {
  color: #064ea2;
  background: #eef2f8;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.8),
    3px 3px 6px oklch(0.55 0.03 258 / 0.14),
    -2px -2px 5px oklch(1 0 0 / 0.9);
}
```

- [ ] **Step 17: 验证**

刷新 `http://localhost:3002` → 验证"全部公告"按钮有 subtle 凸起感，悬停时投影加深。

---

### Task 5: 最终视觉验证

- [ ] **Step 18: 页面整体检查**

在 `http://localhost:3002`：
1. 公告区域整体与其他区域（Hero、快捷入口、价值观）视觉层次是否分明
2. 各组件凸起效果是否协调一致
3. 悬停交互是否流畅（Tab / 卡片 / 列表项 / 按钮）
4. 配色是否与页面背景 `oklch(0.975 0.012 258)` 和谐

- [ ] **Step 19: 提交代码**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
git add apps/public-portal/src/app/globals.css
git commit -m "feat(public-portal): add neumorphic raised border to announcement area components

- Tab buttons: raised shadow default, lift on hover, inset pressed on active
- Featured card: directional raised shadow + inner highlight line
- Side list: container raised with inner highlight, items lift 1px on hover
- View-all button: subtle raised shadow + inner highlight

Shadows derived from page background oklch(0.975 0.012 258)."
```

---
