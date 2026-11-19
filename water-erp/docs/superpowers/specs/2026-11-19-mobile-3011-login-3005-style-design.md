# 3011 登录页适配手机端并应用 :3005 登录设计（2026-11-19）

## 背景与目标

:3011 移动驾驶舱登录页现为素卡片式（logo 白框 + `neu-card-static` 表单 + 主按钮），无任何特效。目标：**适配手机端**，同时把 :3005 采购管理工作台登录页的设计语言整套移植过来——光芒背景、SplashCursor 流体墨迹、徽标悬浮、彩色流转标题、流光口号、瓷面输入壳、瓷面登录钮、TrueFocus 逐字落款、错落上滑入场。

## 用户裁定（2026-11-19）

1. **口号**：沿用 3005 同款「坚持原则，坚定立场，坚决执行」；主标题保留 3011 自己的「蜀水云采·专属驾驶舱」。
2. **滑动特效**：流体墨迹 + 上滑入场都要；流体在手机端降渲染分辨率，WebGL 不可用自动退场。
3. **技术路线（方案 A · 零新依赖）**：不引入 framer-motion。SplashCursor 原样拷贝（纯 React hooks）；TrueFocus 去 framer-motion 重写；入场/浮动/微交互全 CSS keyframes。

## 范围界定

- **只动视觉**：`redirect` 回跳参数、错误处理、登录调用逻辑不动。
- **不加**注册/忘记密码/记住密码——web 专属流程，3011 演示驾驶舱无此后端面。
- 登录页**去掉现有 `flow-glow`**：3005 的光芒背景（径向色洗 + 光柱 + veil）自成体系，叠加 flow-glow 会串色。
- 落款文案与 3005 相同：「四川省水利发展集团有限公司　制」（同主体）。

## 页面结构

```
<div class="login-stage ambient-grid flow-page">（min-h-dvh，单列居中，内容列 max-w 430px）
├─ .login-stage__rays（5 道光柱 + 源呼吸 + 雾霭，同 web 全套 keyframes）
├─ <SplashCursor />（fixed z-50 pointer-events:none，touch 滑动出墨迹）
├─ .login-stage__veil（薄纱）
└─ 内容列（relative z-[60]）
   ├─ .login-mark（双光晕 --soft/--rich + 光环 + logo 60px；8.2s 浮动循环）
   ├─ .login-title--gradient「蜀水云采·专属驾驶舱」（12s 彩色流转）
   ├─ .login-slogan「坚持原则，坚定立场，坚决执行」（流光渐变 + 两侧细线）
   ├─ 表单（裸输入壳，无卡片容器——同 3005）
   │   ├─ .login-field-shell 账号（UserRound 图标轨，sr-only label）
   │   ├─ .login-field-shell 密码（KeyRound 金色 accent 轨 + Eye/EyeOff 切换钮）
   │   ├─ 错误提示：无框色调告警条（color-mix 底色，无 border）
   │   └─ .login-submit-button 52px 瓷面（「登 录」宽字距 + ChevronRight 箭头徽标 + :active 按压）
   └─ .login-credit TrueFocus 逐字特效「四川省水利发展集团有限公司　制」
```

## 手机端适配要点

| 项 | 处理 |
|---|---|
| iOS 聚焦缩放 | 输入 `font-size: 16px`（<16px 会触发页面缩放） |
| 触控目标 | 输入壳高 ~56px（pt-4/pb-4 + 16px 字自动撑起）；登录钮 52px；眼睛切换钮 ≥40px 热区 |
| 安全区 | `padding-bottom: env(safe-area-inset-bottom)`（viewportFit=cover 已配） |
| 640px 断点 | 沿用 web 已调参数：rays 56vh、veil inset 收窄、slogan 字距 0.18em、细线 22px |
| 降载 | SplashCursor dye 分辨率按视口取：短边 <640px → 1024，否则 1408（组件内部计算，不影响 SSR 标记） |
| 无 hover 依赖 | 箭头徽标 hover 滑动保留（桌面预览），触屏走 `:active` 按压反馈 |

## 组件与 CSS 落点

各门户自持副本（cgzxui 约定，跨门户不共享组件包）：

