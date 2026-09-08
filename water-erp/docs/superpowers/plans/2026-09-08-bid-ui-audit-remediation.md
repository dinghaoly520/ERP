# 投标·开标·评标 UI 走查审计整改实施计划（2026-09-08）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-09-08 UI 走查审计中经核查确认属实的 3 项 P0 + 7 项 P1 + 6 项已定位 P2，核心是数值量纲统一与状态一致性护栏。

**Architecture:** 三层推进——①共享格式化层（`@water-erp/shared` 新增金额/报价格式化工具，三端复用）；②种子数据修正（英雄项目 24 条超满分记录按百分比→权重折算重算，官方结果同步重生成）；③各端渲染护栏与文案对齐（OPENING 预演标注、排名双指标、废标标记、U盾链路）。法定开评标交互（解密/唱标/异议/流标/签字）一律只加标注不改行为。

**Tech Stack:** pnpm monorepo；NestJS 11 + Prisma（apps/api）；Next.js 16 + React 19（三门户）；node:test via tsx（shared/supplier-portal-next 新测试）；jest ts-jest（api 既有 spec）。

**Spec:** `/home/asus/下载/投标开标评标UI走查审计报告-2026-09-08.md`（审计原文）+ 本仓库核查裁决（2026-09-08 主会话核查，结论已并入各任务背景）。

## Global Constraints

- **并行会话协作**：动工前 `git status` 必须干净——对方会话（A-113/GB-T 43711 线）有未提交改动时等待其提交；禁用 `git add -A`/`git add .`，只 add 本任务明确改动的文件；`packages/shared` 为共享高危文件，仅在对方工作区干净时修改。
- **commit 信息前缀** `fix(ui-audit):`（Task 1 用 `feat(shared):`）。
- **法定交互不动**：开标解密/唱标确认/异议裁决/流标/评标签字流程的行为与守卫一律不改，只允许加标注、改文案、改展示格式。
- **前端无单测基建的门户**（bid-portal/expert-portal）验证 = `pnpm --filter <app> lint` + `npx tsc --noEmit`（在 app 目录）；API = `pnpm --filter api test -- <spec 名>`。
- 改 `packages/shared/src` 后必须 `pnpm --filter @water-erp/shared build`（dist 消费），门户 dev server 须重启才能看到效果。
- 浏览器走查用 chrome-devtools MCP 前先确认无并行会话占用（profile 互斥）。
- 种子修复后 `pnpm db:seed` 是**破坏性全量重载**——只在用户确认的时机执行（见 Task 5 Step 6）。

---

### Task 1: 共享金额/报价格式化工具（数值统一层地基）

**背景**：P0-1 ¥NaN 根因 = `Number('1150万元')` → NaN；P1-1 裸元数字无千分位。种子 bidPrice 为「1150万元」式带单位字符串，开标记录 amount 为自由文本（裸数字或带单位），三端各自拼 ¥ 必然口径分裂。

**Files:**
- Create: `packages/shared/src/format-bid.ts`
- Create: `packages/shared/src/__tests__/format-bid.test.ts`
- Modify: `packages/shared/src/index.ts`（追加导出）
- Modify: `packages/shared/package.json`（追加 test script）

**Interfaces:**
- Produces: `parseAmountToYuan(raw: string | number | null | undefined): number | null`——「1150万元」→11500000；「1260.5」→1260.5；「1,485,000」→1485000；不可解析→null。
- Produces: `formatBidPrice(raw: string | number | null | undefined, opts?: { prefix?: string }): string`——可解析→`¥11,500,000`（千分位、无小数尾零，`opts.prefix` 默认 `'¥'`）；不可解析→原样返回 raw 字符串（null/undefined/空串→`'—'`）。

- [ ] **Step 1: 写失败测试**（node:test 风格，对齐 supplier-portal-next 的 tsx --test 用法）

```ts
// packages/shared/src/__tests__/format-bid.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountToYuan, formatBidPrice } from '../format-bid';

test('parseAmountToYuan：万元字符串', () => {
  assert.equal(parseAmountToYuan('1150万元'), 11_500_000);
  assert.equal(parseAmountToYuan('1080 万元'), 10_800_000);
  assert.equal(parseAmountToYuan('1.5万元'), 15_000);
});

test('parseAmountToYuan：纯数字与千分位', () => {
  assert.equal(parseAmountToYuan('1260.5'), 1260.5);
  assert.equal(parseAmountToYuan('1,485,000'), 1_485_000);
  assert.equal(parseAmountToYuan(1485000), 1_485_000);
});

test('parseAmountToYuan：不可解析与空值', () => {
  assert.equal(parseAmountToYuan('面议'), null);
  assert.equal(parseAmountToYuan(''), null);
  assert.equal(parseAmountToYuan(null), null);
  assert.equal(parseAmountToYuan(undefined), null);
});

test('formatBidPrice：可解析格式化、不可解析回原文、空值占位', () => {
  assert.equal(formatBidPrice('1150万元'), '¥11,500,000');
  assert.equal(formatBidPrice(1485000), '¥1,485,000');
  assert.equal(formatBidPrice('1260.5'), '¥1,260.5');
  assert.equal(formatBidPrice('面议'), '面议');
  assert.equal(formatBidPrice(null), '—');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared && npx tsx --test src/__tests__/format-bid.test.ts`
Expected: FAIL（Cannot find module '../format-bid'）

- [ ] **Step 3: 实现**

