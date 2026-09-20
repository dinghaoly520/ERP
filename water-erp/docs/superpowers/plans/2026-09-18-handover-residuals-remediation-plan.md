# 回流包遗留项修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消解回流包完整性扩展 v2（86d8594e）审查后的四项遗留：AI 报告类目保护、evaluationSnapshot 自描述、开标签字页归档取件、迁移脚本；人脸核验与运营备份为对接/核对项，不在本计划实施。

**Architecture:** 全部改动限于 `apps/api`（upload 域常量、ai-bid-analysis worker、bid 证据包、archive 导出）+ 一个幂等迁移脚本。无 schema 变更（`FileAsset.category` 是自由字符串列，白名单在代码侧收敛——见 `upload-categories.ts` 头注释）。证据链不变量：**回流包/归档卷引用的每个 FileAsset，要么类目在删除保护清单、要么按引用 id 可被归档导出取件。**

**Tech Stack:** NestJS 11 + Prisma（无迁移）、Jest（ts-jest）、tsx 脚本（dry-run 默认 + `--execute`，仓库既有惯例见 `scripts/align-opening-deadline-24h.ts`）。

**Spec:** `docs/superpowers/specs/2026-08-13-expert-paper-signing-design.md`（末三节：2026-09-18 完整性扩展 v2 增补 + 回避手动裁定增补 + 2026-09-20 归档取件三守卫修复增补）

## Global Constraints

- **并行会话协作约定（CLAUDE.md）**：另一会话在做专家人脸核验，**热区文件 `src/expert/expert.service.ts` 本计划一律不碰**；`git add` 只用显式路径，禁 `git add -A`；提交前后各跑一次 `git status --short` 校验暂存内容。
- **无 Prisma 迁移**：`category` 列不动 schema；存量数据走 Task 2 脚本，勿 `prisma migrate`（OperationLog 分区表 DDL 禁 diff 重生成）。
- **worker 不带 watch**：改 `ai-bid-analysis` 源码后须 `pkill -f ai-bid-analysis-worker` 再 `pnpm --filter api dev:worker:ai-bid-analysis` 重启（memory `ai-bid-worker-independent-process`）。
- 测试命令统一 `npx jest <pattern>`（在 `apps/api/` 下跑）；提交信息 `feat(...)`/`fix(...)` + `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 类目字符串常量唯一拼法：`ai_bid_report`（下划线，与 `bid_opening_handover` 同风格）。

---

### Task 1: AI 报告专用类目 + 删除保护

**Files:**
- Modify: `apps/api/src/ai-bid-analysis/queues/bidder.processor.ts:460`（`category: 'general'` → `'ai_bid_report'`）
- Modify: `apps/api/src/upload/upload-categories.ts`（UPLOAD_CATEGORIES 注册）
- Modify: `apps/api/src/upload/upload.service.ts:30-44`（EVIDENCE_PROTECTED_CATEGORIES 加项并导出）
- Test: `apps/api/src/upload/upload.service.spec.ts`（保护类目断言列表）

**Interfaces:**
- Consumes: 无（首任务）
- Produces: `export const EVIDENCE_PROTECTED_CATEGORIES: readonly string[]`（upload.service.ts 导出，Task 4 的 spec 引用）；类目 `'ai_bid_report'`（Task 2 迁移目标值、Task 4 断言引用）

- [ ] **Step 1: 写失败测试——保护清单含 ai_bid_report**

在 `upload.service.spec.ts` 中定位既有保护类目断言（`rg -n "expert_memo_ink.*expert_signin_photo" apps/api/src/upload/upload.service.spec.ts`，约 :484 的字面量数组），在该数组中追加 `'ai_bid_report'`：

```ts
      'expert_memo_ink', 'expert_signin_photo', 'ai_bid_report',
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd apps/api && npx jest src/upload/upload.service.spec.ts`
Expected: FAIL——被测清单缺 `ai_bid_report`

- [ ] **Step 3: 最小实现**

`upload.service.ts` 保护清单（:30-44）加一行并把 const 导出（Task 4 交叉断言需要）：

```ts
export const EVIDENCE_PROTECTED_CATEGORIES = [
  // …既有各行不动…
  'ai_bid_report',                // AI 投标分析报告（worker 生成；回流包 aiAnalysis 引用件，防删致引用悬空）
];
```

`upload-categories.ts` 的 `UPLOAD_CATEGORIES` 集合加（注释块同风格）：

```ts
  'ai_bid_report',                 // AI 投标分析报告（worker 生成，回流包引用件）
