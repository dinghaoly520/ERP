---
name: cgzxui
description: Use when building or restyling ANY visual element in public-portal (:3002) or web (:3005) — including new pages, buttons, cards, inputs, modals, drawers, or when the user says "和首页风格一致", "neumorphic", "新拟态", "凸起边框", or asks what class to use for a button/card/input. Also use whenever a component has inline style, bg-white, border-gray-200, rounded-full buttons, or flat box-shadows that violate cgzxui principles.
---

# cgzxui — 信息门户 UI 设计标准

`apps/public-portal`（:3002）和 `apps/web`（:3005，已移植）的 UI 规范。覆盖页面骨架、配色体系、neomorphic 模式、组件类目、弹窗抽屉、反模式。

## 何时使用 / 何时不使用

✅ `apps/public-portal` 或 `apps/web` 内任何视觉元素
✅ 看到内联 `style`、`bg-white`、`border-gray-200`、`rounded-full` 按钮、扁平 `box-shadow`
✅ 新建页面/按钮/卡片/输入框/弹窗/抽屉
✅ 被要求"和首页一致"

❌ 其他 portal（mall / supplier / expert / bid）— 未移植 cgzxui 类
❌ 纯逻辑/数据工作（无 UI 改动）
❌ 装饰性小元素的状态点/标签/badge — neumorphism 不用于文字级元素

## 核心原则

1. **单一 CSS 源**：`globals.css`。内联 `style` 绕过 `:hover`/`:active` → 三态失效。
2. **方向性双影**：光源左上，暗影右下 `(2px 2px)`，亮高光左上 `(-1px -1px)`。禁止扁平 `0 4px 20px rgba(...)`。
3. **oklch() 色彩空间**：禁止 `rgba()`/`hex` 用于阴影。
4. **三态完整**：默认凸起 → hover 抬升 → active 内凹。任何一态缺失 = bug。
5. **reduced-motion 降级**：所有过渡在 `@media (prefers-reduced-motion)` 下禁用。
6. **禁止外侧框线**：卡片、面板、容器等块级表面**不得**添加 `border` 框线。层次感由方向性双影 + 内高光线 + 玻璃背景差异化提供，外侧框线是对 neumorphic 美学的破坏——它把"从页面浮起"的物理感退化成了"贴上去的带框方块"。

## 页面骨架（复制即用）

新页面只需要这个结构，就能继承背景、装饰、顶栏、配色：

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowBackdrop } from '@/components/flow-stage';

export default function MyPage() {
  const router = useRouter();
  return (
    <div className="flow-page">
      <FlowBackdrop />
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      <div className="px-[clamp(28px,4vw,72px)] pt-3">
        {/* 返回首页 — 与"全部公告"同款设计 */}
        <a href="/" className="flow-back">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" className="flow-back-arrow">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          返回首页
        </a>
      </div>

      {/* 页面内容 */}
    </div>
  );
}
```

- `.flow-page` — 提供 `oklch(0.975 0.012 258)` 背景 + 所有 CSS 变量 + 字体栈
- `<FlowBackdrop />` — 四角光晕（`.flow-glow`）+ 浮动粒子（`.flow-particles`）
- `<UnifiedHeader />` — sticky 玻璃顶栏（logo + 搜索 + 导航）

## 配色体系

### CSS 变量（定义在 `.flow-page`）

| 变量 | 色值 | 用途 |
|------|------|------|
| `--bg` | `oklch(0.975 0.012 258)` | 页面背景（阴影推导基准） |
| `--ink` | `oklch(0.24 0.038 258)` | 最深标题 |
| `--fg` | `oklch(0.28 0.03 258)` | 主文字 |
| `--fg-2` | `oklch(0.47 0.025 258)` | 次级文字 |
| `--fg-3` | `oklch(0.6 0.03 258)` | 弱化文字 |
| `--brand` | `oklch(0.5 0.16 258)` | 品牌蓝（≈ #064ea2） |
| `--brand-deep` | `oklch(0.42 0.16 258)` | hover 加深 |
| `--brand-soft` | `oklch(0.62 0.12 258)` | 柔和品牌蓝 |
| `--water` | `oklch(0.5 0.12 175)` | 水主题青绿 |
| `--glass` | `oklch(0.995 0.004 258 / 0.5)` | 玻璃面板背景 |
| `--glass-border` | `oklch(1 0 0 / 0.7)` | 玻璃边框 |

### Neumorphic 阴影色板

| 角色 | 色值 | 不透明度 | 用途 |
|------|------|----------|------|
| 亮高光 | `oklch(1 0 0)` | 0.7–0.95 | 顶/左边缘光源 |
| 暗投影 | `oklch(0.55 0.03 258)` | 0.08–0.18 | 底/右纵深 |
| 悬停远投影 | `oklch(0.45 0.08 258)` | 0.10–0.14 | 抬升时远距离感 |
| 内高光线 | `inset 0 1px 0 oklch(1 0 0)` | 0.7–0.85 | 顶部物理边缘光（**最关键细节**） |

> 内高光线是 neumorphic 设计的灵魂——它模拟光线捕获在元素顶部边缘的物理现象，没有它，按钮只是"有阴影的方块"。

## Neumorphic 三态模式

这是所有交互表面的通用模板。按组件类型微调强度（链接按钮 alpha 0.1，主要按钮 alpha 0.25）：

```css
/* 默认 — 凸起 */
background: #f4f7fc;            /* 链接按钮 */
/* 或 oklch(1 0 0 / 0.55) + backdrop-filter — 玻璃卡片 */
/* 或 oklch(0.5 0.16 258) — 品牌主按钮 */
box-shadow:
  inset 0 1px 0 oklch(1 0 0 / 0.7),           /* 顶缘内高光 */
  2px 2px 4px oklch(0.55 0.03 258 / 0.1),     /* 右下暗影 */
  -1px -1px 3px oklch(1 0 0 / 0.85);          /* 左上亮光 */

