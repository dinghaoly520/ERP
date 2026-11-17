# :3011 一屏总览改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 数据库页与台账页收短为一屏总览（分析模块进宫格弹层、台账列表显示层控量），零 API 改动。

**Architecture:** 纯前端 JSX 重组——dashboard 页把 10 张分析卡搬进单状态驱动的 BottomSheet（`analysisOpen` 五组），ledger 页用 `visibleCount` 显示层控制替代触底自动加载。所有数据拉取/状态/下钻弹层不动。

**Tech Stack:** Next.js 16 App Router + React 19 + Tailwind v4（cgzxui 视觉体系）。

**Spec:** `docs/superpowers/specs/2026-11-17-mobile-3011-one-screen-overview-design.md`

## Global Constraints

- 零 API / 后端 / 数据口径改动；进展页、水叮当页不动。
- 不动：下拉刷新（usePullToRefresh）、filter-store 记忆、指标卡环比 delta、今日要报卡、趋势图、AI 综合分析折叠卡、focusPmi 桥接。
- 视觉走 cgzxui：neu-card-static 瓷面卡 + 图标井（color-mix 底色）+ lucide 1.5px 图标 + m-rise 入场；禁渐变按钮/emoji 图标/扁平阴影。
- dev 服务已在跑（:3011）；改完每任务用无头浏览器量化验收，不用肉眼。
- 提交只 add 明确改动文件；commit 尾行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

---

### Task 1: 台账页显示层控量（默认 5 条 + 手动展开更多）

**Files:**
- Modify: `apps/mobile-portal/src/app/(main)/ledger/page.tsx`

**Interfaces:**
- Consumes: 现有 `items`/`page`/`totalPages`/`total`/`loadingMore`/`loadMore`（均在文件内已有）。
- Produces: 无对外接口（页面内部重组）。

- [ ] **Step 1: 加 `visibleCount` 状态与常量**

在 `const [retryTick, setRetryTick] = useState(0);`（约 :81）后加：

```tsx
/* 一屏总览（2026-11-17 spec）：拉取层不变（15/页），显示层默认 5 条、
   「展开更多」每次 +10；筛选/搜索变化重置回 5 */
const VISIBLE_INIT = 5;
const VISIBLE_STEP = 10;
const [visibleCount, setVisibleCount] = useState(VISIBLE_INIT);
```

- [ ] **Step 2: 删 IntersectionObserver 触底自动加载**

删除 `sentinelRef` 声明（约 :86）、`loadMore` 之后的整个 IntersectionObserver effect（约 :226-238，含 `useEffect(() => { const el = sentinelRef.current; ... io.disconnect(); };`）。`loadMore` 函数本身保留（按钮复用）。

- [ ] **Step 3: 重置点补 `setVisibleCount(VISIBLE_INIT)`**

两处 `setPage(1)` 旁各加一行：
1. `changeFilter`（约 :240）：`const changeFilter = (fn: () => void) => { fn(); setPage(1); setVisibleCount(VISIBLE_INIT); };`
2. 搜索防抖 effect（约 :89-95）：`setSearchKeyword(searchInput.trim()); setPage(1);` 后加 `setVisibleCount(VISIBLE_INIT);`

- [ ] **Step 4: 列表切片渲染 + 展开按钮**

列表渲染（约 :412 `<div className="space-y-2.5">`）改为映射切片：

```tsx
{items.slice(0, visibleCount).map((item) => {
```

（map 体原样不动。）触底哨兵/末尾区块（约 :457-465）整块替换为：

```tsx
{/* 展开更多 / 末尾（2026-11-17：触底自动加载改手动，防滚动即翻页回到长页） */}
{loadingMore ? (
  <div className="flex items-center justify-center gap-2 py-2 text-[15px] text-[var(--muted-foreground)]">
    <Loader2 size={13} className="animate-spin" /> 加载中...
  </div>
) : visibleCount < items.length || page < totalPages ? (
  <button
    type="button"
    onClick={() => {
      setVisibleCount((c) => c + VISIBLE_STEP);
      /* 已载将尽且还有页 → 预取下一页（15/页），显示层与拉取层解耦 */
      if (visibleCount + VISIBLE_STEP > items.length - 3) loadMore();
    }}
    className="neu-btn-soft mt-3 h-10 w-full rounded-[12px] text-[15px] active:scale-[0.99]"
  >
    展开更多（已显 {Math.min(visibleCount, items.length)} / 共 {total} 条）
  </button>
) : items.length > 0 ? (
  <p className="py-2 text-center text-[14px] text-[var(--muted-foreground)]">已全部加载 {total} 条</p>
) : null}
```

（`sentinelRef` 的 div 已随 Step 2 删除。）

- [ ] **Step 5: 量化验收**

跑（登录 admin/admin123 后切「台账」Tab，量页高、点两次展开更多）：