```

`bidder.processor.ts:460` 的 `fileAsset.create` data 中：

```ts
            category: 'ai_bid_report', // 2026-09-18：专用类目（原 general 无删除保护，回流包/归档引用该报告）
```

- [ ] **Step 4: 跑测试确认绿 + 类型检查**

Run: `cd apps/api && npx jest src/upload/upload.service.spec.ts && npx tsc --noEmit -p tsconfig.build.json`
Expected: 全 PASS，tsc 0 错

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/upload/upload.service.ts apps/api/src/upload/upload-categories.ts \
        apps/api/src/upload/upload.service.spec.ts apps/api/src/ai-bid-analysis/queues/bidder.processor.ts
git commit -m "feat(upload): AI 分析报告专用类目 ai_bid_report 入删除保护清单"
```

---

### Task 2: 存量 AI 报告类目迁移脚本

**Files:**
- Create: `apps/api/scripts/migrate-ai-report-category.ts`
- Test: `apps/api/scripts/migrate-ai-report-category.spec.ts`

**Interfaces:**
- Consumes: Task 1 的目标类目 `'ai_bid_report'`
- Produces: `planAiReportCategoryMigrations(reports, assetsById)` 纯函数（脚本导出供 spec）；运行入口 `npx tsx apps/api/scripts/migrate-ai-report-category.ts [--execute]`

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/scripts/migrate-ai-report-category.spec.ts
import { planAiReportCategoryMigrations, TARGET_CATEGORY, AiReportRow } from './migrate-ai-report-category';