/* 悬停 — 抬升 */
transform: translateY(-1px);    /* 卡片 -2 ~ -4px */
background: #eef2f8;
box-shadow:
  inset 0 1px 0 oklch(1 0 0 / 0.8),
  3px 3px 6px oklch(0.55 0.03 258 / 0.14),
  -2px -2px 5px oklch(1 0 0 / 0.9);

/* 按下 — 内凹 */
box-shadow:
  inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15),
  inset -2px -2px 5px oklch(1 0 0 / 0.5);
```

过渡：`transition: all 0.3s ease;` 或 `cubic-bezier(0.16, 1, 0.3, 1)`（更顺滑的抬起感）。

## 组件类目速查

> 完整 CSS 规格见 `references/component-specs.md`。下表是"该用哪个类名"的索引。

### 按钮 / 链接

| 类名 | 用途 | 背景 | 备注 |
|------|------|------|------|
| `.flow-back` | "返回首页"链接 | `#f4f7fc` | 箭头左滑 4px |
| `.announce-view-all` | "全部公告"链接 | `#f4f7fc` | 箭头右滑 4px |
| `.neu-btn-primary` | 主要操作按钮 | `var(--brand)` | 44px 实心 |
| `.neu-btn-soft` | 次要操作按钮 | `var(--surface)` | 38px 凸起，hover 抬升，active 内凹 |
| `.neu-btn-xs` | 紧凑按钮 | `var(--surface)` | 30px，含 `.is-danger`/`.is-success`/`.is-warning` 颜色变体 |
| `.neu-link` | 次级链接 | `#e8ecf2` | 经典 neumorphic |
| `.neu-btn-group` | **按钮组容器** | — | 将并排的 `.neu-btn-primary`(44px) 与 `.neu-btn-soft`(38px) 统一为 38px 等高，消除高度不齐 |
| `.flow-cta-btn` | CTA 底栏按钮 | `var(--brand)` | 54px |
| `.hero-btn` | Hero 主 CTA | `var(--brand)` | 52px 大尺寸 |
| `.hero-btn-outline` | Hero 描边 CTA | transparent | 描边变体 |
| `.flow-cta-btn` | CTA 底栏按钮 | `var(--brand)` | 54px |
| `.flow-cta-btn.ghost` | 幽灵变体 | transparent | 次要操作 |

### 卡片 / 容器