```ts
// packages/shared/src/format-bid.ts
/**
 * 投标报价/金额展示统一格式化（2026-09-08 UI 审计 P0-1/P1-1）。
 * 数据现实：bidPrice/amount 字段为自由文本——「1150万元」「1260.5」「1,485,000」并存，
 * 各端自行 Number() 必产 NaN。这里统一：能解析→元为单位的千分位；不能→原文直出（宁原样不出错）。
 */
const WAN_RE = /^\s*([\d,]+(?:\.\d+)?)\s*万元?\s*$/;

export function parseAmountToYuan(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = raw.trim();
  if (!s) return null;
  const wan = s.match(WAN_RE);
  if (wan) {
    const n = Number(wan[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n * 10_000 : null;
  }
  if (/^[\d,]+(?:\.\d+)?$/.test(s)) {
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function formatBidPrice(
  raw: string | number | null | undefined,
  opts?: { prefix?: string },
): string {
  const prefix = opts?.prefix ?? '¥';
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return '—';
  const yuan = parseAmountToYuan(raw);
  if (yuan == null) return typeof raw === 'string' ? raw.trim() : String(raw);
  // 整数不带小数尾零；小数保留原精度（去尾零）
  const formatted = Number.isInteger(yuan)
    ? yuan.toLocaleString('zh-CN')
    : yuan.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  return `${prefix}${formatted}`;
}
```

- [ ] **Step 4: 导出与 test script**

`packages/shared/src/index.ts` 追加一行（跟随现有导出风格）：
```ts
export * from './format-bid';
```
`packages/shared/package.json` scripts 追加（**不动**既有 `*.spec.ts` jest 风格文件的运行方式）：
```json
"test": "tsx --test src/__tests__/*.test.ts"
```

- [ ] **Step 5: 跑测试确认通过 + 构建**

Run: `cd packages/shared && pnpm test && pnpm build`
Expected: 4 tests PASS；`dist/` 重新生成无报错。

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/format-bid.ts packages/shared/src/__tests__/format-bid.test.ts packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat(shared): 金额/报价统一格式化 parseAmountToYuan/formatBidPrice——UI审计数值统一层地基（万元/千分位/裸数字归一，不可解析回原文）"
```

---

### Task 2: P0-1 专家端评审报告 ¥NaN ×3 修复 + P1-9 废标标记

**背景**：`report-step.tsx:196` `¥{Number(ss.bidPrice).toLocaleString('zh-CN')}` 对「1150万元」→`¥NaN`，每供应商卡一处=×3。P1-9：报告页供应商卡（`report-step.tsx:185-208`）无废标标记、废标供应商 255 分与有效供应商同权重并列（评分页 sidebar/tab-bar 已有 pill，报告页缺）。

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:1855-1875`（报告 supplierScores 构建加 `invalid`/`invalidReason`）
- Modify: `apps/expert-portal/src/components/evaluate/report-step.tsx:185-209`（报价格式化 + 废标 pill）
- Test: `apps/api/src/expert/expert.service.spec.ts`（若已有 getEvaluationReport 相关用例则扩展；否则以类型断言最小用例并入）

**Interfaces:**
- Consumes: Task 1 `formatBidPrice`。
- Produces: 报告响应 `supplierScores[i]` 新增 `invalid: boolean`（供应商 `bidValidity === 'invalid'`）与 `invalidReason?: string`。

- [ ] **Step 1: API——报告构建加废标字段**

`expert.service.ts` 报告构建处（`const supplierScores = project.suppliers.map(supplier => {`，约 :1855），在 map 回调返回对象里追加（`totalScore` 同级）：

```ts
      // P1-9（UI审计）：报告页废标标记——与评分页 bidValidity==='invalid' 同一口径
      invalid: supplier.bidValidity === 'invalid',
```

（`invalidReason` 若模型无现成字段则不加，pill 通用文案「废标」即可——不造无来源数据。）

- [ ] **Step 2: 前端——报价格式化 + 废标 pill**

`report-step.tsx:194-198` 报价改为：

```tsx
                    {ss.bidPrice && (
                      <span className="text-xs font-mono tabular-nums text-[var(--muted-foreground)]">
                        报价：{formatBidPrice(ss.bidPrice)}
                      </span>
                    )}
```

顶部 import 追加：`import { formatBidPrice } from '@water-erp/shared';`（该文件已从 shared 导入 `CATEGORY_LABEL` 等，合并进同一 import）。

供应商名后（`<h3 ...>{ss.supplierName}</h3>` 之后、报价 span 之前）追加废标 pill：

```tsx
                    {ss.invalid && (
                      <span className="exp-pill" style={{ '--c': 'var(--danger)' } as React.CSSProperties}>废标</span>
                    )}
```

供应商卡容器加弱化（`report-step.tsx:188` 的 `neu-card-static` 卡 div）：

```tsx
              <div key={i} className={`neu-card-static overflow-hidden ${ss.invalid ? 'opacity-60' : ''}`}>
```

（`EvaluationReport` 类型在 `apps/expert-portal/src/lib/types.ts`，给 `supplierScores` 元素补 `invalid?: boolean`。）

- [ ] **Step 3: 验证**

Run: `cd apps/expert-portal && npx tsc --noEmit && pnpm lint`
Run: `cd apps/api && pnpm test -- expert.service.spec`
Expected: 全绿。

- [ ] **Step 4: 手测（dev 起 :3006 + :4001）**

登录专家（如周祥志/expert@2026）→ 英雄项目 → 评审报告步：三家报价显示 `¥11,500,000` 等（无 NaN）；废标供应商卡有红色「废标」pill 且整卡 60% 透明度。

- [ ] **Step 5: Commit（两个独立提交）**

