# 帮助中心页面 — 设计决策摘要

- **页面骨架严格遵循 skill 的"复制即用"模板**：`.flow-page` 根容器 + `<FlowBackdrop />` + `<UnifiedHeader />` + `.flow-back` 返回首页链接，与 procurement-portal/page.tsx 完全同构，确保顶栏、背景光晕、粒子、字体栈一致。
- **零内联视觉样式**：所有阴影、三态交互、背景均由既有 CSS 类名驱动（`.flow-back`、`.neu-card`、`.flow-cta`、`.announce-tabs`/`.announce-tab`、`.announce-title-group`），没有为按钮/卡片写任何自定义 box-shadow 或 background 内联值——这正是 skill 核心原则 #1 的直接落地。
- **FAQ 卡片用 `.neu-card` 凸起卡片**：继承方向性双影 + 内高光线 + hover 抬升 -2px，与首页公告卡片同一套物理语言；展开/折叠通过 maxHeight + opacity 过渡，遵守 reduced-motion（由 globals.css 全局 `prefers-reduced-motion` 覆盖）。
- **分类标签复用 `.announce-tabs` / `.announce-tab` 视觉系统**：通过 `--tab-color` CSS 变量驱动每个分类的配色，激活态呈品牌色填充 + 内凹，与首页公告 tab 在交互逻辑和视觉上完全统一，避免另造一套 tab 组件。
- **底部 CTA 用 `.flow-cta` glass 底栏 + `.flow-cta-btn` 品牌蓝按钮**：与 procurement-portal 底部 CTA 结构一致，形成跨页面的"结尾召唤"节奏；入场动画使用 `.flow-rise-1`~`.flow-rise-4` 递增延迟，与首页保持一致的淡入升起韵律。