| 文件 | 动作 |
|---|---|
| `apps/mobile-portal/src/components/splash-cursor.tsx` | 新建：从 `apps/web/src/components/SplashCursor.jsx` 拷贝转 .tsx。改动仅两处：① dye 分辨率组件内按视口取值；② `useEffect` 入口加 `matchMedia('(prefers-reduced-motion: reduce)')` 检查，reduce 时直接 return（web 版未做，mobile 补上）。调色板 `["#7aa8ff", "#f0c676", "#72c7b3"]` 由页面传入，参数同 web（SIM 128 / DENSITY_DISSIPATION 3.5 / VELOCITY 2 / PRESSURE 0.1 / CURL 3 / SPLAT_RADIUS 0.15 / SPLAT_FORCE 3000）。canvas 定位用内联 style 属组件固有实现（web 同款，红牌豁免——特效画布非 UI 表面） |
| `apps/mobile-portal/src/components/true-focus.tsx` | 新建：去 framer-motion 重写。API 保持页面所需子集（sentence/separator/blurAmount/borderColor/glowColor/animationDuration/pauseBetweenAnimations，manualMode 恒 false 可不实现）。实现：`setInterval` 推进激活下标；字 span 用 `.is-active` class 切 `filter: blur(3px)↔blur(0)`（CSS transition）；聚焦框 = 绝对定位 div，`left/top/width/height` 由 ref 测量写入 style，CSS `transition: all 0.5s ease` 平滑滑动，四角 corner span 同 web |
| `apps/mobile-portal/src/app/globals.css` | 新增 login 段（类名与 web 同名 `login-*`）：`login-stage`（含 ::before 色洗）/`__rays`/`__veil`/`login-mark`/`login-title--gradient`/`login-slogan`/`login-field-shell`（含 icon-rail/line/focus-within 全套）/`login-field-toggle`/`login-submit-button`/`login-arrow-badge`/`login-credit` + TrueFocus 所需 `.focus-*`/`.corner` 样式。另加 mobile 专属：`login-rise-*` 入场动画（替代 framer-motion，见下）、`login-mark-float` 浮动循环、640px 断点、`prefers-reduced-motion` 全量禁用段 |
| `apps/mobile-portal/src/app/login/page.tsx` | 重写：结构如上；沿用现有 `login()` 调用、`redirect` 回跳、错误 state |

### CSS 替代 framer-motion 的映射

| web（framer-motion） | mobile（CSS） |
|---|---|
| 入场 `opacity:0,y:N→1,0`（delay 0.08→0.54 递增） | `@keyframes login-rise`（`opacity 0→1` + `translateY(14→0)px`，`0.66s var(--ease-out-quint) both`），各元素 `animation-delay` 0.08/0.16/0.22/0.30/0.38/0.46/0.54s 对齐 web 节奏。纯 CSS both-fill，**无需** web 的 `cr-login-fallback` 兜底（无 JS 依赖的 opacity:0） |
| 徽标 8.2s 浮动（y/rotate/scale 关键帧数组） | `@keyframes login-mark-float`（`translateY(0/-10/0/4/0)` + `rotate(0/-2/0/2deg)` + `scale(1/1.06/1/1.03/1)`，8.2s ease-in-out infinite） |
| 按钮 `whileHover y:-2` / `whileTap scale:0.98` | `:hover` 保留微抬（桌面）；`:active { transform: scale(0.98) }` 触屏按压 |

### 落款双渲染路径（铁律）

`login-credit` 按 `prefers-reduced-motion` 双渲染（同 web，防逐字串漏改——见 memory `per-char-encoded-text-evades-grep`）：reduce 时渲染 `.login-credit__static` 静态整句，否则渲染 `<TrueFocus sentence="四|川|省|水|利|发|展|集|团|有|限|公|司| |制" separator="|" blurAmount={3} borderColor="#7aa8ff" glowColor="rgba(122, 168, 255, 0.18)" animationDuration={0.5} pauseBetweenAnimations={1} />`。**两处文案改动必须同步改两路**。

## 错误提示样式

登录失败沿用 inline 展示（不弹窗——手机端表单内即时反馈更合适），重样式化为无框色调告警条：`color-mix(in oklch, var(--danger) 8%, transparent)` 底 + `var(--danger)` 文字，无 border（清掉现存 `border border-[color-mix(...)]` 写法）。

## 验收标准

1. `pnpm --filter mobile-portal lint`、`pnpm --filter mobile-portal build` 通过。
2. 375/390/414px 视口 + 桌面窄窗：标题/口号不换行溢出、光柱收窄、按钮全宽、安全区不裁切；截图核对与 3005 视觉语言一致。
3. 触摸模拟下滑动出彩色墨迹；WebGL 禁用时页面正常渲染（墨迹退场不报错）。
4. `prefers-reduced-motion: reduce`：所有动画/墨迹/TrueFocus 静态化，落款显示静态整句。
5. 输入聚焦无 iOS 缩放（16px 字号）。
6. **不实际提交登录**——admin 为单设备会话，Playwright/验收登录会把正在浏览的用户踢下线（memory `no-login-kick-during-verification`）；提交按钮点击链路由用户本人验证。