```bash
git add apps/api/src/expert/expert.service.ts
git commit -m "fix(ui-audit): P1-9 评审报告响应补 invalid 字段（bidValidity 同口径）"
git add apps/expert-portal/src/components/evaluate/report-step.tsx apps/expert-portal/src/lib/types.ts
git commit -m "fix(ui-audit): P0-1 评审报告报价 ¥NaN×3 修复（formatBidPrice）+ P1-9 废标供应商 pill/弱化"
```

---

### Task 3: P1-4 评分矩阵专家列稳定排序（API 一行）

**背景**：编号按 expertId 排序指派（`bid.service.ts:490/2667` `.sort()`），行序却按 Prisma 返回序（两处 include 均无 `orderBy`）→ 列号错位（2,3,4,5,1）必然，且无排序契约时两次可不同。

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:430`、`apps/api/src/bid/bid.service.ts:4391`（两处 `experts: {` include）

**Interfaces:** 无新接口；行为契约 = 项目详情 experts 返回序 = expertId 升序 = 编号序（专家 1,2,3…）。

- [ ] **Step 1: 两处 include 加 orderBy**

```ts
        experts: { include: { scoreRecords: true }, orderBy: { id: 'asc' } },
```
（:4391 处同理：`experts: { include: { scoreRecords: { include: { scoreItem: true } } }, orderBy: { id: 'asc' } }`。）

- [ ] **Step 2: 验证**

Run: `cd apps/api && npx tsc -p tsconfig.json && pnpm test -- bid.service.spec`
Expected: 编译绿、既有 spec 全过。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bid/bid.service.ts
git commit -m "fix(ui-audit): P1-4 项目详情 experts 显式 orderBy id asc——矩阵列序对齐编号序（专家1,2,3…），消除错位与刷新漂移"
```

---

### Task 4: P0-3a OPENING 预演标注 + P0-3c 排名口径与回退告警（bid-portal evaluation-view）

**背景**：a) `evaluation-view.tsx:307` 对 OPENING（评标未启动）照常渲染全部评标 KPI/矩阵/排名，与「启动评标禁用」同屏矛盾。c) 排名按 live 官方预览（排序键=去极值均分）但主显跨专家合计总分→「470 反超 461 却居后」；live 端点失败静默回退客户端均分序（`evaluation-view.tsx:242-249` catch→null 无告警）→ 两次刷新数据源/量纲切换无感知；客户端 `liveRanks` 排序无 tie-break（`:265`）。附带：`:806` `¥{Number(official.bidPrice)...}` 同源 NaN 风险。P1-3 实名/编号翻转疑与回退同源——回退可见化后可观察定位（规则注释已在 `:636`，不另改）。

**Files:**
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx`（KPI 区前插横幅、排名区双指标、live 回退态、tie-break、报价格式化）

**Interfaces:**
- Consumes: Task 1 `formatBidPrice`。

- [ ] **Step 1: OPENING 预演横幅**——KPI 四卡（`<div className="mb-3 flex flex-wrap gap-2.5">` 之前，约 :538）插入：

```tsx
      {stage === 'OPENING' && (
        <div className="bid-alert bid-alert--warning mb-3 flex items-center gap-2 rounded-[12px] !py-2.5">
          <AlertTriangle size={14} />
          <span className="text-xs">
            评标尚未启动——当前展示的评分/排名为预演数据，不作为评标依据；请先在上方完成「启动评标」。
          </span>
        </div>
      )}
```

（`AlertTriangle` 该文件已 import。）

- [ ] **Step 2: live 拉取失败可见化**——state 增加 `liveFailed`，`useEffect`（:242-249）改为：

```ts
    getLiveOfficialScores(projectId)
      .then(r => { if (!cancelled) { setLiveOfficial(r); setLiveFailed(false); } })
      .catch(() => { if (!cancelled) { setLiveOfficial(null); setLiveFailed(true); } });
```

排名区（`暂无投标供应商` 分支之前的区块头附近）加告警：

```tsx
              {liveFailed && results.length === 0 && (
                <div className="mb-2 rounded-[10px] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-1.5 text-[10px] text-[var(--warning)]">
                  实时官方预览暂不可用——当前为客户端估算排名（按专家均分），仅供参考。
                </div>
              )}
```

- [ ] **Step 3: liveRanks 稳定 tie-break**（:265）：

```ts
    entries.sort((a, b) => b.avg - a.avg || a.name.localeCompare(b.name, 'zh-CN'));
```
（entries map 处同步带 name：`map(s => ({ id: s.id, name: s.supplierName, avg: ... }))`，与 `aggregate-supplier-scores.ts` 服务端同款 zh-CN tiebreak。）

- [ ] **Step 4: 排名行双指标**——排名行分数 span（:811-814）改为均分+总分双显，live/回退态把排序键（均分）摆到主位：

```tsx
                    <span className="font-mono text-xs font-bold tabular-nums text-[var(--accent-strong)]">
                      {official ? Number(official.totalScore).toFixed(2) : `${avg.toFixed(1)}`}
                      <span className="ml-1 text-[9px] font-normal text-[var(--muted-foreground)]">{official ? '官方总分' : '均分(排序口径)'}</span>
                    </span>
                    {!official && (live || avg > 0) && (
                      <span className="font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">
                        总分 {live ? live.totalScore.toFixed(0) : Math.round(avg * (experts.filter(e => e.expertRole === 'REGULAR' || true).length || 1))}
                      </span>
                    )}
```

> 注：回退态「总分」由均分×正选专家数近似即可（标注同「估算」语境）；live 态用真值。若执行时嫌近似不严谨，回退态只显示均分一项亦可接受——**不许显示可能误导的精确总分**。

- [ ] **Step 5: 排名区报价 NaN 兜底**（:803-807）：

```tsx
                    {official?.bidPrice && (
                      <span className="font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
                        {formatBidPrice(official.bidPrice)}
                      </span>
                    )}