| 类名 | 用途 |
|------|------|
| `.wb-panel` | 工作台面板（左纯白→右透明渐变 + 方向性双影，无可交互 hover） |
| `.wb-panel-header` | 面板头部栏（`oklch(1 0 0 / 0.3)` 半透明底） |
| `.wb-panel-body` | 面板内容区（flex-1，overflow-y:auto） |
| `.neu-card` | 通用 neumorphic 卡片（glass 背景 + 内高光 + 双影，hover 抬升，**无外侧框线**） |
| `.glass` | 基础玻璃面板（**无外侧框线**） |
| `.flow-cta` | CTA 底栏（glass + 径向光芒） |
| `.flow-pipe-shell` | 流程图谱外壳 |
| `.flow-h-card` | 流程阶段卡片（`--card-color` 驱动配色） |
| `.wb-section-rule` | 1px hairline 分割线（`oklch(0.6 0.04 258 / 0.16)`），替代裸 `border-t` |
| `.page-hero` | **页面标题卡片**——玻璃渐变底（左纯白→右半透）+ 方向性双影 + ::after 彩色光晕 |
| `.kpi-card` | 页面标题卡片内的指标瓷片——凸起浅底 + hover 抬升 + label/value/sub 排版 |
| `.neu-table-card` | **数据表格卡片**——左纯白→右透明渐变毛玻璃 + 方向性双影 + hover 轻微抬升 |
| `.neu-table` | 数据表格基类——半透明 thead + 四层行交互（透明/hover/选中/press） |
| `.neu-batch-bar` | 批量操作浮条——表格卡片顶部滑入；玻璃 + 内高光 + 双影 |
| `.neu-tab-bar` / `.neu-tab` | 内凹 tab 容器 + 凸起 tab 项（hover 抬升/激活内凹） |

### 公告组件

| 类名 | 用途 |
|------|------|
| `.announce-tabs` / `.announce-tab` | Tab 容器 / 单个 Tab |
| `.announce-tab.is-active` | 激活态（内凹） |
| `.announce-featured` | 精选公告大卡片 |
| `.announce-side` / `.announce-side-item` | 侧边列表 / 子项 |

### 表单

| 类名 | 用途 |
|------|------|
| `.neu-input` | 内凹输入框（44px，focus 环，textarea 自动 min-height: 88px） |
| `.workbench-input` | 内凹输入框（40px，含 select 下拉箭头），用于弹窗和面板内表单 |

### 文件上传

| 类名 | 用途 |
|------|------|
| `.neu-drop-zone` | 文件选择虚线拖放区（内凹 surface 底色，居中图标 + 文件名 + 提示文字） |
| `.neu-attachment-item` | 已上传附件列表项（凸起 surface 底色 + 方向性双影，hover 加深投影） |

### 页面结构

| 类名 | 用途 |
|------|------|
| `.flow-page` | **页面根容器**（必用） |
| `.flow-header` | sticky 顶栏（72px 玻璃） |
| `.flow-hero` / `.flow-hero-brand` | Hero 区域 / 品牌标识 |
| `.flow-glow` | 四角光晕（fixed） |
| `.flow-particles` / `.flow-particle` | 浮动粒子 |
| `.flow-rise-1` ~ `.flow-rise-4` | 入场淡入升起（递增延迟） |

### 标签 / 装饰

| 类名 | 用途 |
|------|------|
| `.flow-chip` | 角色标签（`--card-color` 驱动描边） |
| `.flow-card-tag` | 卡片左上角彩色标签 |

## 反模式与合理化陷阱

### 禁止行为 + 为什么错

| 反模式 | 为什么不好 | 压力下常见借口 |
|--------|-----------|--------------|
| `style={{ background: "linear-gradient(...)" }}` | 绕过 `:hover`/`:active` 选择器，三态失效 | "就这一处需要渐变背景" |
| `box-shadow: 0 4px 20px rgba(...)` | 没有方向性，丧失浮起物理感 | "阴影强一点更明显" |
| `className="bg-white rounded-[24px] shadow-2xl"` | 纯白与页面背景脱节，像贴上去的 | "弹窗就是要独立于页面" |
| `className="rounded-full border border-gray-200 bg-white"` | 非 cgzxui 风格，无三态，无内凹 | "按钮不就该有个边吗" |
| 给卡片/面板/容器加 `border` 或 `border-[...]` | 框线把 neumorphic"浮起"感退化为"贴上去的带框方块"，方向性双影已足够表达层次 | "卡片总得有个边吧" |
| 漏 `:active` | 按下无反馈 | "hover 就够了" |
| 保存按钮默认 44px 高于取消 38px | 底部按钮不齐平，视觉凌乱 | "高度不一样没关系" |
| 并排按钮不用 `.neu-btn-group` 包裹 | 高度不一致，对齐偏移 | "我手动设了 height" |
| 给文字/标签/badge 加 neumorphic shadow | 小元素变臃肿模糊 | "让标签突出一点" |

