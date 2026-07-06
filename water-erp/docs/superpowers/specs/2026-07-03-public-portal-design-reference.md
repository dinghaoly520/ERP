# 信息门户（public-portal）设计参考手册

**日期**：2026-07-03  
**文件**：`apps/public-portal/src/app/globals.css`  
**适用范围**：所有 `apps/public-portal` 页面  
**需要设计定制时**：使用 `/neumorphic-design` skill 自动化生成

---

## 快速上手指南

在任何新页面中，只需 3 步即可拥有与首页一致的视觉：

```tsx
// 1. 页面容器 — 获得背景色 + 所有 CSS 变量
<div className="flow-page">

// 2. 装饰背景（光晕 + 粒子）— 可省略但推荐
<FlowBackdrop />

// 3. 按需使用以下组件/类名
```

`import { FlowBackdrop, FlowTrack } from '@/components/flow-stage';`
`import { UnifiedHeader } from '@/components/unified-header';`

---

## 一、CSS 类名速查表

### 页面容器

| 类名 | 作用 | CSS 行号 |
|------|------|----------|
| `.flow-page` | 页面容器：设置 `background: oklch(0.975 0.012 258)` 及所有 CSS 变量（`--brand`、`--fg` 等） | 528 |

### Neumorphism 按钮（凸起立体感）

| 类名 | 用途 | 默认背景 | 设计语言 | CSS 行号 |
|------|------|----------|----------|----------|
| `.flow-back` | "返回首页"链接 | `#f4f7fc` | 新拟态三层阴影 + 箭头左滑动画 | 608 |
| `.announce-view-all` | "全部公告"链接 | `#f4f7fc` | 新拟态三层阴影 + 箭头右滑动画 | 1877 |
| `.neu-btn-primary` | 主要操作按钮 | `#064ea2`（品牌蓝） | 新拟态 shadow + hover lift | 137 |

### Neumorphism 卡片/容器

| 类名 | 用途 | 效果 | CSS 行号 |
|------|------|------|----------|
| `.neu-card` | 通用卡片 | 内高光线 + 方向性双影 | 89 |
| `.neu-input` | 输入框 | 内凹 inset shadow | 111 |
| `.flow-cta` | CTA 底栏 | glass 面板 + 径向光芒 | 1390 |
| `.flow-cta-btn` | CTA 按钮 | 新拟态 + hover 上浮 | 1439 |

### 公告区域组件

| 类名 | 用途 | CSS 行号 |
|------|------|----------|
| `.announce-tabs` | Tab 切换容器 | 1819 |
| `.announce-tab` | 单个 Tab 按钮 | 1827 |
| `.announce-tab.is-active` | 激活态 Tab（内凹） | 1857 |
| `.announce-featured` | 精选公告大卡片 | 1921 |
| `.announce-side` | 侧边列表容器 | 2132 |
| `.announce-side-item` | 列表子项 | 2188 |

### Hero / 品牌区域

| 类名 | 用途 | CSS 行号 |
|------|------|----------|
| `.flow-hero` | Hero 区域容器 | 659 |
| `.flow-hero-brand` | 品牌标识块（logo + 名称） | 2306 |
| `.flow-hero-split` | 左文右图 Hero 布局 | 700 |
| `.hero-btn` | Hero CTA 实心按钮 | 178 |
| `.hero-btn-outline` | Hero CTA 描边按钮 | 178 |

### 装饰性元素

| 类名 | 用途 | CSS 行号 |
|------|------|----------|
| `.flow-glow` | 页面四角色彩光晕 | 2423 |
| `.flow-particles` | 浮动粒子容器 | 2443 |
| `.flow-particle` | 单个浮动粒子 | 2450 |
| `.flow-rise-1` ~ `.flow-rise-4` | 淡入升起入场动画 | 2721 |

### 流程展示组件

| 类名 | 用途 | CSS 行号 |
|------|------|----------|
| `.flow-pipe-shell` | 流程图谱外层 glass 壳 | 2649 |
| `.flow-h` | 横向流程滑动轨道 | 1037 |
| `.flow-h-card` | 流程阶段卡片 | — |
| `.flow-chip` | 角色标签 | 1342 |

---

## 二、Neumorphic 设计色值体系

所有阴影以页面背景 `oklch(0.975 0.012 258)` 为基准推导：

| 角色 | 色值 | 不透明度范围 | 用途 |
|------|------|-------------|------|
| 亮高光 | `oklch(1 0 0)` | 0.7–0.95 | 顶/左边缘光源 |
| 暗投影 | `oklch(0.55 0.03 258)` | 0.08–0.18 | 底/右纵深 |
| 悬停远程投影 | `oklch(0.45 0.08 258)` | 0.10–0.12 | 悬停远距离抬升 |
| 内高光线 | `inset 0 1px 0 oklch(1 0 0)` | 0.7–0.85 | 组件顶部物理边缘光感 |

### 三态模式

```css
/* 默认 — 凸起 */
background: #f4f7fc; /* 比页面背景稍亮 */
box-shadow:
  inset 0 1px 0 oklch(1 0 0 / 0.7),           /* 顶缘高光 */
  2px 2px 4px oklch(0.55 0.03 258 / 0.1),     /* 右下暗影 */
  -1px -1px 3px oklch(1 0 0 / 0.85);           /* 左上亮光 */

/* 悬停 — 抬升 */
background: #eef2f8;
box-shadow:
  3px 3px 6px oklch(0.55 0.03 258 / 0.14),
  -2px -2px 5px oklch(1 0 0 / 0.9);

/* 按下 — 内凹 */
box-shadow:
  inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15),
  inset -2px -2px 5px oklch(1 0 0 / 0.5);
```

---

## 三、"返回首页"按钮 — 完整示例

```tsx
{/* 最简用法 — 全自动继承所有设计 */}
<a href="/" className="flow-back">
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" className="flow-back-arrow">
    <path d="M15 18l-6-6 6-6"/>
  </svg>
  返回首页
</a>
```

`.flow-back` 类名包含完整设计：`#f4f7fc` 背景、neumorphic 三层阴影、`#064ea2` hover 变色、`#eef2f8` hover 背景、箭头左滑动画、按下内凹反馈。

---

## 四、获取设计帮助的方式

| 方式 | 说明 |
|------|------|
| `/neumorphic-design` | 自动为当前任务中的组件应用新拟态凸起边框设计 |
| `docs/superpowers/specs/2026-07-02-announcement-raised-border-design.md` | 公告区域新拟态设计详细规格 |
| `apps/public-portal/.claude/skills/neumorphic-design/SKILL.md` | Neumorphism 设计 skill 完整文档 |
| `apps/public-portal/src/app/globals.css` | 所有 CSS 类名的单一来源（搜 `/＊ ──` 找章节） |
| `apps/public-portal/src/app/home-client.tsx` | 首页参考实现 |

---

## 五、相关设计规格文档

| 文档 | 内容 |
|------|------|
| `2026-07-02-announcement-raised-border-design.md` | 公告区域新拟态边框凸起设计 |
| `2026-07-02-flow-back-unify-design.md` | 返回首页按钮样式统一 |
| `2026-06-18-bid-portal-redesign.md` | 开评标管理端重设计 |
| `2026-06-14-3004-procurement-redesign-design.md` | 供应商门户采购重设计 |
| `2026-06-13-admin-workbench-redesign-design.md` | 采购管理工作台重设计 |
