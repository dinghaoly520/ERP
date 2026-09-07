# T3.3 台账 — supplier-portal-next globals.css 三层级联去重

**日期**：2026-09-07 · **文件**：`apps/supplier-portal-next/src/app/globals.css` · **行数**：14278 → 13612（−666）
**方法**：逐选择器属性级 diff（L1=第一层 cgzxui 移植段 ~L8771-11005；L2=第二层 Part 2 重定义段 ~L11779-12104，均在**原文件行号**上盘点）。处置原则：L2 在后者对同特异性属性已胜出（删 L1 不改变现状）；L1 独有属性今日仍生效 → 并入 L2 后再删 L1；L1 独有子规则（无 L2 对应）→ 原文搬至 L2 同族定义旁。**搬移规则均为逐字移动（verbatim）**。
**级联等价性机器验证**：对 113 个受影响选择器逐个计算全文件有效声明集（后写胜出），改前改后完全一致（唯二例外见「微差对齐」）。

## 一、台账总表（删除 L1 重复定义）

「二层行号」为**改后**文件中的单一定义源位置；「一层行号」为原文件位置（已删）。

| 选择器族 | 一层行号(原) | 二层行号(新) | 一层独有属性/规则 | 处置 | 依据 |
|---|---|---|---|---|---|
| `.flow-back` + `:hover`/`:active`/`-arrow`/`:hover -arrow` | 8867-8911 | 11400 起 | 无（5 规则逐字节相同） | 删一层 | 完全同文副本 |
| `.neu-btn-primary` | 8975-9015 | 10924 | `white-space: nowrap` | 并入二层+删 | nowrap 是今日实际生效值 |
| `.neu-btn-primary.is-success/.is-danger`（×4 含 hover） | 9018-9029 | 10938 后 | 整组规则 | 搬至二层 | L1 独有语义色变体 |
| `.neu-link` | 9037-9060 | 11012 | `white-space: nowrap`；:hover 的 `border: 1px solid #fff` | 并入二层+删 | 同上 |
| `.neu-btn-soft` | 9063-9095 | 10954 | `text-decoration: none`、`white-space: nowrap`；:hover 的 `color: var(--accent-strong)`；:disabled + is-success/warning/primary 族 ×8 | 并入+搬移+删 | 独有属性与变体保留语义 |
| `.neu-btn-xs` | 9113-9144 | 10981 | `white-space: nowrap`；:hover 的 `background`；:disabled + is-*:hover ×3 + is-info ×2 | 并入+搬移+删 | 同上（is-success/danger/warning 基线单行与二层完全同文，直接删） |
| `.neu-card` | 9158-9180 | 11115 | `backdrop-filter`/`-webkit-backdrop-filter`；:hover 的 `border-color` | 并入二层+删 | 独有属性；`.neu-card-static`(9183) 非重复保留原地 |
| `.neu-input, .neu-select` 族（base/::placeholder/:focus/textarea） | 9244-9283 | 11027 | `.neu-select` 选择器部分；textarea `line-height: 1.6` | 并入二层选择器+删 | 见「微差对齐」 |
| `.neu-drop-zone` + `:hover` | 9285-9303 | 11187 | 无 | 删一层 | 全属性覆盖 |
| `.neu-attachment-item` + `:hover` | 9310-9328 | 11196 | 无 | 删一层 | 全属性覆盖 |
| `.workbench-input` 族（base/::placeholder/:focus） | 9404-9431 | 11027 | 无 | 删一层 | 被二层 `.neu-input,.workbench-input` 组合+height 覆盖；`select.workbench-input`(9432) 非重复保留 |
| `.neu-tab-bar` | 9446-9455 | 11256 | 无 | 删一层 | 全属性覆盖 |
| `.neu-tab` | 9456-9479 | 11263 | `position: relative`、`box-shadow`、`white-space` | 并入二层+删 | position:relative 为 sp-tab-line::after 定位锚，必须保留 |
| `.neu-tab:active` | 9480-9484 | 11272 | 整条规则 | 搬至二层 | L1 独有 |
| `.neu-tab.is-active` | 9485-9493 | 11270 | 无 | 删一层 | 二层 `.is-active,.active` 双命名覆盖 |
| `.neu-tab-count` + `.is-active .neu-tab-count` | 9494-9502, 9550-9553 | 11281 | 整组规则 | 搬至二层 | L1 独有（14260 `.sp-tab-line .neu-tab-count` 高特异性在锚点段，不受搬移影响） |
| `.neu-table-card` | 9657-9669 | 11176 | `transition: box-shadow 0.35s ease` | 并入二层+删 | 独有属性 |
| `.neu-table-card:hover` | 9670-9675 | 11182 | 整条规则 | 搬至二层 | L1 独有 |
| `.neu-table-card-header/footer` | 9676-9683 | 11183/11184 | `border-bottom`/`border-top`（1px hairline） | 并入二层+删 | 独有属性（与二层 inset box-shadow 并存为今日实况） |
| `.neu-table` 基族（base/th/td/tbody tr/:hover/[data-selected]/.row-clickable×2） | 9685-9770 | 11191 | td 的 `text-align: center`、`border-top` hairline；:active 的 `transition 0.06s` | 并入二层+删 | 其余属性二层覆盖（padding 13 vs 14、渐变 hover 等以二层为准=今日实况） |
| `.neu-table thead` + 双圆角 + `[data-selected]:hover` | 9693-9703, 9753-9761 | 11200 | 整组规则 | 搬至二层 | L1 独有 |
| 排序族 `th[data-sortable]`/`.neu-th-sort`/`.neu-sort-indicator`/asc/desc | 9772-9807 | 11231 | 整组规则 | 搬至二层 | L1 独有（任务书点名） |
| `.wb-panel`/`-header`/`-body` | 9933-9984 | 11110/11120/11121 | 无 | 删一层 | 二层 `.wb-panel,.neu-card` 组合覆盖；`.tender-nav-tile`(9952) 非重复保留 |
| `.wb-section-rule` | 10034-10039 | 11122 | 无 | 删一层 | `var(--hairline)` 与一层原始值等价 |
| `.wb-list-item` 族 ×7 + `.wb-section-title` | 9985-10033 | 11125 | 整组规则 | 搬至二层 | L1 独有（任务书点名） |
| `.kpi-card` | 10062-10071 | 11087 | 无 | 删一层 | 二层含 flex 布局超集 |
| `.kpi-card:hover` | 10072-10078 | 11096 | 整条规则 | 搬至二层 | 作用于全部 kpi-card（非仅 .clickable），L1 独有 |
| `.page-hero` 基族（base/::after/__row/__left/__icon/__title/__right/__stat/--warn） | 10079-10176 | 11044 | __sub 的 `font-weight: 400; letter-spacing: 0.01em`；--warn 的 `border-color` | 并入二层+删 | 其余以二层为准（font-weight 600、oklch 258 色相等=今日实况） |
| `.page-hero__divider` | 10162-10166 | 11078 | 整条规则 | 搬至二层 | L1 独有（任务书点名） |
| `.page-hero__stat--info` | 10177 | 11075 | 整条规则 | 搬至二层 | L1 独有（任务书点名） |