### 红牌自检

在提交任何视觉改动前，自查以下三项。任一命中 → 回退重做。

- ❌ 文件中有 `style={{ }}`（CSS 变量传递如 `--item-accent` 除外）
- ❌ 文件中有 `bg-white`、`border-gray-200`、`rounded-full` 修饰的按钮/输入框
- ❌ 文件中有 `shadow-lg`、`shadow-2xl` 或内联 `boxShadow`
- ❌ 卡片/面板/容器组件上有 `border` 或 `border-[...]` 类名（`border-t` hairline 内部分割线除外）

## 反模式（为什么错）

| 反模式 | 为什么不好 |
|--------|-----------|
| 扁平 shadow `0 4px 20px rgba(...)` | 没有方向性，丧失"浮起"的物理感，像贴纸 |
| 给文字 / 标签 / badge 加 neumorphic shadow | neumorphism 是块级表面的语言，加在小元素上会显臃肿、糊一团 |
| 暗影 alpha > 0.18 或 blur > 14px | 阴影过强破坏 subtle 美感，视觉噪声压过内容 |
| `overflow: hidden` 裁切 neumorphic shadow | 阴影被切掉，凸起感消失。内层内容才用 overflow:hidden |
| 内联 `style` 覆盖类名 | 绕过 `:hover`/`:active` 选择器，三态失效 |
| 漏 `:active` 内凹态 | 按下没反馈，按钮像死的 |
| 漏 `@media (prefers-reduced-motion: reduce)` | 前庭功能障碍用户会被动画触发眩晕 |
| 同组件混用 Material elevation shadow | 两种设计语言打架，视觉不协调 |

## 文件参考

| 文件 | 内容 |
|------|------|
| `apps/public-portal/src/app/globals.css` | **所有 CSS 类名单一来源**（搜 `/* ──` 跳章节） |
| `apps/public-portal/src/app/home-client.tsx` | 首页参考实现（hero / 公告 / tabs / CTA） |
| `apps/public-portal/src/components/unified-header.tsx` | 统一顶栏 |
| `apps/public-portal/src/components/flow-track.tsx` | `FlowBackdrop` + `FlowTrack` |
| `references/component-specs.md`（本 skill 内） | 按钮/卡片/输入框的完整 CSS 规格 |
| `apps/public-portal/.claude/skills/neumorphic-design/SKILL.md` | 专注新拟态细节的伴随 skill |
| `docs/superpowers/specs/2026-07-02-announcement-raised-border-design.md` | 公告区新拟态设计规格 |

## 常见任务

**"新页面要和首页风格一致"** — 用上面"页面骨架"模板；卡片用 `.neu-card`；主 CTA 用 `.neu-btn-primary` 或 `.flow-cta-btn`。

**"新建数据管理页面"** — 必须包含以下三层：
1. `page-hero` 标题卡片（含 `page-hero__row` + hairline 分割线 + KPI 瓷片或搜索行）
2. 独立的工具栏卡片（type tab + 搜索 + 筛选下拉，neumorphic 浅底 + 方向性双影）
3. `neu-table-card` + `neu-table` 数据表格（透明行 + 四层交互 + 批量操作浮条）

**"改一个按钮的样式"** — 改 `globals.css` 中对应类名，**绝不**在 TSX 加内联 `style`。

**"新建一个 neumorphic 组件"** — 参照三态模式，暗影 alpha 从 0.1 起，必须含 `inset 0 1px 0 oklch(1 0 0 / 0.7)` 内高光线。需要完整按钮/卡片 CSS 作参照，看 `references/component-specs.md`。

## Page Hero — 页面标题卡片

