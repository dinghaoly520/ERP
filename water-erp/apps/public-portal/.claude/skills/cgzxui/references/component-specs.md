# 组件 CSS 规格（cgzxui）

本文件是 `cgzxui` SKILL.md 的参考附录——按钮、卡片、输入框的完整 CSS 值。需要精确复制某个组件的视觉时查这里；平时只看 SKILL.md 的速查表就够了。

> 所有值同步自 `apps/public-portal/src/app/globals.css`。如果这里与源文件冲突，以 `globals.css` 为准。

## 目录

- [链接按钮（subtle neumorphic）](#链接按钮)
- [主要按钮（neu-btn-primary）](#主要按钮)
- [Hero CTA 按钮](#hero-cta-按钮)
- [CTA 底栏按钮](#cta-底栏按钮)
- [通用卡片（neu-card）](#通用卡片)
- [输入框（neu-input）](#输入框)

---

## 链接按钮

`.flow-back`（"返回首页"）与 `.announce-view-all`（"全部公告"）共享相同视觉，只是箭头方向不同。

```css
/* 类名换成 .flow-back 或 .announce-view-all */
.flow-back {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  gap: 6px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  color: #5a6d8a;
  background: #f4f7fc;
  border: none;
  border-radius: 8px;
  text-decoration: none;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),
    2px 2px 4px oklch(0.55 0.03 258 / 0.1),
    -1px -1px 3px oklch(1 0 0 / 0.85);
  transition: all 0.3s ease;
}
.flow-back:hover {
  color: #064ea2;
  background: #eef2f8;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.8),
    3px 3px 6px oklch(0.55 0.03 258 / 0.14),
    -2px -2px 5px oklch(1 0 0 / 0.9);
}
.flow-back:active {
  box-shadow:
    inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15),
    inset -2px -2px 5px oklch(1 0 0 / 0.5);
}

/* 箭头图标 — .flow-back-arrow 左滑，.announce-view-all-arrow 右滑 */
.flow-back-arrow {
  width: 18px;
  height: 18px;
  padding: 2px;
  border-radius: 50%;
  background: transparent;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s ease;
}
.flow-back:hover .flow-back-arrow {
  transform: translateX(-4px);          /* 返回首页：左滑（语义"后退"） */
  background: rgba(6, 78, 162, 0.08);
}
.announce-view-all:hover .announce-view-all-arrow {
  transform: translateX(4px);           /* 全部公告：右滑（语义"前进"） */
  background: rgba(6, 78, 162, 0.08);
}
```

`.neu-link` 是更经典的 neumorphic 链接（背景 `#e8ecf2`，更明显的凸起）：

```css
.neu-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: #18243a;
  padding: 0.5em 1.3em;
  font-size: 13px;
  font-weight: 600;
  border-radius: 0.5em;
  background: #e8ecf2;
  border: 1px solid #e8ecf2;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 5px 5px 10px #c5cad3, -5px -5px 10px #ffffff;
}
.neu-link:hover { border: 1px solid #fff; color: #064ea2; }
.neu-link:active { box-shadow: 3px 3px 8px #c5cad3, -3px -3px 8px #ffffff; }
```

---

## 主要按钮

`.neu-btn-primary` —— 品牌蓝实心按钮，用于主要操作（提交、登录、确认）。

```css
.neu-btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  padding: 0 28px;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: oklch(0.5 0.16 258);   /* var(--brand) */
  border: none;
  border-radius: 9px;
  cursor: pointer;
  box-shadow:
    3px 3px 6px oklch(0.5 0.08 258 / 0.25),
    -2px -2px 5px oklch(1 0 0 / 0.5);
  transition: all 0.2s ease;
}
.neu-btn-primary:hover {
  background: oklch(0.42 0.16 258);  /* var(--brand-deep) */
  transform: translateY(-1px);
  box-shadow:
    4px 4px 10px oklch(0.45 0.08 258 / 0.28),
    -2px -2px 6px oklch(1 0 0 / 0.55);
}
.neu-btn-primary:active {
  transform: translateY(0);
  box-shadow:
    inset 2px 2px 5px oklch(0.35 0.08 258 / 0.35),
    inset -2px -2px 5px oklch(1 0 0 / 0.25);
}
.neu-btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  box-shadow:
    2px 2px 4px oklch(0.5 0.05 258 / 0.15),
    -1px -1px 3px oklch(1 0 0 / 0.4);
}
```

---

## Hero CTA 按钮

`.hero-btn`（实心）/ `.hero-btn-outline`（描边）—— 首页 Hero 区的大号 CTA，52px 高，圆角 12px。

```css
.hero-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.875rem;
  height: 52px;
  min-width: 160px;
  padding: 0 32px;
  color: #fff;
  font-weight: 700;
  font-size: 16px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  background: oklch(0.5 0.16 258);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.25),
    3px 3px 8px oklch(0.25 0.06 258 / 0.4),
    -2px -2px 6px oklch(0.55 0.12 258 / 0.25);
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.35s ease, background 0.25s ease;
}
.hero-btn:hover {
  background: oklch(0.45 0.16 258);
  transform: translateY(-2px);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.3),
    5px 5px 14px oklch(0.2 0.06 258 / 0.45),
    -3px -3px 10px oklch(0.55 0.12 258 / 0.3);
}
.hero-btn:active {
  transform: translateY(0);
  box-shadow:
    inset 2px 2px 6px oklch(0.25 0.06 258 / 0.45),
    inset -2px -2px 6px oklch(0.6 0.12 258 / 0.2);
}
```

---

## CTA 底栏按钮

`.flow-cta-btn` —— CTA 底栏（`.flow-cta`）内的大号按钮，54px 高，圆角 14px。

```css
.flow-cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  height: 54px;
  padding: 0 32px;
  border: none;
  border-radius: 14px;
  background: var(--brand);
  color: #fff;
  font-family: inherit;
  /* hover/active 状态继承 .neu-btn-primary 的抬升/内凹模式 */
}
.flow-cta-btn.ghost {
  /* 幽灵变体：transparent 背景 + 描边 */
}
```

---

## 通用卡片

`.neu-card` —— 玻璃背景 + 内高光线 + 方向性双影。用于内容卡片、面板、信息块。

```css
.neu-card {
  background: oklch(1 0 0 / 0.55);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1.5px solid oklch(0.55 0.08 258 / 0.35);
  border-radius: 20px;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),
    2px 2px 6px oklch(0.55 0.03 258 / 0.12),
    -2px -2px 6px oklch(1 0 0 / 0.85);
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s ease, box-shadow 0.3s ease;
}
.neu-card:hover {
  transform: translateY(-2px);
  border-color: oklch(0.55 0.14 258 / 0.25);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.85),
    4px 4px 10px oklch(0.45 0.08 258 / 0.1),
    -2px -2px 8px oklch(1 0 0 / 0.9);
}
```

`.glass` 是更基础的玻璃面板（无凸起方向性双影，仅 backdrop-filter + 细边）：

```css
.glass {
  background: var(--glass);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid oklch(0.65 0.05 258 / 0.35);
  box-shadow: 0 8px 30px oklch(0.45 0.1 258 / 0.08), inset 0 1px 0 oklch(1 0 0 / 0.75);
  transition: border-color 0.25s ease;
}
```

---

## 输入框

`.neu-input` —— 内凹输入框（默认就呈"被按下"的凹陷感，与凸起按钮形成对比）。44px 高，圆角 9px。

```css
.neu-input {
  height: 44px;
  padding: 0 14px;
  border: 1px solid oklch(0.78 0.03 258 / 0.45);
  border-radius: 9px;
  font-size: 14px;
  color: #18243a;
  background: oklch(0.99 0.004 258);
  outline: none;
  box-shadow:
    inset 2px 2px 4px oklch(0.55 0.03 258 / 0.1),
    inset -2px -2px 4px oklch(1 0 0 / 0.7);
  transition: all 0.2s ease;
  width: 100%;
}
.neu-input::placeholder { color: #bcc6d4; }
.neu-input:focus {
  border-color: oklch(0.5 0.16 258 / 0.5);
  box-shadow:
    inset 2px 2px 4px oklch(0.55 0.03 258 / 0.08),
    inset -2px -2px 4px oklch(1 0 0 / 0.5),
    0 0 0 3px oklch(0.5 0.16 258 / 0.08);    /* focus 环 */
}
```

---

## 文件拖放区（.neu-drop-zone）

附件/招标文件的选择入口。一个内凹的 surface 底色区域，居中展示图标、文件名和提示文字，模拟"将文件放入凹槽"的物理感。点击触发 `<input type="file">`。

**使用模板：**

```tsx
<label className="neu-drop-zone">
  <Upload size={14} className="text-[var(--muted-foreground)] mb-1" />
  <span className="text-[0.75rem] font-medium text-[var(--muted-foreground)]">
    {file ? file.name : "选择文件"}
  </span>
  <span className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]/60">
    {file ? `${(file.size / 1024).toFixed(0)} KB` : "点击浏览或拖拽上传"}
  </span>
  <input type="file" className="hidden" onChange={...} />
</label>
```

**CSS 规格：**

```css
.neu-drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 12px;
  text-align: center;
  border-radius: 10px;
  background: var(--surface);
  box-shadow:
    inset 1px 1px 3px oklch(0.55 0.03 258 / 0.06),
    inset -1px -1px 3px oklch(1 0 0 / 0.5);
  transition: box-shadow 0.2s ease;
}

.neu-drop-zone:hover {
  box-shadow:
    inset 1px 1px 4px oklch(0.55 0.03 258 / 0.10),
    inset -1px -1px 3px oklch(1 0 0 / 0.55);
}
```

**关键设计点：**
- 无可见边框——只用内凹阴影定义区域边界
- hover 时内凹略微加深，暗示"可放入"
- 文件名和大小信息在同一区域展示，替代笨重的原生 `<input type="file">`
- 底部的"添加/上传"按钮用 `neu-btn-soft`（灰色凸起），不用 `neu-btn-primary`（品牌蓝）

---

## 附件列表项（.neu-attachment-item）

已上传文件的列表项。凸起的 surface 色块，带方向性双影，hover 抬升。

```css
.neu-attachment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--surface);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.5),
    1px 1px 2px oklch(0.55 0.03 258 / 0.05),
    -1px -1px 1px oklch(1 0 0 / 0.6);
  transition: box-shadow 0.2s ease;
}

.neu-attachment-item:hover {
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.6),
    2px 2px 4px oklch(0.55 0.03 258 / 0.10),
    -1px -1px 2px oklch(1 0 0 / 0.7);
}
```

**关键设计点：**
- 无可见框线——纯凹凸区分
- hover 时暗影加深、亮高光增强，产生"抬离表面"的感觉
- 右侧操作按钮（通常是删除）用 `neu-btn-xs is-danger`


---

## Page Hero（.page-hero）

页面标题卡片——所有数据管理页面的统一标题栏。玻璃渐变底 + 方向性双影 + ::after 彩色光晕装饰。

### CSS 规格

```css
.page-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  overflow: hidden;
  border-radius: 20px;
  border: none;
  background:
    linear-gradient(105deg, oklch(1 0 0 / 0.94) 0%, oklch(0.99 0.003 258 / 0.62) 55%);
  padding: 1.25rem 1.25rem;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.88),
    2px 2px 8px oklch(0.55 0.03 258 / 0.1),
    -2px -2px 8px oklch(1 0 0 / 0.9);
}

/* 右上角彩色光晕装饰 —— 品牌蓝 + 成功绿色 radial 渐变 */
.page-hero::after {
  content: "";
  position: absolute;
  top: -40%;
  right: -12%;
  width: 48%;
  height: 180%;
  background:
    radial-gradient(ellipse at 70% 35%, color-mix(in oklch, var(--accent) 8%, transparent) 0%, transparent 55%),
    radial-gradient(ellipse at 85% 60%, color-mix(in oklch, var(--success) 6%, transparent) 0%, transparent 50%);
  pointer-events: none;
}

/* 标题行 */
.page-hero__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

/* 左侧：图标井 + 标题体 */
.page-hero__left {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-width: 0;
}

/* 内凹图标井 */
.page-hero__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: oklch(0.985 0.005 258);
  color: var(--accent);
  box-shadow:
    inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14),
    inset -2px -2px 5px oklch(1 0 0 / 0.75);
}

/* 标题字体 */
.page-hero__title {
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 500;
  letter-spacing: -0.015em;
  line-height: 1.15;
  color: var(--foreground);
}

.page-hero__sub {
  margin-top: 0.2rem;
  font-size: 0.75rem;
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 1.3;
  color: var(--muted-foreground);
}

/* 右侧：统计标签 + 操作 */
.page-hero__right { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }

.page-hero__stat {
  display: flex; align-items: center; gap: 0.35rem;
  font-size: 0.688rem; font-weight: 600; white-space: nowrap;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  border: 1px solid oklch(0.6 0.04 258 / 0.22);
  background: oklch(0.99 0.004 258);
  line-height: 1.4;
}
.page-hero__stat--info  { color: var(--accent); border-color: color-mix(in oklch, var(--accent) 25%, transparent);
                         background: color-mix(in oklch, var(--accent) 6%, transparent); }
.page-hero__stat--warn  { color: var(--danger); border-color: color-mix(in oklch, var(--danger) 28%, transparent);
                         background: color-mix(in oklch, var(--danger) 6%, transparent); }
```

### 分割线规范

所有 page-hero 内部的行间分割线使用统一参数——置于标题行与 KPI/搜索行之间：

```tsx
<div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }} />
```

切勿使用裸 `<hr>`、`border-t` 或任何带可见边框的替代方案。

---

## KPI 指标瓷片（.kpi-card）

嵌入在 page-hero 内部的紧凑指标卡片。凸起浅底 + hover 抬升 + label/value/sub 纵向排版。

### CSS 规格

```css
.kpi-card {
  background: oklch(0.985 0.005 258);
  border: none;
  border-radius: 14px;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.85),
    2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.12),
    -2px -2px 5px oklch(1 0 0 / 0.9);
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}
.kpi-card:hover {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.9),
    4px 4px 8px oklch(0.55 0.03 258 / 0.15),
    -2.5px -2.5px 7px oklch(1 0 0 / 0.95);
}
```

### 排版结构

```
┌─ kpi-card ─────────────────────┐
│ LABEL (10px semibold uppercase)│
│ 1.55rem  VALUE (black tabular) │
│ sub (10px muted)               │
└────────────────────────────────┘
```

Signal 徽标可选：`warning` → 橙色"待处理" / `danger` → 红色"风险" / `success` → 绿色"正常"。徽标渲染在 label 右侧，9px 圆角 pill + 1px 圆点。

---

## 工作台面板（.wb-panel）

通用内容面板——左纯白→右透明渐变 + 方向性双影。用于工作台、个人中心、通知中心等内容区。**无可见 border**，纯阴影定义边界。与 `.neu-table-card` 共享相同的渐变底板公式。

### CSS 规格

```css
.wb-panel {
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  background:
    linear-gradient(105deg, oklch(1 0 0 / 0.94) 0%, oklch(0.99 0.003 258 / 0.62) 35%, oklch(1 0 0 / 0.14) 70%);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.8),
    3px 3px 14px oklch(0.5 0.06 258 / 0.18),
    -3px -3px 10px oklch(1 0 0 / 0.95),
    0 12px 24px oklch(0.48 0.07 258 / 0.14);
  min-height: 0;
}

.wb-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  flex-shrink: 0;
}

.wb-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
}
```

### 关键设计点

- **渐变背景**：105deg 左纯白→右透明，与 `.page-hero` 方向一致。多个面板堆叠时形成连续的从左亮→右透的页面级视觉流。
- **强凸起感**：4 层阴影（内高光 + 方向性双影 + 底部远方投影）产生比 `.neu-table-card` 更明显的"抬离页面"物理感。
- **不响应 hover**：`wb-panel` 是纯容器，不抬升也不变色——交互由内部子元素（按钮、表格行）承载。
- **头部/内容区分**：`wb-panel-header` 提供统一的标题栏 + 操作按钮区；`wb-panel-body` 提供可滚动的 flex-1 内容区。

---

## 数据表格卡片（.neu-table-card）

表格外壳——左纯白→右透明渐变毛玻璃 + 方向性双影。**无 visible border**，纯阴影定义边界。与 `.wb-panel` 共享相同的渐变底板公式。

### CSS 规格

```css
.neu-table-card {
  position: relative;
  background:
    linear-gradient(105deg, oklch(1 0 0 / 0.94) 0%, oklch(0.99 0.003 258 / 0.62) 35%, oklch(1 0 0 / 0.14) 70%);
  backdrop-filter: blur(18px) saturate(135%);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  border-radius: 20px;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.75),
    3px 3px 10px oklch(0.55 0.03 258 / 0.14),
    -2px -2px 8px oklch(1 0 0 / 0.9);
  transition: box-shadow 0.35s ease;
}
.neu-table-card:hover {
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.82),
    4px 4px 14px oklch(0.55 0.03 258 / 0.16),
    -3px -3px 10px oklch(1 0 0 / 0.95);
}
```

### 表格基类（.neu-table）

```css
.neu-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

/* thead: 透明底叠加表卡片渐变 + 上下立体阴影与 tbody 分层 */
.neu-table thead {
  background: transparent;
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.7),
    0 2px 6px oklch(0.55 0.03 258 / 0.1);
}
/* thead 与卡片顶部圆角对齐 */
.neu-table thead tr:first-child th:first-child { border-top-left-radius: 20px; }
.neu-table thead tr:first-child th:last-child  { border-top-right-radius: 20px; }

.neu-table th {
  padding: 14px 16px;
  font-weight: 700;
  font-size: 11.5px;
  text-align: center;
  white-space: nowrap;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--foreground);
}

.neu-table td {
  padding: 14px 16px;
  color: var(--foreground);
  border-top: 1px solid oklch(0.55 0.03 258 / 0.06);
  vertical-align: middle;
  text-align: center;
}
```

### 行交互四层

```css
/* 默认：完全透明，融入卡片背景 */
.neu-table tbody tr {
  background: transparent;
  transition: background 0.18s ease, box-shadow 0.22s ease, transform 0.18s ease;
}

/* hover：白色半透浮起 + 抬升投影 + 品牌蓝微光内描边 */
.neu-table tbody tr:hover {
  background: oklch(1 0 0 / 0.38);
  box-shadow:
    0 1px 3px oklch(0.55 0.03 258 / 0.06),
    inset 0 0 0 1px oklch(0.5 0.16 251 / 0.06);
  transform: translateY(-1px);
  position: relative;
  z-index: 1;
}

/* 选中：品牌淡蓝半透底 + accent 左侧色标 */
.neu-table tbody tr[data-selected="true"] {
  background: oklch(0.96 0.03 251 / 0.28);
  box-shadow: inset 2px 0 0 var(--accent-strong);
}
.neu-table tbody tr[data-selected="true"]:hover {
  background: oklch(0.95 0.035 251 / 0.40);
  box-shadow:
    inset 2px 0 0 var(--accent-strong),
    0 2px 6px oklch(0.55 0.03 258 / 0.08);
  transform: translateY(-1px);
}

/* press：瞬时按入内凹 */
.neu-table tbody tr.row-clickable:active {
  transform: scale(0.995);
  box-shadow: inset 1px 1px 3px oklch(0.55 0.03 258 / 0.08);
  transition: transform 0.06s ease, box-shadow 0.06s ease;
}
```

### 可排序表头

```css
.neu-table th[data-sortable="true"] {
  cursor: pointer;
  user-select: none;
  transition: color 0.2s ease;
}
.neu-table th[data-sortable="true"]:hover { color: var(--foreground); }

.neu-th-sort {
  display: inline-flex; align-items: center; gap: 5px;
  background: transparent; border: none;
}

.neu-sort-indicator { opacity: 0.45; transition: opacity 0.2s ease; }
.neu-table th[data-sortable="true"]:hover .neu-sort-indicator { opacity: 0.75; }
.neu-table th[data-sort="asc"] .neu-sort-indicator,
.neu-table th[data-sort="desc"] .neu-sort-indicator { opacity: 1; }
```

### Checkbox

```css
.neu-checkbox {
  appearance: none; width: 22px; height: 22px;
  border-radius: 7px; cursor: pointer;
  background: oklch(0.985 0.005 258);
  box-shadow:
    inset 2px 2px 4px oklch(0.55 0.03 258 / 0.12),
    inset -2px -2px 4px oklch(1 0 0 / 0.6);
  transition: all 0.2s ease;
}
.neu-checkbox:hover { background: var(--neu-raised-bg-hover); }
.neu-checkbox:checked {
  background: var(--accent);
  box-shadow: none;
}
.neu-checkbox:checked::after {
  content: ""; display: block;
  width: 6px; height: 10px;
  border: solid #fff; border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin: 3px 0 0 7px;
}
.neu-checkbox:indeterminate {
  background: var(--accent);
  box-shadow: none;
}
.neu-checkbox:indeterminate::after {
  content: ""; display: block;
  width: 10px; height: 2px;
  background: #fff; margin: 10px 0 0 6px;
}
```

### 批量操作浮条

```css
.neu-batch-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px;
  background: oklch(0.99 0.004 258 / 0.85);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  border-bottom: 1px solid oklch(0.55 0.08 258 / 0.18);
  animation: neuBatchBarIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes neuBatchBarIn {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### 关键设计点

- **渐变底板**：内置 105deg 左纯白→右透明渐变，与 `.page-hero` / `.wb-panel` 方向一致
- **无可见框线**：`.neu-table-card` 不含 `border` 属性，边界全靠方向性双影
- **行透明默认**：默认行 `background: transparent`，融入卡片渐变背景
- **四态递进**：默认 → hover 浮起 → 选中高亮 → press 按入，每层有不同阴影和变换
- **选中唯一标识**：`inset 2px 0 0 var(--accent-strong)` 左侧 2px 色标——不是 banned 的 `border-left` 大于 1px 通用侧条，而是选中态的语义化视觉反馈（宽度 ≤ 2px + 仅选中时出现）
- **排序反馈**：表头排序图标 opacity 随状态变化（默认 0.45 / hover 0.75 / active 1）
- **动画 > 静态**：批量操作条从 `translateY(-6px)` 滑入，选中行有 `transform: scale(0.995)` 按入反馈