```bash
cd /tmp/m3011_repro && node - <<'EOF'
import { chromium } from '/Users/qihao/ERP2/ERP/water-erp/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto('http://localhost:3011/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.fill('#login-username', 'admin'); await page.fill('#login-password', 'admin123');
await page.click('button[type=submit]'); await page.waitForURL('**/dashboard', { timeout: 30000 });
await page.click('nav >> text=台账'); await page.waitForTimeout(3000);
const h1 = await page.evaluate(() => document.getElementById('m-app-scroll').scrollHeight);
const rows1 = await page.locator('div.space-y-2\\.5 > button').count();
await page.click('text=展开更多'); await page.waitForTimeout(2500);
const rows2 = await page.locator('div.space-y-2\\.5 > button').count();
await page.click('text=展开更多'); await page.waitForTimeout(2500);
const rows3 = await page.locator('div.space-y-2\\.5 > button').count();
console.log(`初始页高=${h1}px 行数: ${rows1}→${rows2}→${rows3}  期望 5→15→25, 页高≤~1600`);
await browser.close();
EOF
```

Expected: 行数 5→15→25；初始页高显著低于 2550px（约 1100~1600，随汇总条内容浮动）。

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile-portal/src/app/(main)/ledger/page.tsx"
git commit -m "feat(mobile): 台账列表显示层控量——默认5条+手动展开更多，删触底自动加载"
```

---

### Task 2: 数据库页「分析中心」宫格 + 分组弹层

**Files:**
- Modify: `apps/mobile-portal/src/app/(main)/dashboard/page.tsx`

**Interfaces:**
- Consumes: 现有 `BottomSheet`/`SectionCard`/各数据 state（`ranking`/`data`/`perf`/`alerts`/`role`…）。
- Produces: 无对外接口。

- [ ] **Step 1: 加图标 import 与宫格定义**

lucide import 行（:5-23）补 `PieChart, Users`。在 `TABS`/工具函数区（`const RANGE_LABELS` 附近）加：

```tsx
/* 分析中心宫格（2026-11-17 一屏总览 spec）：首屏外的 9 张分析卡分五组收进弹层 */
type AnalysisTileKey = "ranking" | "composition" | "company" | "risk" | "supplier";
const ANALYSIS_TILES: Array<{ key: AnalysisTileKey; label: string; icon: typeof PieChart; color: string }> = [
  { key: "ranking", label: "排行", icon: Trophy, color: "var(--gold)" },
  { key: "composition", label: "构成分析", icon: PieChart, color: "var(--accent)" },
  { key: "company", label: "公司对比", icon: Building2, color: "var(--accent)" },
  { key: "risk", label: "风险告警", icon: AlertCircle, color: "var(--danger)" },
  { key: "supplier", label: "供应商", icon: Users, color: "var(--success)" },
];
```

- [ ] **Step 2: 加开层状态**

`const [retryTick, setRetryTick] = useState(0);`（约 :215）后加：

```tsx
const [analysisOpen, setAnalysisOpen] = useState<AnalysisTileKey | null>(null);
```

- [ ] **Step 3: 首屏插入宫格**

在 AI 综合分析 `</SectionCard>`（注释 `── AI 综合分析（折叠卡）──` 区块结束，约 :695）之后、`{/* ── 项目质效 …}` 之前插入：

```tsx
{/* ── 分析中心（一屏总览：其余分析卡收进五组弹层，2026-11-17 spec）── */}
<div className="mb-3 grid grid-cols-3 gap-2">
  {ANALYSIS_TILES.map((t, i) => (
    <button
      key={t.key}
      type="button"
      onClick={() => setAnalysisOpen(t.key)}
      className="neu-card-static m-rise flex flex-col items-center gap-2 rounded-[16px] px-2 py-3.5 active:scale-[0.98]"
      style={{ animationDelay: `${i * 50}ms` }}
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-[13px]"
        style={{ background: `color-mix(in oklch, ${t.color} 12%, transparent)`, color: t.color }}
      >
        <t.icon size={20} strokeWidth={1.5} />
      </span>
      <span className="text-[14px] font-semibold text-[var(--foreground)]">{t.label}</span>
    </button>
  ))}
</div>
```

- [ ] **Step 4: 搬移 10 张卡进分组弹层**

从原位置**剪切**以下区块（按注释锚点，内容逐字不动），原位删除：

| 区块注释锚点 | 去向 |
|---|---|
| `── 项目质效（近一年…` | company |
| `── 各公司采购分布（2026-10-23…`（含 admin 三元包裹） | company |
| `── 采购方式分布（环形图）──` | composition |
| `── 项目规模分析 ──` | composition |
| `── 结果构成 ──` | composition |
| `── 公司龙虎榜（admin 全榜…` | ranking |
| `── 未成交原因分析 ──`（含 `data.nonAwardReasons.length` 三元） | composition |
| `── 节资率排行 Top5 ──` | ranking |
| `── 风险项目预警 ──`（含三元） | risk |
| `── 资源告警（/alerts/overview…`（含三元） | risk |
| `── 重点供应商动态 ──` | supplier |

在文件末尾下钻弹层区（最后一个 `</BottomSheet>` :1467 之后、`</div>` :1468 之前）粘贴组装：

```tsx
{/* ══ 分析中心分组弹层（宫格入口；卡片原样搬入，卡片自身下钻弹层叠在其上）══ */}
<BottomSheet
  open={!!analysisOpen}
  onClose={() => setAnalysisOpen(null)}
  title={
    <span className="flex items-center gap-2">
      {(() => {
        const t = ANALYSIS_TILES.find((x) => x.key === analysisOpen);
        return t ? <t.icon size={16} style={{ color: t.color }} /> : null;
      })()}
      分析中心 · {ANALYSIS_TILES.find((x) => x.key === analysisOpen)?.label ?? ""}
    </span>
  }