## 二、保留项 + 理由（不动）

| 项 | 理由 |
|---|---|
| `.flow-glow` 双定义（8824 / 11726）+ `glow-drift` ×2 | 任务书点名不动（layout.tsx 活体） |
| GLOBAL RESET !important 段（11745-11778） | 任务书点名不动（旧类合规化安全网），改前改后逐字节一致 |
| 文件末尾「契约测试锚点恢复」（13964 起）全部内容 | 任务书点名不动，改前改后逐字节一致（含 `.neu-tab.sp-tab-line`、`.sp-tab-line .neu-tab-count`、`.sp-hero .page-hero__title` 等高特异性后置规则，均不受搬移影响） |
| `.neu-card-static`(9183)、`select.workbench-input`(9432)、`.neu-tile` 族、`.neu-toggle`、`.neu-tag`、`.neu-checkbox`、`.neu-batch-bar`、`.wb-toolbar`、`.tender-nav-tile`、`.wb-timeblock-card`、`.search-box` 族、`.neu-thead`、`.neu-icon-well`、chat-*/step-*/stage-*/biz-tag 等其余 L1 段 | 非重复定义（单一来源），原地保留 |
| L1 段 8 处 `@media (prefers-reduced-motion)` 块 | 非重复（选择器集与二层 media 块不同）；其中引用被删类名的 transition:none 声明本就被二层后置 base+`!important` media 压制，删除与否无行为差异，按保守协议不动 |
| 旧 sp-* 段内部重复对（`.sp-card`/`.sp-module`/`.sp-page-hero-card`/`.sp-header`×3 等，位于 11005-12104 内部或涉锚点段） | 非本任务范围（跨层关系为 sp 段↔SHELL OVERRIDE !important 段，属另一安全网体系）；涉 13964+ 锚点段者明令不动 |
| `.neu-input.is-invalid` 组合（原 10701） | 非重复，原地保留（特异性 (0,2,0) 高于 base，与位置无关） |