`.page-hero` 是数据管理页面的**统一标题栏**。信息发布中心、数据库、采购台账、采购进度、项目管理全部使用此模板。一个页面只有一个 `.page-hero`，放在最顶部。

### 结构

```tsx
<div className="page-hero">
  {/* 行 1：标题体 + 右侧操作 */}
  <div className="page-hero__row">
    <div className="page-hero__left">
      <div className="page-hero__icon">
        {/* Lucide 图标 17px，1.5px 描边 */}
      </div>
      <div>
        <div className="page-hero__title">页面名称</div>
        <div className="page-hero__sub">功能描述或统计摘要</div>
      </div>
    </div>

    <div className="page-hero__right">
      {/* page-hero__stat 统计 pill（可选） */}
      <span className="page-hero__stat page-hero__stat--info">共 N 条</span>
      <span className="page-hero__stat page-hero__stat--warn">
        <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--danger)]" />
        异常 N
      </span>
      {/* 操作按钮 — neu-btn-soft / neu-btn-primary */}
    </div>
  </div>

  {/* hairline 分割线 — 所有页面统一 */}
  <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }} />

  {/* 行 2：KPI 指标瓷片 或 搜索/筛选工具栏 */}
  {/* ... */}
</div>
```

### 子元素速查

| 类名 | 用途 | 细节 |
|------|------|------|
| `.page-hero__row` | 标题行容器 | `flex justify-between gap-1rem` |
| `.page-hero__left` | 左侧：图标井 + 标题体 | `flex items-center gap-0.875rem` |
| `.page-hero__icon` | 内凹图标井 | 40×40px，`inset 双影`，accent 色 |
| `.page-hero__title` | 页面标题 | `font-display` 1.15rem 500-weight，-0.015em tracking |
| `.page-hero__sub` | 副标题/统计摘要 | 0.75rem，muted-foreground |
| `.page-hero__right` | 右侧操作区 | `flex items-center gap-0.5rem` |
| `.page-hero__stat` | 统计 pill | 圆角 999px，边框 + 浅底 |
| `.page-hero__stat--info` | 蓝色信息 pill | accent 色系 |
| `.page-hero__stat--warn` | 红色预警 pill | danger 色系 |

### KPI 指标瓷片（.kpi-card）

```tsx
<div className="kpi-card group flex h-full flex-col gap-1.5 p-3">
  <div className="flex items-center justify-between gap-2">
    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">label</span>
    {/* 可选 signal 徽标：warning → 待处理橙 / danger → 风险红 / success → 正常绿 */}
    {signal && (
      <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ...">
        <span className={`h-1 w-1 rounded-full bg-[var(--success/warning/danger)]`} />
        {status}
      </span>
    )}
  </div>
  <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{value}</span>
  {sub && <span className="text-[10px] font-medium text-[var(--muted-foreground)]">{sub}</span>}
</div>
```

**kpi-card 三态：** 默认凸起（浅底 + 内高光 + 方向性双影），hover 抬升 `translateY(-1px)` + 暗影加深，无 active 态（不可点击）。

### 分割线规范

标题行与 KPI/搜索行之间**必须**有 hairline 分割线。所有页面统一参数：

```tsx
<div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }} />
```

切勿使用裸 `<hr>` 或 `border-t border-gray-200`。

### 完整示例（信息发布中心）

```tsx
<div className="page-hero">
  <div className="page-hero__row">
    <div className="page-hero__left">
      <div className="page-hero__icon"><Megaphone size={17} /></div>
      <div>
        <div className="page-hero__title">信息发布中心</div>
        <div className="page-hero__sub">招标公示、中标公示、政策法规、平台通知的起草与发布管理</div>
      </div>
    </div>
    <div className="page-hero__right">
      <button onClick={load} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} /></button>
      <button onClick={() => router.push('/notice/new')} className="neu-btn-soft"><PlusCircle size={15} /> 新建信息</button>
    </div>
  </div>

  <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }} />

  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
    <div className="kpi-card ...">{/* 已发布 */}</div>
    <div className="kpi-card ...">{/* 待处理草稿 */}</div>
    <div className="kpi-card ...">{/* 本月发布 */}</div>
    <div className="kpi-card ...">{/* 浏览总量 */}</div>
    <div className="kpi-card ...">{/* 缺招标文件 */}</div>
  </div>
</div>
```