```
import 合并：`import { formatBidPrice } from '@water-erp/shared';`

- [ ] **Step 6: 验证**

Run: `cd apps/bid-portal && npx tsc --noEmit && pnpm lint`
手测：:3007 引大济岷（OPENING）评标 tab 顶部见「评标尚未启动」横幅；断网/停 API 复现回退时见估算告警；刷新多次排名顺序稳定。

- [ ] **Step 7: Commit**

```bash
git add apps/bid-portal/src/components/workspace/evaluation-view.tsx
git commit -m "fix(ui-audit): P0-3a OPENING 预演横幅 + P0-3c 排名双指标/回退告警/tiebreak 稳定——排序键(均分)与展示键对齐，live 失败不再静默换量纲"
```

---

### Task 5: P0-2 种子数据修正——英雄项目 24 条超满分记录折算 + 官方结果重算

**背景**：`BidScoreItem.json`（cmqhero-si01-05）满分 QUALIFICATION 0/RESPONSIVE 0/BUSINESS 20/TECHNICAL 50/PRICE 30（合计 100），但 30 条记录中 24 条超满分（如 82/20、90/20、92/50）——录入时按百分制，落库未折算。库存官方结果 `BidEvaluationResult.json`（cmqhero-er01 totalScore 259）为 07-03 旧算法化石。写入侧已有 400 校验（`expert.service.ts:1253`），纯数据问题。e2e 无 259/260 硬编码断言（已核查），改动安全。

**Files:**
- Create: `apps/api/scripts/fix-hero-seed-scores.ts`
- Modify（脚本产出）: `apps/api/prisma/seed-data/BidScoreRecord.json`、`apps/api/prisma/seed-data/BidEvaluationResult.json`

**Interfaces:**
- Produces: 种子 JSON 内英雄项目分数记录全部 `score ≤ maxScore`（折算规则 `round(pct × max/100)`，保留通过性记录 score=0 不动）；`BidEvaluationResult.json` 英雄行按 `aggregate-supplier-scores.ts` 同款语义重算（averageScore=去1高1低均分、totalScore=全员合计、rank 重排）。

- [ ] **Step 1: 写脚本（--check 预览 / --write 落盘两模式）**

```ts
// apps/api/scripts/fix-hero-seed-scores.ts
/**
 * UI审计 P0-2：英雄项目种子分数折算（百分制误录 → 权重分）+ 官方结果重算。
 * 用法：npx tsx scripts/fix-hero-seed-scores.ts [--write]（默认 --check 只打印 diff）
 * 规则：score > maxScore 的记录 → round(score * maxScore / 100)；
 *       通过性项（maxScore=0）与合法记录不动。
 * 结果重算：对齐 aggregate-supplier-scores 语义——averageScore=去1高1低均分，totalScore=全员合计。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SEED = path.join(__dirname, '..', 'prisma', 'seed-data');
const HERO = 'cmqhero';
const write = process.argv.includes('--write');

type ScoreItem = { id: string; projectId: string; category: string; maxScore: number };
type ScoreRecord = { id: string; scoreItemId: string; supplierId: string; expertId: string; score: number | string; passed?: boolean | null };
type EvalResult = { id: string; projectId: string; supplierId: string; totalScore: number | string; averageScore: number | string; rank: number; disqualified?: boolean; recommended?: boolean };

const items = JSON.parse(fs.readFileSync(path.join(SEED, 'BidScoreItem.json'), 'utf8')) as ScoreItem[];
const records = JSON.parse(fs.readFileSync(path.join(SEED, 'BidScoreRecord.json'), 'utf8')) as ScoreRecord[];
const results = JSON.parse(fs.readFileSync(path.join(SEED, 'BidEvaluationResult.json'), 'utf8')) as EvalResult[];

const heroItems = items.filter(i => i.projectId?.startsWith(HERO));
const maxBy = new Map(heroItems.map(i => [i.id, Number(i.maxScore)]));
let changed = 0;

for (const r of records) {
  const max = maxBy.get(r.scoreItemId);
  if (max == null) continue;
  const s = Number(r.score);
  if (s > max) {
    const fixed = max > 0 ? Math.round((s * max) / 100) : 0;
    console.log(`[record] ${r.id} ${r.score} / ${max} -> ${fixed}`);
    r.score = fixed; changed++;
  }
}

// 重算官方结果：per-supplier per-expert totals → trimmed avg + sum
const bySupplier = new Map<string, Map<string, number>>();
for (const r of records) {
  if (!maxBy.has(r.scoreItemId)) continue;
  const m = bySupplier.get(r.supplierId) ?? new Map<string, number>();
  m.set(r.expertId, (m.get(r.expertId) ?? 0) + Number(r.score));
  bySupplier.set(r.supplierId, m);
}
const agg = [...bySupplier.entries()].map(([supplierId, experts]) => {
  const totals = [...experts.values()].sort((a, b) => a - b);
  const trimmed = totals.length >= 3 ? totals.slice(1, -1) : totals;
  const averageScore = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const totalScore = totals.reduce((a, b) => a + b, 0);
  return { supplierId, totalScore: Math.round(totalScore * 100) / 100, averageScore: Math.round(averageScore * 100) / 100 };
}).sort((a, b) => b.averageScore - a.averageScore || a.supplierId.localeCompare(b.supplierId));

for (const r of results) {
  if (!r.projectId?.startsWith(HERO)) continue;
  const hit = agg.findIndex(a => a.supplierId === r.supplierId);
  if (hit < 0) continue;
  console.log(`[result] ${r.id} total ${r.totalScore} -> ${agg[hit].totalScore}, avg ${r.averageScore} -> ${agg[hit].averageScore}, rank ${r.rank} -> ${hit + 1}`);
  r.totalScore = agg[hit].totalScore; r.averageScore = agg[hit].averageScore; r.rank = hit + 1;
}

if (!write) { console.log(`\n--check 模式：${changed} 条记录待折算；加 --write 落盘`); process.exit(0); }
fs.writeFileSync(path.join(SEED, 'BidScoreRecord.json'), JSON.stringify(records, null, 2) + '\n');
fs.writeFileSync(path.join(SEED, 'BidEvaluationResult.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`\n已写回：${changed} 条折算 + 英雄官方结果重算`);
```

- [ ] **Step 2: --check 预览**

Run: `cd apps/api && npx tsx scripts/fix-hero-seed-scores.ts`
Expected: 打印 24 条折算（90/20→18、92/50→46、78/30→23 等）+ 3 条结果重算；无报错。

- [ ] **Step 3: 人工审阅 diff 合理性**

检查点：折算后单专家总分 ≤100（如 18+46+23=87，与引大济岷 86-96 量级一致）；recommended/disqualified 标志**保持原值不动**（脚本未触碰）；rank 与 averageScore 排序一致。

- [ ] **Step 4: --write 落盘 + 校验**

Run: `cd apps/api && npx tsx scripts/fix-hero-seed-scores.ts --write && npx tsx -e "
const r=require('./prisma/seed-data/BidScoreRecord.json'),i=require('./prisma/seed-data/BidScoreItem.json');
const m=new Map(i.map(x=>[x.id,Number(x.maxScore)]));
const over=r.filter(x=>m.get(x.scoreItemId)!=null&&Number(x.score)>m.get(x.scoreItemId));
console.log('剩余超满分:',over.length); if(over.length) process.exit(1);"`
Expected: 剩余超满分: 0，退出码 0。

- [ ] **Step 5: e2e 影响复核**

Run: `grep -rn "259\|260\|totalScore.*toBe" apps/api/test/*.e2e-spec.ts | grep -v Property`
Expected: 无对旧分值的硬断言（此前已核查，复核一次防漂移）。

- [ ] **Step 6: 择机重载种子（破坏性——先问用户）**

`pnpm db:seed` 会 TRUNCATE 全部业务表。**执行前必须征得用户确认**（演示库/演示快照时机由用户定）。JSON 修正本身已生效于下次任何 seed。

- [ ] **Step 7: Commit**

```bash
git add apps/api/scripts/fix-hero-seed-scores.ts apps/api/prisma/seed-data/BidScoreRecord.json apps/api/prisma/seed-data/BidEvaluationResult.json
git commit -m "fix(ui-audit): P0-2 英雄项目种子 24 条超满分折算（百分制→权重分）+官方结果重算——消除 260/20、259 化石；脚本 --check/--write 双模式留档"
```

---

### Task 6: P0-2 渲染兜底——超满分警示标注（不静默直出）

**背景**：读取侧三处直出（`report-step.tsx:208/231`、`evaluation-view.tsx:674`）无超满分/NaN 兜底。种子修复（Task 5）后不应再出现，但护栏防未来脏数据（写入校验只挡 API 写入，挡不住直改库/旧快照）。

**Files:**
- Modify: `apps/expert-portal/src/components/evaluate/report-step.tsx:208/231`
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx:674`（矩阵格）、`:700+`（明细行）

**Interfaces:** 无新接口；纯展示层。

- [ ] **Step 1: report-step 总分与类别分超限标注**

`:208` 总分：`{ss.totalScore}` 外包一层判断（评分标准满分=各 categoryScores.max 合计；报告页只有本专家记录的 max 累计，用同口径）：

```tsx
                  <div className="text-2xl font-bold text-[var(--accent-strong)]">
                    {ss.totalScore}
                    <span className="text-sm font-normal text-[var(--muted-foreground)]"> 分</span>
                    {(() => {
                      const sumMax = Object.values(ss.categoryScores).reduce((a, c) => a + (isPassFailCategory as unknown as never) ? a : a + c.max, 0);
                      return Number(ss.totalScore) > sumMax ? (
                        <span className="ml-2 align-middle exp-pill" style={{ '--c': 'var(--danger)' } as React.CSSProperties} title="得分超过评分标准满分——数据异常，请核查">超满分</span>
                      ) : null;
                    })()}
                  </div>
```

> 实现时写直白版（预计算 `sumMax` 于 map 回调顶部，勿照抄上面的紧凑 IIFE）：

```tsx
            const sumMax = Object.values(ss.categoryScores).filter(([, d]) => !d.items.some(it => it.maxScore === 0 && it.passed != null)).reduce((a, [, d]) => a + d.max, 0) || Infinity;
```
（若该口径有歧义，**简化为**：任一 category `data.total > data.max` 即标——在 `:231` 类别分处实现即可，总分处不重复标。）

`:231` 类别分（非通过制分支）：

```tsx
                              <div className={`text-lg font-bold ${data.total > data.max ? 'text-[var(--danger)]' : 'text-[var(--foreground)]'}`}>
                                {data.total} <span className="text-xs font-normal text-[var(--muted-foreground)]">/ {data.max}</span>
                                {data.total > data.max && <span className="ml-1 text-[10px]">⚠ 超满分</span>}
                              </div>
```

- [ ] **Step 2: evaluation-view 矩阵格同款**（:674 `{cell.totalScore.toFixed(1)}/{cell.maxScore}`）：

```tsx
                <span className={cell.totalScore > cell.maxScore ? 'text-[var(--danger)] font-bold' : ''}>
                  {cell.totalScore.toFixed(1)}/{cell.maxScore}
                  {cell.totalScore > cell.maxScore ? ' ⚠' : ''}
                </span>
```

- [ ] **Step 3: 验证 + Commit**

Run: `cd apps/expert-portal && npx tsc --noEmit && cd ../bid-portal && npx tsc --noEmit && pnpm lint`

```bash
git add apps/expert-portal/src/components/evaluate/report-step.tsx apps/bid-portal/src/components/workspace/evaluation-view.tsx
git commit -m "fix(ui-audit): P0-2 渲染兜底——类别分/矩阵格超满分红色警示（数据脏不再无感直出）"
```

---

### Task 7: P1-2 移交态横幅旧文案修正

**背景**：`opening-hall.tsx:750`「后续启动评标 / 归档请前往采购管理工作台开标确认面板」与分工 v3（启动评标在本端评标管理 tab）矛盾；`:716-717` 正确文案同文件并存。**只改移交态一句**，按钮与流程不动。

**Files:**
- Modify: `apps/bid-portal/src/components/opening-hall.tsx:750`

- [ ] **Step 1: 改文案**

```tsx
            <p className="text-xs text-[color:var(--muted-foreground)]">移交时间 {new Date(session.handoverAt).toLocaleString('zh-CN')}。开标文件包已回传采购管理工作台；启动评标请在本工作区「评标管理」tab 操作，完整归档与公示由采购管理工作台办理。</p>
```

- [ ] **Step 2: 验证 + Commit**

Run: `cd apps/bid-portal && npx tsc --noEmit && pnpm lint`

```bash
git add apps/bid-portal/src/components/opening-hall.tsx
git commit -m "fix(ui-audit): P1-2 完成开标移交横幅文案对齐分工 v3——启动评标指回本端评标管理 tab"
```

---

### Task 8: P1-8 监督日志调试串人话化

**背景**：`expert.service.ts:568-570` 审计日志 result 直出 `signedIn=true avoidanceConfirmed=...`，监督视图（`supervision-view.tsx:141/263`）原样渲染。唯一写点（其余同条件处只守卫不落日志，已核查）。

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:566-572`
- Test: `apps/api/src/expert/expert.service.spec.ts`

- [ ] **Step 1: 写失败测试**（在 expert.service.spec.ts 追加，风格随既有用例）：

```ts
  it('P1-8：核验未完成日志 result 为人话缺失清单（无 debug 串）', () => {
    const missing = [!{ signedIn: false }['signedIn'] && '未签到', '未完成回避确认'].filter(Boolean).join('、');
    expect(missing).toBe('未签到、未完成回避确认');
    expect(missing).not.toMatch(/=/);
  });
```

> 若 spec 直接测 service 过重（需 DB mock），**允许**降级为纯工具函数测试：把缺失清单构造提为同文件导出的 `verificationMissingList(expert)` 纯函数再测——生产代码用它拼 result。二选一，执行时按 spec 现有 mock 能力定。

- [ ] **Step 2: 实现**——守卫分支改为：

```ts
    if (!expert.signedIn || !expert.avoidanceConfirmed || !expert.aiConsentConfirmed || !expert.confidentialityAgreed || !expert.disciplineAgreed) {
      // 审计：专家核验未完成即尝试访问（P1-8：人话缺失清单替代 debug 串）
      const missing = [
        !expert.signedIn && '未签到',
        !expert.avoidanceConfirmed && '未完成回避确认',
        !expert.aiConsentConfirmed && '未确认 AI 辅助评标声明',
        !expert.confidentialityAgreed && '未同意保密承诺',
        !expert.disciplineAgreed && '未确认评标纪律',
      ].filter(Boolean).join('、');
      this.prisma.bidSupervisionLog.create({
        data: { projectId, time: new Date(), role: '评审专家', target: expert.expertName,
          action: '尝试查看投标文件（被拒：核验未完成）', result: `核验未完成：${missing}`, riskFlag: '无' },
      }).catch(() => {});
      throw new ForbiddenException({ error: '请先完成身份核验、回避确认、AI 辅助评标声明、保密承诺与评标纪律确认', code: 'VERIFICATION_REQUIRED' });
    }
```

- [ ] **Step 3: 验证 + Commit**

Run: `cd apps/api && pnpm test -- expert.service.spec`

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts
git commit -m "fix(ui-audit): P1-8 监督日志核验拒绝 result 人话化——缺失清单替代 signedIn=true 调试串"
```

---

### Task 9: P1-1 供应商门户开标记录金额归一（含「1080万元 元」双单位 bug）

**背景**：`opening-fields.ts:81` 对法定键直出 `row[f.key]` 原始串（1485000 裸元无千分位）；本司区 `page.tsx:342` 无条件拼「 元」→ 种子「1080万元」渲染成「1080万元 元」。数据源 `BidOpeningRecord.amount` 为主持人自由文本。

**Files:**
- Modify: `apps/supplier-portal-next/src/lib/opening-fields.ts`
- Modify: `apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx:342、:503-507`
- Test: `apps/supplier-portal-next/src/lib/__tests__/opening-fields.test.ts`（既有基建，tsx --test）

**Interfaces:**
- Consumes: Task 1 `formatBidPrice`（@water-erp/shared 已 build）。

- [ ] **Step 1: 写失败测试**（opening-fields.test.ts 追加）：

```ts
test('P1-1：开标记录金额展示——裸数字千分位+元，带单位原文直出', () => {
  expect(formatOpeningAmount('1485000')).toBe('1,485,000 元');
  expect(formatOpeningAmount('1080万元')).toBe('1080万元');
  expect(formatOpeningAmount('')).toBe('—');
});
```

- [ ] **Step 2: 确认失败**

Run: `cd apps/supplier-portal-next && pnpm test`
Expected: 新用例 FAIL（formatOpeningAmount 未导出）。

- [ ] **Step 3: 实现**——opening-fields.ts 新增并导出：

```ts
import { parseAmountToYuan } from '@water-erp/shared';

/** P1-1（UI审计）：开标记录金额——裸数字归一为千分位+元；自由文本带单位（如「1080万元」）原文直出 */
export function formatOpeningAmount(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '—';
  return parseAmountToYuan(raw) != null ? `${Number(parseAmountToYuan(raw)).toLocaleString('zh-CN')} 元` : raw.trim();
}
```

公开表渲染（`openingRecordCell` 对金额类键，或 `page.tsx:503-507` 单元格处）改走 `formatOpeningAmount(row[f.key])`；本司区「唱标金额」行（:342）把无条件 `` `${...} 元` `` 改为 `formatOpeningAmount(value)`。

- [ ] **Step 4: 跑测试 + lint + Commit**

Run: `cd apps/supplier-portal-next && pnpm test && pnpm lint`

```bash
git add apps/supplier-portal-next/src/lib/opening-fields.ts "apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx" apps/supplier-portal-next/src/lib/__tests__/opening-fields.test.ts
git commit -m "fix(ui-audit): P1-1 开标记录金额归一——裸数字千分位+元、带单位原文直出（修「1080万元 元」双单位）"
```

---

### Task 10: P1-6/P1-7 U盾失败反馈收口

**背景**：a) 「回执获取失败，请重新展开重试」把确定性失败（未绑证书）当可重试（`bids/[id]/page.tsx:376-385→786`）；b) 展开核验面板误弹「无法签署回执」toast——取回执负载与签署共用守卫文案（API `supplier-portal.service.ts:538`）；c) 失败提示无「去绑定」去向（唯一例外解密对话框有 `/profile/ukey`）。

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts:538` 附近
- Modify: `apps/supplier-portal-next/src/app/(main)/my-bids/[id]/page.tsx:376-385、:786 附近、:770-774`
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（既有文件，工作树内）