>
  {analysisOpen === "ranking" ? (
    <>{/*公司龙虎榜区块*/}{/*节资率排行区块*/}</>
  ) : analysisOpen === "composition" ? (
    <>{/*方式分布*/}{/*规模分析*/}{/*结果构成*/}{/*未成交原因*/}</>
  ) : analysisOpen === "company" ? (
    <>{/*各公司分布(admin)*/}{/*项目质效*/}</>
  ) : analysisOpen === "risk" ? (
    <>{/*风险项目预警*/}{/*资源告警*/}</>
  ) : analysisOpen === "supplier" ? (
    <>{/*重点供应商动态*/}</>
  ) : null}
</BottomSheet>
```

（`{/*…*/}` 处放对应剪切块原文，注释行删除。）

- [ ] **Step 5: 清理**

剪切后原位置不留空注释；确认首屏顺序：今日要报 → 控制行 → 指标卡 → AI 综合分析 → 分析中心宫格 → 采购执行趋势。

- [ ] **Step 6: 编译与 lint**

```bash
pnpm --filter mobile-portal lint
```

Expected: 0 errors（存量 warning 可忽略）。dev 服务（Turbopack）自动热更；若编译红，按报错修（常见：剪切时漏闭合标签）。

- [ ] **Step 7: 量化与交互验收**

```bash
cd /tmp/m3011_repro && node - <<'EOF'
import { chromium } from '/Users/qihao/ERP2/ERP/water-erp/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto('http://localhost:3011/login', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.fill('#login-username', 'admin'); await page.fill('#login-password', 'admin123');
await page.click('button[type=submit]'); await page.waitForURL('**/dashboard', { timeout: 30000 });
await page.waitForTimeout(5000);
const h = await page.evaluate(() => document.getElementById('m-app-scroll').scrollHeight);
console.log(`数据库页高=${h}px 期望 ≤~1500`);
// 宫格五弹层逐个开/关
for (const label of ['排行', '构成分析', '公司对比', '风险告警', '供应商']) {
  await page.click(`text=${label}`);
  await page.waitForTimeout(400);
  const sheetVisible = await page.locator('text=分析中心 ·').first().isVisible();
  console.log(`tile ${label}: sheet=${sheetVisible}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
}
// 两层弹层：构成分析 → 点方式分布扇区 → 下钻弹层可见 → Esc 回宫格弹层
await page.click('text=构成分析'); await page.waitForTimeout(600);
await page.locator('svg[aria-label="采购方式分布环形图"] path').first().click();
await page.waitForTimeout(400);
console.log('两层弹层(方式下钻)=', await page.locator('text=占比').first().isVisible());
await browser.close();
EOF
```

Expected: 页高 ≤~1500px；五个 tile 均开层；两层弹层可叠开。

- [ ] **Step 8: Commit**

```bash
git add "apps/mobile-portal/src/app/(main)/dashboard/page.tsx"
git commit -m "feat(mobile): 数据库页分析中心宫格——9张分析卡分五组收进弹层，首屏一屏总览"
```

---

### Task 3: 回归验收与收尾

**Files:** 无新改动（只验证；发现问题回 Task 1/2 修）。

- [ ] **Step 1: 回归清单（无头浏览器）**

1. 下拉刷新（CDP touch）后页高不变、要报卡仍在顶部。
2. 切区间（本年→本月）：指标卡/趋势图/要报随区间变化（要报=指纹缓存，同数据秒回同文属正常）。
3. 指标卡「异常项目」跳 `/ledger?abnormal=1` 落地台账页预置筛选。
4. 台账切状态筛选 → 行数重置回 5。
5. 进展页 scrollHeight 不受影响（仍 ~1222px）。

- [ ] **Step 2: 汇报**

向用户汇报三页量化前后对比（3501→X / 2550→Y / 1222 不变）与宫格弹层截图。

---

## Self-Review

- Spec 覆盖：spec §3（首屏+宫格五组+两层弹层）→ Task 2；§4（visibleCount 5/+10、删 IO、筛选重置）→ Task 1；§6 验收 → Task 1 Step 5 / Task 2 Step 7 / Task 3；§7 嵌套弹层 → Task 2 Step 7 两层验证。✓
- 占位符：Task 2 Step 4 的 `{/*…*/}` 是「剪切原文粘入」的显式锚点指令（区块原文在文件中，逐字不动），非待补内容。✓
- 类型一致：`AnalysisTileKey`/`ANALYSIS_TILES`/`analysisOpen`/`VISIBLE_INIT`/`VISIBLE_STEP`/`visibleCount` 前后一致。✓