---

## 渐变底板设计（.wb-panel / .neu-table-card 内置）

`.wb-panel` 和 `.neu-table-card` 自带从左纯白到右透明的渐变背景，无需外层包裹 `<div>`。多个并列/堆叠的组件共同形成整页从左到右的明→透视觉流动，与 `.page-hero` 的渐变方向一致（105deg）。

### 渐变值

```css
background:
  linear-gradient(105deg,
    oklch(1 0 0 / 0.94) 0%,              /* 左侧：近乎不透明纯白 */
    oklch(0.99 0.003 258 / 0.62) 35%,    /* 过渡点：高不透度暖白 */
    oklch(1 0 0 / 0.14) 70%              /* 右侧：高度透明 */
  );
```

### 为何嵌入组件而非外层包裹

- **零额外标记**：每个 `wb-panel` / `neu-table-card` 自动获得渐变，不需 `<div className="page-content-sheet">` 包裹层。
- **多组件协同**：同一页面内多个组件各自的渐变区域叠加，形成连续的从左亮→右透的视觉流。
- **方向一致**：渐变角度 105deg 与 `page-hero` 完全相同，整个页面从左到右呈现统一的明暗过渡。

### 反模式

| 错误 | 正确 |
|------|------|
| `<div className="page-content-sheet p-4"><div className="wb-panel">...` | 直接用 `<div className="wb-panel">`，渐变内置 |
| 再套一层容器只为加背景 | 背景是组件 CSS 的一部分 |

---

## 数据表格

`.neu-table-card` 套 `.neu-table` 是 cgzxui 的标准表格模式。信息发布中心列表、通知中心均使用此模板。

### 结构

```tsx
<div className="neu-table-card">
  {/* 批量操作浮条（有选中项时显示）—— 玻璃 + 内高光 + 滑入动画 */}
  {selectedCount > 0 && (
    <div className="neu-batch-bar">
      <span className="neu-batch-bar-count">已选 <strong>{N}</strong> 条</span>
      <div className="neu-batch-bar-spacer" />
      <button className="neu-btn-xs is-success">发布</button>
      <button className="neu-btn-xs is-warning">归档</button>
      <button className="neu-btn-xs is-danger">删除</button>
      <button className="neu-btn-xs">取消选择</button>
    </div>
  )}

  {/* 工具栏（可选）—— 底部 1px hairline 分割 */}
  <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
    <div className="neu-tab-bar">
      <button className="neu-tab is-active">Tab A</button>
      <button className="neu-tab">Tab B</button>
    </div>
    {/* 搜索/筛选 */}
  </div>

  {/* 表格主体 */}
  <div className="overflow-x-auto">
    <table className="neu-table w-full min-w-[760px]">
      <thead>
        <tr>
          <th style={{ width: 44 }}>
            <input type="checkbox" className="neu-checkbox" />
          </th>
          <th>列名</th>
          {/* 可排序表头 */}
          <th data-sortable="true" data-sort="desc">
            <button className="neu-th-sort">
              <span>列名</span>
              <span className="neu-sort-indicator"><Icon size={12} /></span>
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr className="row-clickable" data-selected="true">
          <td>...</td>
        </tr>
      </tbody>
    </table>
  </div>

  {/* 分页 */}
  <div className="neu-table-card-footer">
    <span>共 N 条 · 第 P/T 页</span>
    <div className="flex gap-1.5">
      <button className="neu-btn-xs">←</button>
      <button className="neu-btn-xs">→</button>
    </div>
  </div>
</div>
```

### 行交互四层递进

| 状态 | 选择器 | 效果 |
|------|--------|------|
| **默认** | `tbody tr` | `background: transparent` 融入卡片背景 |
| **hover** | `tbody tr:hover` | 白色半透底 + 抬升阴影 + 品牌蓝微光内描边 + `translateY(-1px)` |
| **选中** | `tbody tr[data-selected="true"]` | 品牌淡蓝半透底 + accent 2px 左侧色标 |
| **press** | `tbody tr.row-clickable:active` | 瞬时按入内凹 `scale(0.995)` |

### 表头与表头排序