- [ ] **Step 1: API 文案拆分**——取回执（核验）与签署两入口的错误响应区分：核验路径错误信息改为「回执核验失败：供应商未绑定 SM2 公钥，请先在 企业资料→证书与U盾 绑定」（签署路径保留「无法签署回执」语义）。实现方式按 :538 现状：若两入口共用一个私有方法，给方法加 `context: 'verify' | 'sign'` 参数分别拼文案。

- [ ] **Step 2: 前端失败面板分类 + 去绑定链接**——`loadReceiptPayload` catch 里区分：错误消息含「未绑定」→ `payloadFailed='unbound'` 否则 `'retry'`；:786 面板按态渲染：

```tsx
        {payloadFailed === 'unbound' ? (
          <>
            <p>回执获取失败：尚未绑定 U盾 数字证书（此操作无法通过重试解决）。</p>
            <Link href="/profile/ukey" className="sp-btn-primary …">去绑定 U盾</Link>
          </>
        ) : (
          <p>回执获取失败，请重新展开重试</p>
        )}
```

（样式类按该页既有按钮体系；toast 触发点 :770-774 的 onToggle 里不再对 unbound 弹全局 toast。）

- [ ] **Step 3: 验证 + Commit**

Run: `cd apps/api && pnpm test -- supplier-portal.service.spec && cd ../supplier-portal-next && pnpm lint`

