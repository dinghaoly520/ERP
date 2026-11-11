# 诊断：procurement-portal 返回首页按钮 inline style 导致风格失调与 hover 失效

## 问题描述

开发者在 `apps/public-portal/src/app/procurement-portal/page.tsx` 的「返回首页」按钮（`.flow-back`）上加了：

```tsx
style={{ background: '#ffffff', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
```

结果：
1. 视觉上和首页风格（毛玻璃 + 拟态浅色调）不搭。
2. hover 时没有反应（原本 `.flow-back:hover` 的颜色/阴影变化消失了）。

## 根因分析

### 1. Inline style 优先级高于 class 中除 `!important` 外的所有规则

CSS 优先级规则中，元素的 `style` 属性（inline style）比普通选择器（包括 `.flow-back:hover`）的优先级高。具体来说：

- Inline style 的声明优先级是 `(1, 0, 0, 0)` 级别（高于任何单类选择器）。
- `.flow-back:hover` 是 `(0, 0, 2, 0)`（两个类：`.flow-back` 和 `:hover`）。
- `.flow-back` 是 `(0, 0, 1, 0)`。

因为 inline `background` 和 `boxShadow` 的优先级压过了 `globals.css` 第 608-656 行 `.flow-back` 及其 `:hover` 状态里的同名属性，所以：

- `.flow-back` 自身的 `background: #f4f7fc` 和精心设计的 layered `box-shadow`（包括 inset 高光、双向柔光阴影，构成毛玻璃拟态质感）被 `#ffffff` 纯白 + 单层平铺阴影覆盖。
- `.flow-back:hover` 里的 `background: #eef2f8`、`color: #064ea2`、新的 `box-shadow` 变化全部失效 —— 因为 inline style 持续生效，hover 态在 `background` 和 `box-shadow` 上无法再覆盖它们。

`color`、`border` 等未在 inline style 中设置的属性，hover 仍会生效，但视觉上被"白底平铺阴影"主导，整块按钮看起来像贴了一块白纸，与首页清透水光 / 毛玻璃拟态风格（柔和的 `oklch()` 浅灰蓝底 + 双向柔光 + inset 高光）完全不协调。

### 2. 这是典型的 "inline style 反模式"

在已有 CSS 类的组件上加 inline style 来"快速调样式"，会：
- 破坏样式系统的可维护性（样式散落在 JSX 中，无法统一管理）。
- 屏蔽伪类/状态样式（`:hover`、`:active`、`:focus`）。
- 使 design token（如 `oklch`、CSS 变量）失效。
- 难以响应主题切换、dark mode 等。

## 正确做法

**移除 inline style，依靠已有的 `.flow-back` 类。** `globals.css` 已经为 `.flow-back` 写好了与首页完全一致的毛玻璃拟态风格及 hover/active 状态。

## 修正后的完整 `<a>` 元素

```tsx
<a href="/" className="flow-back">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
  返回首页
</a>
```

（即移除 `style={{...}}`，其余保持原样。）

## 推理说明

1. **`.flow-back` 已提供完整的设计语言一致样式**（`globals.css` 第 608-656 行）：
   - `background: #f4f7fc`（浅蓝灰底，与 `.flow-page` 的 `oklch(0.975 0.012 258)` 画布同色系）。
   - 多层 `box-shadow`：`inset 0 1px 0 oklch(1 0 0 / 0.7)` 顶部高光 + 双向柔光阴影，形成轻微凸起的毛玻璃质感。
   - `:hover` 态：`color: #064ea2`（品牌蓝）、`background: #eef2f8`、阴影加深；同时 `.flow-back-arrow` 通过 `.flow-back:hover .flow-back-arrow` 获得 `translateX(-4px)` 与淡蓝圆形背景，形成箭头联动。
   - `:active` 态：内凹阴影。
2. **Inline `#ffffff` 纯白 + `0 4px 20px rgba(0,0,0,0.1)` 单层柔光** 是通用的"卡片浮起"风格，与本页"清透水光"主题（柔和双向阴影 + inset 高光 + 半透明玻璃）完全不在一个设计语言里，因此"看着不搭"。
3. **如果确实想强调"返回"按钮的可见性**，正确做法是：
   - 修改 `.flow-back` 类本身的样式（在 `globals.css` 中调整），保持设计 token 与状态伪类联动；或
   - 新增一个修饰类（如 `.flow-back--prominent`）在 CSS 中扩展，而不是用 inline style 覆盖。
   绝不应该用 inline style 去 patch 一个已定义伪类状态的组件。

## 关键文件

- 页面：`/Users/qihao/ERP2/ERP/water-erp/apps/public-portal/src/app/procurement-portal/page.tsx`（第 28-31 行）
- 样式：`/Users/qihao/ERP2/ERP/water-erp/apps/public-portal/src/app/globals.css`（第 608-656 行，`.flow-back` 全套样式）