## 三、微差对齐（唯一两处声明级变化，均为不可感知级）

`.neu-select` 原先仅有 L1 定义；并入二层 `.neu-input, .neu-select, .workbench-input` 后对齐新轨值：
- `border` alpha 0.45→0.4；`color` var(--foreground)(oklch 0.28 0.03 258)→var(--ink)(oklch 0.24 0.038 258)；补 `font: inherit`；`transition` 仅写法差（0.2s↔.2s）。
- `.neu-select:focus` 色相 251→258（同 `--brand` 定义族）。均为同族输入框统一新轨设计语言的亚感知差，符合「单一来源」目标。

## 四、顺手项（死 CSS 删除）

`.glass-card-blue/purple/emerald/amber/rose` 五色调变体（原 11502-11560）：自定义属性块 + `::before` background-image 规则整删。依据：(a) 全 src 零 TSX/TS 引用（grep 验证 0 处）；(b) GLOBAL RESET 已对 `.glass-card::before` 施 `display:none !important`，双重死。基类 `.glass-card/-deeper/-lighter` 不在本任务声明范围，保留。

## 五、验证（全绿）

- `pnpm test`：**125/125 pass 0 fail**
- `npx tsc --noEmit`：**0 错误**
- `pnpm lint`：**0 errors**（299 warnings 为既有 no-explicit-any 基线，未触碰）
- `bash scripts/check-cgzxui-redcards.sh --ci`：**红牌 0 处 → PASS**（无回退）
- `pnpm build`：**成功**（见「偏差」）
- lightningcss 1.32.0 全文件 transform：**通过**（语法完整）
- 级联等价性：113 个受影响选择器有效声明集改前后一致（脚本验证，仅第三节两处声明级微差）

## 六、偏差说明

1. **构建在 HEAD 上即红**：`src/styles/pages/announcements.css:8` 注释文本含字面 `*/`（`nd-*/notif-*`）提前终止块注释 → Turbopack `Unexpected token Delim('*')`。该文件 git 干净（无未提交改动、mtime 早于本任务开工 2 小时），属既有已提交缺陷，与本任务改动无关。本任务做了最小修复：注释文本改写为 `nd-* / notif-* 前缀族`（零样式影响），随本 commit 一并提交。
2. 盘点额外发现并处置了任务书「可能还有更多」清单之外的两族：`.neu-drop-zone`/`.neu-attachment-item`（全属性覆盖 → 删一层）。