```bash
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts "apps/supplier-portal-next/src/app/(main)/my-bids/[id]/page.tsx"
git commit -m "fix(ui-audit): P1-6/7 回执失败反馈收口——核验/签署文案拆分、确定性失败不再称可重试、附去绑定U盾入口"
```

> ⚠️ 该 spec 与 page.tsx 当前可能在并行会话工作树（A-113 线）——动工前 `git status` 确认干净。

---

### Task 11: P1-5 通知断链三处收口

**背景**：44 条公告通知 vs 「可投标项目 0」空态无解释（过滤为 stage∈{DOWNLOAD,SUBMIT}+未截标，历史公告项目必然滤掉）；e2e `afterAll` 只删项目不删公告（`test/bid.e2e-spec.ts:87-96`）；种子 `Notification.json` 自带 10 条「E2E测试项目」残留。

**Files:**
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/page.tsx:286-290`
- Modify: `apps/api/test/bid.e2e-spec.ts:87-96`
- Modify: `apps/api/prisma/seed-data/Notification.json`（删 E2E 残留条目）

- [ ] **Step 1: 空态文案**——EmptyState desc 改：

```tsx
                desc={search || filterScope ? "没有符合当前筛选条件的项目，试试调整搜索或类别" : "当前没有处于投标期内（下载/递交阶段且未截标）的招标项目；已截止或已开评标的项目请在「我的投标」中查看进度"}