describe('planAiReportCategoryMigrations（AI 报告类目迁移计划）', () => {
  const mk = (id: string, key: string, category: string) => ({ id, key, category });

  it('待迁移：general → ai_bid_report', () => {
    const reports: AiReportRow[] = [{ id: 'r1', taskId: 't1', docxFileId: 'fa1', pdfFileId: null }];
    const assets = new Map([['fa1', mk('fa1', 'reports/t1/ai-bid-analysis-report.docx', 'general')]]);
    expect(planAiReportCategoryMigrations(reports, assets).migrations).toEqual([
      { fileAssetId: 'fa1', key: 'reports/t1/ai-bid-analysis-report.docx', from: 'general' },
    ]);
  });

  it('已合规跳过；孤儿资产（FileAsset 缺行）列入 missing 不动', () => {
    const reports: AiReportRow[] = [
      { id: 'r1', taskId: 't1', docxFileId: 'fa1', pdfFileId: null },
      { id: 'r2', taskId: 't2', docxFileId: 'fa2', pdfFileId: 'fa3' },
    ];
    const assets = new Map([['fa1', mk('fa1', 'k1', 'ai_bid_report')]]); // fa2/fa3 缺行
    const plan = planAiReportCategoryMigrations(reports, assets);
    expect(plan.migrations).toEqual([]);
    expect(plan.missing).toEqual(['fa2', 'fa3']);
  });

  it('目标类目常量为 ai_bid_report', () => {
    expect(TARGET_CATEGORY).toBe('ai_bid_report');
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd apps/api && npx jest scripts/migrate-ai-report-category.spec.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: 写脚本（完整）**

```ts
// apps/api/scripts/migrate-ai-report-category.ts
/**
 * 存量 AI 分析报告 FileAsset 类目迁移（回流包遗留项修复 · Task 2）
 *
 * 背景：ai-bid worker 此前以 category='general' 落 AI 报告 docx（bidder.processor.ts），
 * general 不在 EVIDENCE_PROTECTED_CATEGORIES——回流包 aiAnalysis.report.docx 引用该资产，
 * 被删即引用悬空。Task 1 起新报告落 'ai_bid_report'；本脚本把存量对齐。
 *
 * 用法：
 *   npx tsx apps/api/scripts/migrate-ai-report-category.ts            # dry-run（默认，零副作用）
 *   npx tsx apps/api/scripts/migrate-ai-report-category.ts --execute  # 真实更新 category
 *
 * 候选集：AiBidReport.docxFileId/pdfFileId 指向、且 category ≠ ai_bid_report 的 FileAsset。
 * 幂等：已合规行不产生迁移；--execute 重跑为 no-op。孤儿（引用 id 无 FileAsset 行）仅列出。
 */
import { PrismaClient } from '@prisma/client';

export const TARGET_CATEGORY = 'ai_bid_report';
export interface AiReportRow { id: string; taskId: string; docxFileId: string | null; pdfFileId: string | null }
export interface AssetRow { id: string; key: string; category: string }

export function planAiReportCategoryMigrations(reports: AiReportRow[], assetsById: Map<string, AssetRow>): {
  migrations: Array<{ fileAssetId: string; key: string; from: string }>;
  missing: string[];
} {
  const migrations: Array<{ fileAssetId: string; key: string; from: string }> = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const r of reports) {
    for (const fid of [r.docxFileId, r.pdfFileId]) {
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      const a = assetsById.get(fid);
      if (!a) { missing.push(fid); continue; }
      if (a.category !== TARGET_CATEGORY) migrations.push({ fileAssetId: a.id, key: a.key, from: a.category });
    }
  }
  return { migrations, missing };
}

async function main() {
  const execute = process.argv.includes('--execute');
  const prisma = new PrismaClient();
  try {
    const reports = await prisma.aiBidReport.findMany({
      select: { id: true, taskId: true, docxFileId: true, pdfFileId: true },
    });
    const ids = [...new Set(reports.flatMap(r => [r.docxFileId, r.pdfFileId]).filter((x): x is string => !!x))];
    const assets = ids.length > 0
      ? await prisma.fileAsset.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, category: true } })
      : [];
    const { migrations, missing } = planAiReportCategoryMigrations(reports, new Map(assets.map(a => [a.id, a])));

    console.log(`AiBidReport 共 ${reports.length} 条；待迁移 ${migrations.length} 件；孤儿引用 ${missing.length} 件`);
    for (const m of migrations) console.log(`  [迁移] ${m.key}  ${m.from} -> ${TARGET_CATEGORY}`);
    for (const x of missing) console.log(`  [孤儿] FileAsset 缺行：${x}（AiBidReport 引用悬空，需人工核查）`);

    if (!execute) { console.log('\ndry-run 结束（未写库）。加 --execute 执行迁移。'); return; }
    if (migrations.length === 0) { console.log('无可迁移行。'); return; }
    const res = await prisma.fileAsset.updateMany({
      where: { id: { in: migrations.map(m => m.fileAssetId) } },
      data: { category: TARGET_CATEGORY },
    });
    console.log(`\n已更新 ${res.count} 件 FileAsset.category -> ${TARGET_CATEGORY}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
```

注意：spec 文件须被 jest 拾取——仓库 `testPathPattern` 默认含 `scripts/` 下 `*.spec.ts`（若不匹配，把 spec 移至 `apps/api/src/upload/` 并保持 import 路径 `../../scripts/migrate-ai-report-category`；以实际运行为准）。

- [ ] **Step 4: 跑测试确认绿**

Run: `cd apps/api && npx jest scripts/migrate-ai-report-category.spec.ts`
Expected: 3 PASS

- [ ] **Step 5: dry-run 实测 + 提交**

Run: `npx tsx apps/api/scripts/migrate-ai-report-category.ts`
Expected: 输出统计与清单、无写库。然后：

```bash
git add apps/api/scripts/migrate-ai-report-category.ts apps/api/scripts/migrate-ai-report-category.spec.ts
git commit -m "feat(scripts): 存量 AI 报告类目迁移脚本（dry-run 默认，--execute 幂等）"
```

`--execute` 留给用户在演示/生产库择机执行（执行后旧报告即受删除保护）。

---

### Task 3: evaluationSnapshot 评分项定义自描述

**Files:**
- Modify: `apps/api/src/bid/bid-evaluation-results.service.ts:34-77`（buildEvaluationPackage）
- Test: `apps/api/src/bid/bid-evaluation-results.service.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: 完整性包 body 新段 `scoreItemDefinitions: Array<{ id: string; name: string; category: string; maxScore: number; points: Array<{ id: string; name: string }> }>`——`scoreRecords[].scoreItemId` 与 `pointDecisions[].pointId` 的解析源（回流包 `evaluationSnapshot` 即此包整体内嵌，自动获得）

- [ ] **Step 1: 写失败测试（服务级）**

在 `bid-evaluation-results.service.spec.ts` 末尾追加（自建 module，mock 全部 prisma delegate）：

```ts
describe('buildEvaluationPackage scoreItemDefinitions（2026-09-18 自描述补全）', () => {
  it('评分项/得分点定义入包，scoreRecords 的 scoreItemId 可离线解析', async () => {
    const prisma = {
      bidExpert: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
      bidScoreRecord: { findMany: jest.fn().mockResolvedValue([
        { expertId: 'e1', supplierId: 's1', scoreItemId: 'si1', score: new Prisma.Decimal('18'), passed: true, reason: null }]) },
      bidScoreRecordHistory: { findMany: jest.fn().mockResolvedValue([]) },
      bidScorePointDecision: { findMany: jest.fn().mockResolvedValue([
        { expertId: 'e1', pointId: 'sp1', supplierId: 's1', checked: true, awardedScore: new Prisma.Decimal('5'), note: '要点说明' }]) },
      bidExpertConfirm: { findMany: jest.fn().mockResolvedValue([]) },
      bidScoreItem: { findMany: jest.fn().mockResolvedValue([
        { id: 'si1', name: '商务评分', category: 'BUSINESS', maxScore: new Prisma.Decimal('20'),
          points: [{ id: 'sp1', name: '商务要点1' }] }]) },
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: PriceFormulaService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: BidService, useValue: {} },
        BidEvaluationResultsService,
      ],
    }).compile();
    const svc = module.get(BidEvaluationResultsService);

    const pkg = await svc.buildEvaluationPackage('proj-1');

    expect(pkg.scoreItemDefinitions).toEqual([
      { id: 'si1', name: '商务评分', category: 'BUSINESS', maxScore: 20, points: [{ id: 'sp1', name: '商务要点1' }] },
    ]);
    expect(pkg.scoreRecords[0].scoreItemId).toBe('si1'); // 与定义可对上
  });
});
```

（`bidExpertConfirm` 若现有实现复用 `bidExpert.findMany` 取 expertConfirmations——以现有第 42-60 行的 Promise.all 为准对齐 mock key：现有实现是 `bidExpert.findMany` select expertName 等字段，同一个 delegate 被调用两次（expertIds + confirmations）——mock 返回值需兼容两次调用：第一次 `{ id: 'e1' }`、第二次需含 expertName/expertRole/reportConfirmed 等字段。执行时若两次调用共用一个 mock 报字段缺失，改为 `mockResolvedValueOnce(...).mockResolvedValue(...)` 两段返回。）

- [ ] **Step 2: 跑测试确认红**

Run: `cd apps/api && npx jest src/bid/bid-evaluation-results.service.spec.ts`
Expected: FAIL——`scoreItemDefinitions` undefined

- [ ] **Step 3: 实现**

`buildEvaluationPackage` 的 Promise.all 解构改为 `[records, allHistory, pointDecisions, experts, scoreItems]`，Promise.all 增第 5 项（与既有四项并列）：

```ts
      this.prisma.bidScoreItem.findMany({
        where: { projectId },
        // 稳定排序保证指纹确定性（@@unique([projectId, name])，name 唯一可作序键）
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, category: true, maxScore: true, points: { select: { id: true, name: true } } },
      }),
```

```ts
      // 2026-09-18 自描述补全：评分项/得分点定义——scoreRecords.scoreItemId 与 pointDecisions.pointId
      // 的解析源（此前 JSON 离线读包需回库反查；纸面签字包 PDF §六有名称但机器不可读）
      scoreItemDefinitions: scoreItems.map(i => ({
        id: i.id, name: i.name, category: i.category,
        maxScore: Number(i.maxScore),
        points: i.points.map(p => ({ id: p.id, name: p.name })),
      })),
```

包注释（`packageVersion: 2` 行旁）追加一句：`// 2026-09-18 二次扩展：+scoreItemDefinitions（v2 当日未推送，原位并版不留 3）`。同时把同 spec 的数据字面量用例补 `scoreItemDefinitions` 字段保持文档一致。

- [ ] **Step 4: 跑测试确认绿**

Run: `cd apps/api && npx jest src/bid/bid-evaluation-results.service.spec.ts src/bid/bid-sign-packet.service.spec.ts`
Expected: 全 PASS（sign-packet spec 的 evaluationSnapshot mock 不受影响）

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/bid/bid-evaluation-results.service.ts apps/api/src/bid/bid-evaluation-results.service.spec.ts
git commit -m "feat(bid): 评标完整性包补 scoreItemDefinitions（JSON 离线自描述）"
```

---

### Task 4: 开标签字页归档取件 + 类目交叉断言

**Files:**
- Modify: `apps/api/src/archive/archive-export.service.ts:102-111`（取件 where）
- Create: `apps/api/src/archive/archive-pickup-categories.spec.ts`
- Modify: `apps/api/src/upload/upload.service.spec.ts`（若 Task 1 未覆盖导出引用则无改动）

**Interfaces:**
- Consumes: 无（显式清单断言，不做跨模块推导；Task 1 的 `EVIDENCE_PROTECTED_CATEGORIES` 导出保留供后续 enum 迁移/交叉断言用，本任务不引用）
- Produces: `export const ARCHIVE_PICKUP_CATEGORIES: readonly string[]`（archive-export.service.ts 模块级导出）

事实依据：开标签字页 key = `opening-sign-page/${projectId}.pdf`（opening-sign.service.ts:91，含项目 ID）；扫描件同文件同款前缀——**key 含项目 ID，走类目取件即可，无需引用 id**。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/archive/archive-pickup-categories.spec.ts
import { ARCHIVE_PICKUP_CATEGORIES } from './archive-export.service';

describe('归档取件类目覆盖（2026-09-18 补漏锁定）', () => {
  it('key 含项目 ID 的开评标留痕件全部在类目取件清单', () => {
    // bid_evaluation_handover 走 OR 第一支精确 key（bid-evaluation-handover/${bp.id}.json），不在类目清单属预期
    for (const c of [
      'bid_opening_handover', 'bid_evaluation_sign_handover', 'bid_sign_packet',
      'sign_packet_signature_page', 'expert_sign_scan', 'bid_decrypted',
      'opening_sign_page', 'opening_sign_scan',
    ] as const) {
      expect(ARCHIVE_PICKUP_CATEGORIES).toContain(c);
    }
  });

  it('key 不含项目 ID 的引用件类目不得混入类目取件（它们走引用 id 取件）', () => {
    for (const c of ['expert_memo_ink', 'expert_signin_photo', 'clarification_reply', 'ai_bid_report'] as const) {
      expect(ARCHIVE_PICKUP_CATEGORIES).not.toContain(c);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd apps/api && npx jest src/archive/archive-pickup-categories.spec.ts`
Expected: FAIL——`ARCHIVE_PICKUP_CATEGORIES` 未导出/缺 opening 两类目

- [ ] **Step 3: 实现**

archive-export.service.ts 取件处（`09_开评标接收件` 的 findMany）把内联数组提为模块级导出常量并补两类目：

```ts
/** 2026-09-18：归档取件类目——key 含项目 ID 的开评标留痕件按类目+key 前缀取；
 * key 不含项目 ID 的（uploads/{date}/{random}、reports/{taskId}/…）走引用 id 取件，不得混入此清单 */
export const ARCHIVE_PICKUP_CATEGORIES = [
  'bid_opening_handover', 'bid_sign_packet', 'bid_decrypted',
  'bid_evaluation_sign_handover', 'sign_packet_signature_page', 'expert_sign_scan',
  'opening_sign_page', 'opening_sign_scan', // 2026-09-18 补：P1-3①A 开标记录签字页/开标签字扫描（key=opening-sign-*​/${projectId}.*）
] as const;
```

findMany 的 where 第二支改用 `{ key: { contains: bp.id }, category: { in: [...ARCHIVE_PICKUP_CATEGORIES] } }`。

- [ ] **Step 4: 跑测试确认绿 + 回归**

Run: `cd apps/api && npx jest src/archive/ src/bid/bid.service.spec.ts && npx tsc --noEmit -p tsconfig.build.json`
Expected: 全 PASS，tsc 0 错

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/archive/archive-export.service.ts apps/api/src/archive/archive-pickup-categories.spec.ts
git commit -m "fix(archive): 开标签字页/扫描件入归档取件清单 + 类目覆盖断言锁定"
```

---

## 非实施项（对接/核对，随计划归档）

| 项 | 性质 | 处置 |
|---|---|---|
| 人脸核验产物入回流包 | 对接耦合 | 另一会话在册设计（`docs/superpowers/specs/2026-09-18-expert-face-verification-design.md`，未提交）。其落地时按 memory `bid-handover-completeness-v2` 的「三处同步」规则接入：generateHandover 新段 + buildSnapshot（若需纸面）+ archive-export 取件（新类目须同时进 `EVIDENCE_PROTECTED_CATEGORIES` 与取件/引用路径）。**本计划不实施、不改 expert.service.ts。** |
| MinIO 备份 ≥15 年 / keystore 目录备份 | 运营核对 | 已载 CLAUDE.md（「双信封新轨·生产启用前清单」+「操作日志法定留存」两节）。部署前按清单逐项核对，无代码改动。 |
| 全量 6 例存量测试红（timeline/supplier） | 他会在册 | 另一会话 memory `main-preexisting-test-reds-2026-09-18` 跟踪，勿在本计划顺手修（跨域 + 并行会话避让）。 |

## 验收（计划完成定义）

1. Task 1-4 全部勾选、各自提交入库；`cd apps/api && npx jest` 全量绿（除在册 6 例存量红）。
2. 迁移脚本 dry-run 输出与 DB 实际 AiBidReport 数一致；`--execute` 后重跑为 no-op。
3. 新生成一次回流包（演示项目走完签字闭环 → 生成回流包），检查 JSON：`aiAnalysis.report.docx` 引用存在、`evaluationSnapshot.scoreItemDefinitions` 存在。
4. 归档导出卷内 `09_开评标接收件/` 含 `opening_sign_page`、`ai_bid_report` 类目文件（有存量数据时）。