- **thead**: 半透明浅底 + 下缘 hairline 内阴影
- **th**: 12px 加粗大写，muted-foreground
- **可排序 th**: `data-sortable="true"` + `data-sort="asc/desc"`
- **排序图标**: `.neu-th-sort` 按钮 + `.neu-sort-indicator` 包裹的 `ChevronUp/ChevronDown/ChevronsUpDown`

### 关键 CSS 类名

| 类名 | 用途 |
|------|------|
| `.neu-table-card` | 表格卡片外壳——透明毛玻璃 + 方向性双影 |
| `.neu-table` | 表格基类——`border-collapse` + 14px |
| `.neu-table-card-header` | 工具栏区——底部 1px hairline 分割 |
| `.neu-table-card-footer` | 分页区——顶部 1px hairline 分割 |
| `.neu-th-sort` | 排序表头按钮——透明底 + inline-flex |
| `.neu-sort-indicator` | 排序图标容器 |
| `.neu-checkbox` | 表格 checkbox——22px 圆形内凹 + checked 品牌蓝 + indeterminate 状态 |
| `.neu-batch-bar` | 批量操作浮条——玻璃 + 内高光 + 双影 + 滑入动画 |
| `.neu-tab-bar` | 内凹 tab 容器——inset 双影 + 圆角 14px |
| `.neu-tab` | 单个 tab 按钮——凸起 + hover 抬升 + `.is-active` 内凹 |
| `.neu-tab-count` | tab 右上角数字徽章 |

### 反模式（表格专项）

| 错误 | 正确 |
|------|------|
| `<table className="w-full border">` | `<table className="neu-table w-full">` |
| `<tr className="bg-blue-50">` 标记选中 | `<tr data-selected="true">` |
| `border-b border-gray-200` 行分割 | td 自带 `border-top: 1px solid oklch(.../0.06)` |
| 内联 `style={{ background: ... }}` 行高亮 | 使用 `data-selected` 属性 + CSS 选择器 |

## 模态弹窗 / 抽屉

```tsx
// 背景蒙层
<div className="fixed inset-0 z-50 flex items-center justify-center">
  <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />
  <div className="relative w-full max-w-[min(672px,92vw)] max-h-[90vh] overflow-y-auto rounded-[20px] bg-[var(--background)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]" role="dialog">
    {/* 标题 — 关闭按钮用 neu-btn-xs */}
    <div className="flex items-start justify-between gap-4 pb-4">
      <h2 className="text-lg font-semibold">标题</h2>
      <button onClick={onClose} className="neu-btn-xs"><X size={16} /></button>
    </div>
    {/* 表单 — input/select 用 workbench-input; textarea 用 neu-input text-sm */}
    <div className="space-y-4">
      <input className="workbench-input" placeholder="..." />
      <select className="workbench-input">...</select>
      <textarea className="neu-input text-sm" rows={3} />
    </div>
    {/* 分割线 */}
    <hr className="wb-section-rule" />
    {/* 按钮 — 统一 38px */}
    <div className="flex justify-end gap-3">
      <button className="neu-btn-soft is-danger h-[38px]">删除</button>
      <button className="neu-btn-soft h-[38px]">取消</button>
      <button className="neu-btn-primary !h-[38px]">保存</button>
    </div>
  </div>
</div>
```

**速查：**

| 场景 | 错误 | 正确 |
|------|------|------|
| 弹窗外壳 | `bg-white shadow-2xl` | `bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]` |
| 蒙层 | `bg-white/30` 或 `bg-black/30` | `bg-[var(--background)]/60` |
| 输入框/下拉 | `rounded-[16px] border border-gray-200 bg-white` | `workbench-input` |
| 文本框 | 同上 | `neu-input text-sm` |
| 主按钮 | `rounded-full bg-blue-500` | `neu-btn-primary` |
| 次要按钮 | `rounded-full border border-gray-200 bg-white` | `neu-btn-soft` |
| 关闭按钮 | `rounded-full hover:bg-white` | `neu-btn-xs` |
| 分割线 | `border-t border-gray-200` | `<hr className="wb-section-rule" />` |
| 保存按钮不齐 | 默认 44px vs 其他 38px | `neu-btn-primary !h-[38px]` |