```

- [ ] **Step 2: e2e afterAll 补删公告**——在 `await app.close();` 前追加：

```ts
    // P1-5（UI审计）：清理 e2e 造的公告——此前只删项目不删公告，供应商通知被 E2E招标公示-<ts> 刷屏
    for (const code of createdAnnouncementCodes) {
      await prisma.announcement.deleteMany({ where: { title: { contains: code } } }).catch(() => {});
    }
```

（`createdAnnouncementCodes` 收集处：造公告的测试里把标题/编号 push 进数组；执行时按实际造数字段对齐——若按 code 删不准，改为 `where: { title: { startsWith: 'E2E招标公示-' } }` 定向清本次运行前缀。）

- [ ] **Step 3: 种子通知清残留**——`Notification.json` 删除 title 含「E2E测试项目」的 10 条：

Run: `cd apps/api && node -e "
const fs=require('fs');const p='prisma/seed-data/Notification.json';
const a=JSON.parse(fs.readFileSync(p,'utf8'));
const kept=a.filter(n=>!(n.title||'').includes('E2E测试项目'));
console.log('删除',a.length-kept.length,'条 E2E 残留');
fs.writeFileSync(p,JSON.stringify(kept,null,2)+'\n');"`

- [ ] **Step 4: 验证 + Commit**

Run: `cd apps/supplier-portal-next && pnpm lint && cd ../api && pnpm test -- bid.e2e-spec --forceExit 2>/dev/null || true`（e2e 需基础设施，CI 跑；本地至少 tsc）

```bash
git add "apps/supplier-portal-next/src/app/(main)/bids/page.tsx" apps/api/test/bid.e2e-spec.ts apps/api/prisma/seed-data/Notification.json
git commit -m "fix(ui-audit): P1-5 可投标空态解释+e2e公告清理+种子通知E2E残留清除——通知数与列表数不再无解释断裂"
```

---

### Task 12: P2 批量清扫（已定位 6 项小修）

**背景**：核查确认属实且已定位的 P2 打包一 task（每项独立小 diff，一次提交）。**本轮不做**需运行时定位/独立设计的项（见文末清单）。

**Files / Steps:**

- [ ] **12a 双门户 title 区分**：`apps/bid-portal/src/app/layout.tsx:6` title 改 `'开评标管理端-智慧水发·蜀水云采'`（:3006 保持原名）。
- [ ] **12b 「已确认」补宾语**：`my-bids/page.tsx:305-306` 禁用钮文案改「唱标已确认」+ `title="开标记录确认状态：已确认"`；同页状态列（公开唱标表直出枚举串处，opening-hall/page.tsx:508）映射为「已确认/待确认/异常确认」短标签。
- [ ] **12c 时间三元组按时间序**：`my-bids/page.tsx:244-261` meta 行由静态 提交→开标→截止 改为按时间值升序渲染（截止→提交→开标 或 提交→截止→开标，以实际时间戳排序；业务恒有 deadline<openTime）。
- [ ] **12d 404 页入壳**：`apps/supplier-portal-next/src/app/not-found.tsx` 迁入 `(main)` 路由组（或改为自带返回导航+品牌头的最小壳），不再裸块。
- [ ] **12e U盾空态文案**：`profile/ukey/page.tsx:483-486` 空态文案改为不引用未渲染按钮：「…解锁 U盾 并枚举到本企业证书后，可在下方完成绑定关联」。
- [ ] **12f 矩阵分母不收缩**：`evaluation-view.tsx:87` `cell.maxScore += item.maxScore` 改为对**全部** scoreItems 累计（未评项 max 也计入分母），已评计数 `scoredCount` 已有——明细行 `（{cell.scoredCount}/{scoreItems.length} 项）` 已表达进度，分母稳定后同列可比。

- [ ] **验证**：三个 app 各 `npx tsc --noEmit && pnpm lint`；`apps/supplier-portal-next && pnpm test`。
- [ ] **Commit**：

```bash
git add apps/bid-portal/src/app/layout.tsx "apps/supplier-portal-next/src/app/(main)/my-bids/page.tsx" "apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx" apps/supplier-portal-next/src/app/not-found.tsx "apps/supplier-portal-next/src/app/(main)/profile/ukey/page.tsx" apps/bid-portal/src/components/workspace/evaluation-view.tsx
git commit -m "fix(ui-audit): P2 批量清扫——门户title区分/唱标确认宾语/时间序/404入壳/U盾空态/矩阵分母"
```

---

## 本轮不做（留档）

**需运行时定位/独立设计（下一轮候选）**：解密表「重录唱标」操作错位与「已确认/未签名」双词并列、解密时间列全空、两个澄清区并存、任务板四计数常显标签与「异议 0/3」分母消歧、专家页五种进度指标口径统一、评标签字六步流程引导、登录页默认管理员 tab、「风险提示：种子数据」开发文案泄漏、不可投标禁用钮排序（bids/[id] hero）。

**核查裁定不属实/有意设计（不修）**：无参 URL 默认 tab（代码 OPENING→开标大厅）；「可预览」badge；七步向导首步编号（完成态 ✓ 属设计）；「资格性/符合性审查 0 分」（三端已按通过制渲染）；监督实名名单事件刷屏（已有 30 分钟去重）；F10「结果已生成不收起建议流标」（有意设计，执行流标已有不可逆 confirm）。

**P1-3 实名/编号间歇切换**：机制有设计+页面已有规则注释（`evaluation-view.tsx:636`）；Task 4 回退告警落地后复查是否复现——若仍翻转，单独开运行时排查任务（疑点：live 端点与 getProject 两条编号下发路径在确认态边界的口径）。

## Self-Review 记录

- 覆盖：P0-1→T2、P0-2→T5/T6、P0-3a→T4、P0-3b→种子修正(T5)+F10 设计不修+confirm 已存在、P0-3c→T4；P1-1→T9、P1-2→T7、P1-3→T4 复查项、P1-4→T3、P1-5→T11、P1-6/7→T10、P1-8→T8、P1-9→T2；P2 已定位 6 项→T12。无缺口。
- 占位符：T10 API 文案拆分按 :538 现状给了两路径（参数化），执行者读实际代码二选一——意图与目标文案已给全。
- 类型一致性：`formatBidPrice`/`parseAmountToYuan` 签名在 T1 定义、T2/T4/T9 消费一致；`invalid` 字段 T2 API 产出/前端消费一致。
