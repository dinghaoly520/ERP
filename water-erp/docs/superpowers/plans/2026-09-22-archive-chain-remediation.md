# 开评标归档链路整改实施计划（2026-09-22 审查报告逐条修复）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复审查报告（`water-erp/docs/开评标归档链路完备性审查-归档包回流包-2026-09-22.md`）中的 P1-1/P1-2/P2-1/P2-2/P2-5 五项代码缺口，并用演示项目端到端验证。

**Architecture:** 以「共享证据件收集器」为单一取件源（检测/导出/勾稽三处共用，杜绝清单漂移）；导出侧补 DB 指纹比对；存量开标文件包用 dry-run 默认的回填脚本补单位与会场交流；范围勾稽表对齐新类目；最后浏览器重走签字闭环做端到端验证。P2-3（:3005 查验视图）经用户裁定另开任务，不在本计划。

**Tech Stack:** NestJS 11 + Prisma（apps/api）、jest（单测）、tsx 脚本（PrismaClient + minio Client 直连）、chrome-devtools MCP（端到端）。

**Spec:** `water-erp/docs/开评标归档链路完备性审查-归档包回流包-2026-09-22.md` 第五节（问题定位与修复建议）

## Global Constraints

- **无 schema 改动**（本轮纯应用层 + 脚本，不碰 `schema.prisma`）。
- **并行会话约定**：工作区现有他人未提交改动 `apps/api/src/tender-write/tender-write.template.ts`——不碰、不卷入提交；只 `git add` 自己明确改动的文件路径，**禁 `git add -A`/`git add .`**；每次 commit 前先 `git branch --show-current` 确认在 main。
- **不主动 push**（memory `no-auto-push-reminder-only`）：commit 后只报未推送数。
- TS import 约定：CJS 函数导出包用 `import x = require('pkg')`（本计划无新增此类依赖；脚本内 `import { Client } from 'minio'` 沿用 `scripts/clean-legacy-plaintext.ts:40` 先例）。
- 测试命令统一从 `water-erp/` 根：`pnpm --filter api test -- <pattern>`；**改归档导出循环的任务必跑 `archive-export-asip` spec**（memory `bid-handover-completeness-v2` 铁律）。
- 提交信息前缀按域：`fix(archive):` / `feat(bid):` / `chore(scripts):`，末尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 脚本从 `apps/api/` 目录跑（`npx tsx scripts/xxx.ts`；从根跑会 tsx not found——memory 先例）。

---

### Task 1: 共享证据件收集器（P1-1 地基 + P2-5 分页迁移）

**Files:**
- Create: `apps/api/src/archive/archive-evidence.collector.ts`
- Modify: `apps/api/src/archive/archive-export.service.ts`（常量/分页函数迁走后 re-export，保持既有 import 不变）
- Test: `apps/api/src/archive/archive-evidence.collector.spec.ts`

**Interfaces:**
- Produces（后续任务全部依赖）:
  - `ARCHIVE_PICKUP_CATEGORIES: readonly string[]`（自 export service 迁入）
  - `HANDOVER_PICKUP_PAGE_SIZE = 200`、`fetchAllPaged<TArgs, T>(finder, args): Promise<T[]>`（自 export service 迁入）
  - `extractEvidenceRefIds(sources: EvidenceRefSources): Set<string>`（纯函数）
  - `collectBidEvidenceAssets(prisma: PrismaService, bpId: string): Promise<CollectedEvidence>`，其中 `CollectedEvidence = { assets: EvidenceAssetRow[]; refIds: Set<string>; missingRefIds: string[] }`，`EvidenceAssetRow = { id; key; originalName: string | null; category: string | null; sha256: string | null }`

- [ ] **Step 1: 写失败测试** `archive-evidence.collector.spec.ts`

```ts
import { ARCHIVE_PICKUP_CATEGORIES, extractEvidenceRefIds, EvidenceRefSources } from './archive-evidence.collector';

describe('extractEvidenceRefIds（证据件引用 id 提取，纯函数）', () => {
  const sources: EvidenceRefSources = {
    memoInks: [{ inkFileId: 'ink1' }, { inkFileId: null }],
    experts: [
      { signScanFileId: 'scan1', signInMeta: { photoAssetId: 'photo1' } },
      { signScanFileId: null, signInMeta: null },
    ],
    packet: { fileAssetId: 'pdf1', signPageScanFileId: 'signpage1', handoverFileAssetId: 'ho1' },
    clarifications: [{ fileAssetId: 'cl1', replyAttachmentIds: [{ fileAssetId: 'cl2' }, null] }],
    aiReport: { docxFileId: 'doc1', pdfFileId: null },
  };
  it('五源引用全提取去重', () => {
    expect([...extractEvidenceRefIds(sources)].sort()).toEqual(
      ['cl1', 'cl2', 'doc1', 'ho1', 'ink1', 'pdf1', 'photo1', 'scan1', 'signpage1'].sort(),
    );
  });
  it('packet/aiReport 为 null 时安全跳过', () => {
    const s: EvidenceRefSources = { memoInks: [], experts: [], packet: null, clarifications: [], aiReport: null };
    expect(extractEvidenceRefIds(s).size).toBe(0);
  });
});

describe('取件常量单一源（P1-1：检测/导出/勾稽共用）', () => {
  it('key 含项目 ID 的 8 类留痕件全在清单', () => {
    for (const c of ['bid_opening_handover', 'bid_evaluation_sign_handover', 'bid_sign_packet',
      'sign_packet_signature_page', 'expert_sign_scan', 'bid_decrypted', 'opening_sign_page', 'opening_sign_scan']) {
      expect(ARCHIVE_PICKUP_CATEGORIES).toContain(c);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**：`pnpm --filter api test -- archive-evidence` → 模块不存在，FAIL。

- [ ] **Step 3: 实现收集器**

```ts
// apps/api/src/archive/archive-evidence.collector.ts
/**
 * 开评标证据件单一取件源（2026-09-22 审查 P1-1）：
 * 四性检测（archive-check）/ ASIP 导出（archive-export）/ 范围勾稽（archive-scope）
 * 三处共用的 FileAsset 收集逻辑——此前检测清单（3 类）与导出清单（8 类）漂移，
 * 回流包/签字扫描/AI 报告等 5 类证据件零检测。改本文件 = 三端同步，禁止在别处另建清单。
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 2026-09-18：归档取件类目——key 含项目 ID 的开评标留痕件按类目+key 前缀取；
 * key 不含项目 ID 的（uploads/{date}/{random}、reports/{taskId}/…）走引用 id 取件，不得混入此清单 */
export const ARCHIVE_PICKUP_CATEGORIES = [
  'bid_opening_handover', 'bid_sign_packet', 'bid_decrypted',
  'bid_evaluation_sign_handover', 'sign_packet_signature_page', 'expert_sign_scan',
  'opening_sign_page', 'opening_sign_scan',
] as const;

/** 取件分页大小（2026-09-20 审查修复：原 take:200 无截断检测会静默丢件） */
export const HANDOVER_PICKUP_PAGE_SIZE = 200;

/** 分页全取 FileAsset：orderBy id 保证翻页稳定，页不满即穷尽（防 take 截断产出缺件残包） */
export async function fetchAllPaged<TArgs extends { skip?: number; take?: number }, T>(
  finder: (args: TArgs) => Promise<T[]>,
  args: Omit<TArgs, 'skip' | 'take' | 'orderBy'>,
): Promise<T[]> {
  const out: T[] = [];
  let skip = 0;
  for (;;) {
    const page = await finder({ ...args, orderBy: { id: 'asc' }, skip, take: HANDOVER_PICKUP_PAGE_SIZE } as unknown as TArgs);
    out.push(...page);
    if (page.length < HANDOVER_PICKUP_PAGE_SIZE) break;
    skip += HANDOVER_PICKUP_PAGE_SIZE;
  }
  return out;
}

export interface EvidenceAssetRow {
  id: string; key: string; originalName: string | null; category: string | null; sha256: string | null;
}

/** 引用件来源行形状（与导出侧五源查询对齐） */
export interface EvidenceRefSources {
  memoInks: Array<{ inkFileId: string | null }>;
  experts: Array<{ signScanFileId: string | null; signInMeta: unknown }>;
  packet: { fileAssetId: string | null; signPageScanFileId: string | null; handoverFileAssetId: string | null } | null;
  clarifications: Array<{ fileAssetId: string | null; replyAttachmentIds: unknown }>;
  aiReport: { docxFileId: string | null; pdfFileId: string | null } | null;
}

/** 引用件 id 提取（纯函数）：笔迹图/签字扫描/签到照（藏 signInMeta）/签字包三资产/澄清附件/AI 报告 */
export function extractEvidenceRefIds(sources: EvidenceRefSources): Set<string> {
  const ids = new Set<string>();
  sources.memoInks.forEach(m => m.inkFileId && ids.add(m.inkFileId));
  sources.experts.forEach(e => {
    if (e.signScanFileId) ids.add(e.signScanFileId);
    const photoId = (e.signInMeta as { photoAssetId?: unknown } | null)?.photoAssetId;
    if (typeof photoId === 'string') ids.add(photoId);
  });
  if (sources.packet) [sources.packet.fileAssetId, sources.packet.signPageScanFileId, sources.packet.handoverFileAssetId]
    .forEach((x: string | null) => x && ids.add(x));
  sources.clarifications.forEach(c => {
    if (c.fileAssetId) ids.add(c.fileAssetId);
    for (const a of ((c.replyAttachmentIds as Array<{ fileAssetId?: unknown }> | null) ?? [])) {
      if (a && typeof a.fileAssetId === 'string') ids.add(a.fileAssetId);
    }
  });
  if (sources.aiReport) [sources.aiReport.docxFileId, sources.aiReport.pdfFileId]
    .forEach((x: string | null) => x && ids.add(x));
  return ids;
}

export interface CollectedEvidence {
  assets: EvidenceAssetRow[];
  refIds: Set<string>;
  /** 引用悬空（FileAsset 无行）——检测端记 FAIL，导出端整体拒绝 */
  missingRefIds: string[];
}

/** 单个 BidProject 的全部归档证据件：精确 key 包 + 类目取件 + 引用 id 取件，去重合一 */
export async function collectBidEvidenceAssets(prisma: PrismaService, bpId: string): Promise<CollectedEvidence> {
  const [memoInks, experts, packet, clarifications, aiTask] = await Promise.all([
    prisma.expertMemo.findMany({ where: { projectId: bpId }, select: { inkFileId: true } }),
    prisma.bidExpert.findMany({ where: { projectId: bpId }, select: { signScanFileId: true, signInMeta: true } }),
    prisma.bidSignPacket.findUnique({ where: { projectId: bpId }, select: { fileAssetId: true, signPageScanFileId: true, handoverFileAssetId: true } }),
    prisma.bidClarification.findMany({ where: { projectId: bpId }, select: { fileAssetId: true, replyAttachmentIds: true } }),
    prisma.aiBidAnalysisTask.findUnique({ where: { projectId: bpId }, select: { report: { select: { docxFileId: true, pdfFileId: true } } } }),
  ]);
  const refIds = extractEvidenceRefIds({
    memoInks, experts, packet,
    clarifications, aiReport: aiTask?.report ?? null,
  });
  const assets = await fetchAllPaged(
    (a: Prisma.FileAssetFindManyArgs) => prisma.fileAsset.findMany(a),
    {
      where: {
        OR: [
          { key: `bid-evaluation-handover/${bpId}.json` },
          { key: { contains: bpId }, category: { in: [...ARCHIVE_PICKUP_CATEGORIES] } },
          { id: { in: [...refIds] } },
        ],
      },
      select: { id: true, key: true, originalName: true, category: true, sha256: true },
    },
  );
  const found = new Set(assets.map(a => a.id));
  return { assets, refIds, missingRefIds: [...refIds].filter(id => !found.has(id)) };
}
```

- [ ] **Step 4: export service 迁出 + re-export**。`archive-export.service.ts`：删除 `ARCHIVE_PICKUP_CATEGORIES`/`HANDOVER_PICKUP_PAGE_SIZE`/`fetchAllPaged` 的定义（19-44 行区域），顶部改 import 并 re-export 保持外部引用不变：

```ts
export { ARCHIVE_PICKUP_CATEGORIES, HANDOVER_PICKUP_PAGE_SIZE, fetchAllPaged } from './archive-evidence.collector';
import { ARCHIVE_PICKUP_CATEGORIES, fetchAllPaged } from './archive-evidence.collector';
```

（`assertNoMissingRefs`/`uniqueEntryName` 留在 export service 不动。）

- [ ] **Step 5: 跑测试**：`pnpm --filter api test -- archive-evidence archive-pickup-categories archive-export` → 全 PASS（既有 `archive-pickup-categories.spec.ts` 经 re-export 仍绿）。

- [ ] **Step 6: 计划落盘 + commit**。先把本计划复制到 `water-erp/docs/superpowers/plans/2026-09-22-archive-chain-remediation.md`（repo 约定位置），然后：

```bash
git add apps/api/src/archive/archive-evidence.collector.ts apps/api/src/archive/archive-evidence.collector.spec.ts apps/api/src/archive/archive-export.service.ts docs/superpowers/plans/2026-09-22-archive-chain-remediation.md
git commit -m "fix(archive): 证据件单一取件源收集器——检测/导出共用，杜绝清单漂移（P1-1 地基）"
```

---

### Task 2: 四性检测接入收集器（P1-1 + P2-5 检测侧）

**Files:**
- Modify: `apps/api/src/archive/archive-check.service.ts:82-120`（M4 回流件检测块）
- Test: `apps/api/src/archive/archive-check.evidence.spec.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `collectBidEvidenceAssets`、`CollectedEvidence`。
- Produces: 检测明细新增两类 FAIL：`完整性-范围`（引用悬空）、既有 `完整性-哈希`（sha 不符）现覆盖全部证据件。

- [ ] **Step 1: 写失败测试**（mock prisma/storage/scope，参照 `archive-export-asip.spec.ts` 的 mock 手法）

```ts
// 关键用例骨架（完整实现时按既有 spec 的 mock 排队风格展开）：
// 1) missingRefIds → 明细含 { check: '完整性-范围', status: 'FAIL' }，overall=FAILED
// 2) 登记指纹 sha256 与下载内容重算不符 → { check: '完整性-哈希', status: 'FAIL' }
// 3) 指纹相符的回流包（category=bid_evaluation_sign_handover）→ 该件 PASS（旧代码下此件根本不进检测，用例即红）
```

- [ ] **Step 2: 跑测试确认失败**：`pnpm --filter api test -- archive-check` → FAIL（现实现不检测回流包/引用悬空）。

- [ ] **Step 3: 重写 M4 块**（`archive-check.service.ts` 82-120 行替换）：

```ts
// ── M4：回流件（FileAsset，MinIO）参与检测——§8.3 检测对象不应只有 PMI 附件 ──
// 2026-09-22 P1-1：改走共享收集器（与导出同源），回流包/签字扫描/开标签字页/AI 报告
// 及全部引用件（笔迹图/签到照/澄清附件）纳入哈希+可读检测；引用悬空记 FAIL。
import { collectBidEvidenceAssets } from './archive-evidence.collector'; // 顶部

const seenIds = new Set<string>();
for (const bp of item.bidProjects) {
  const { assets, missingRefIds } = await collectBidEvidenceAssets(this.prisma, bp.id);
  for (const missingId of missingRefIds) {
    details.push({
      code: '-', materialName: `证据件引用缺失（FileAsset ${missingId.slice(0, 8)}…）`,
      check: '完整性-范围', status: 'FAIL',
      message: '回流包引用的证据件在 FileAsset 中无行（可能已被删除），归档导出将被拒绝',
    });
  }
  for (const fa of assets) {
    if (seenIds.has(fa.id)) continue;
    seenIds.add(fa.id);
    const label = `回流件/${fa.originalName ?? fa.key}`;
    try {
      const buf = await this.storage.download(fa.key);
      if (buf.length === 0) throw new Error('对象为空');
      const digest = crypto.createHash('sha256').update(buf).digest('hex');
      const hashOk = fa.sha256 ? fa.sha256 === digest : true;
      details.push({ code: '-', materialName: label, check: '可用性-可读', status: 'PASS', message: '' });
      if (fa.sha256) {
        details.push({
          code: '-', materialName: label, check: '完整性-哈希',
          status: hashOk ? 'PASS' : 'FAIL',
          message: hashOk ? '' : 'MinIO 内容与上传时登记的 sha256 不符（对象可能被篡改或损坏）',
        });
      }
    } catch (err: any) {
      details.push({ code: '-', materialName: label, check: '可用性-可读', status: 'FAIL', message: `回流对象不可读：${err?.message ?? err}` });
    }
  }
}
```

（删除旧 `seenKeys` 逻辑与 `take: 50`——分页全取已在收集器内。）

- [ ] **Step 4: 跑测试**：`pnpm --filter api test -- archive-check` → PASS。
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/archive/archive-check.service.ts apps/api/src/archive/archive-check.evidence.spec.ts
git commit -m "fix(archive): 四性检测接入证据件收集器——回流包/签字扫描/引用件纳入哈希检测（P1-1）"
```

---

### Task 3: ASIP 导出指纹比对（P1-1 导出侧）

**Files:**
- Modify: `apps/api/src/archive/archive-export.service.ts:152-217`（09_开评标接收件取件循环）
- Test: `apps/api/src/archive/archive-export-guards.spec.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `collectBidEvidenceAssets`、既有 `assertNoMissingRefs`/`uniqueEntryName`。
- Produces: 导出循环内 DB 指纹比对——内容与登记 sha256 不符 → 计入 `fetchFailures` → 整体 400 `ARCHIVE_HANDOVER_FETCH_FAILED`（与取件失败同口径，绝不带病组包）。

- [ ] **Step 1: 追加失败测试**（guards spec）：

```ts
it('证据件内容与登记指纹不符 → 中止导出（防篡改内容被 manifest 合法化）', async () => {
  // mock：收集器返回 1 件回流包 FileAsset { sha256: 'aaa…' }，
  // storage.download 返回内容 hash 为 'bbb…' 的 buffer
  // 期望 exportAsip 抛 BadRequestException，code=ARCHIVE_HANDOVER_FETCH_FAILED，
  // error 含「内容与登记指纹不符」
});
```

- [ ] **Step 2: 跑测试确认失败**（现实现不比对，正常导出）。
- [ ] **Step 3: 改导出循环**——bp 循环内五源查询 + refIds 组装 + fetchAllPaged + assertNoMissingRefs（163-200 行）整块替换为：

```ts
const { assets, refIds } = await collectBidEvidenceAssets(this.prisma, bp.id);
assertNoMissingRefs(refIds, new Set(assets.map(a => a.id)));
```

下载循环内（201 行起）在 `const buf = await this.storage.download(fa.key);` 之后插入：

```ts
if (fa.sha256) {
  const digest = crypto.createHash('sha256').update(buf).digest('hex');
  if (digest !== fa.sha256) {
    fetchFailures.push(`${fa.originalName ?? fa.key}（内容与登记指纹不符，可能被篡改或损坏）`);
    continue;
  }
}
```

（`crypto` 已在该文件 import；manifest 里仍是重算值——通过件即与登记值一致，语义不变。）

- [ ] **Step 4: 跑全套导出 spec（铁律）**：`pnpm --filter api test -- archive-export` → guards + asip 全 PASS。
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/archive/archive-export.service.ts apps/api/src/archive/archive-export-guards.spec.ts
git commit -m "fix(archive): ASIP 导出前比对证据件 DB 指纹——篡改内容整体拒收（P1-1）"
```

---

### Task 4: 范围勾稽对齐 + 元数据覆盖（P2-1 + P2-5 勾稽侧）

**Files:**
- Modify: `apps/api/src/archive/archive-scope.service.ts:35-40`（patterns）、`archive-scope.seed.ts`（seed 行 + 存量同步）
- Modify: `apps/api/src/archive/archive-export.service.ts`（元数据.json 覆盖 fileAsset 件 + 兜底建档）
- Test: `apps/api/src/archive/archive-pickup-categories.spec.ts`（追加 patterns 覆盖断言）

**Interfaces:**
- Consumes: Task 1 的 `fetchAllPaged`。
- Produces: `HANDOVER_KEY_PATTERNS` 补 5 类；`FILE_CATEGORY_SYNC: Record<string, string[]>`（seed 导出常量）；ASIP `元数据.json` 覆盖卷内全部文件。

- [ ] **Step 1: 追加失败测试**：

```ts
// archive-pickup-categories.spec.ts 追加：
import { HANDOVER_KEY_PATTERNS } from './archive-scope.service';

it('key 含项目 ID 的取件类目都有勾稽定位规则（检测⊇取件不漂移）', () => {
  for (const c of ARCHIVE_PICKUP_CATEGORIES) {
    expect(Object.keys(HANDOVER_KEY_PATTERNS)).toContain(c);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**（patterns 现仅 4 类）。
- [ ] **Step 3: patterns 补齐**（`archive-scope.service.ts` 35 行处追加）：

```ts
bid_evaluation_sign_handover: (bpId) => ({ key: `bid-sign-handover/${bpId}.json` }),
sign_packet_signature_page: (bpId) => ({ key: { contains: bpId }, category: 'sign_packet_signature_page' }),
expert_sign_scan: (bpId) => ({ key: { contains: bpId }, category: 'expert_sign_scan' }),
opening_sign_page: (bpId) => ({ key: { contains: bpId }, category: 'opening_sign_page' }),
opening_sign_scan: (bpId) => ({ key: { contains: bpId }, category: 'opening_sign_scan' }),
```

同文件 snapshot 循环内 `take: 5` 的 fileAsset 查询改 `fetchAllPaged`（import 自 collector；同bp同category本就一两件，分页为防截断静默）。
`ai_bid_report` 不加（key 无项目 ID，走引用，勾稽无从定位——在 patterns 上方注释说明）。

- [ ] **Step 4: seed 对齐 + 存量行同步**（`archive-scope.seed.ts`）：

seed 数据改两行：

```ts
{ code: '4.1', ..., fileCategories: ['bid_opening_handover', 'opening_sign_page', 'opening_sign_scan'], ... },
{ code: '5.5', ..., fileCategories: ['bid_evaluation_handover', 'bid_evaluation_sign_handover', 'bid_sign_packet', 'sign_packet_signature_page', 'expert_sign_scan'], ... },
```

`ensureArchiveScopeSeeded` 末尾追加枚举式同步（upsert update:{} 不覆盖存量行，新类目必须显式补）：

```ts
/** 范围行 fileCategories 对齐（2026-09-22 P2-1）：枚举式同步这两个字段，不触碰其他列（保留人工调整余地） */
export const FILE_CATEGORY_SYNC: Record<string, string[]> = {
  '4.1': ['bid_opening_handover', 'opening_sign_page', 'opening_sign_scan'],
  '5.5': ['bid_evaluation_handover', 'bid_evaluation_sign_handover', 'bid_sign_packet', 'sign_packet_signature_page', 'expert_sign_scan'],
};
// ensureArchiveScopeSeeded 内、upsert 循环之后：
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
for (const [code, cats] of Object.entries(FILE_CATEGORY_SYNC)) {
  const row = await prisma.archiveScopeItem.findUnique({ where: { code } });
  if (row && !sameSet(row.fileCategories, cats)) {
    await prisma.archiveScopeItem.update({ where: { code }, data: { fileCategories: cats } });
  }
}
```

- [ ] **Step 5: 元数据.json 覆盖 fileAsset 件**（`archive-export.service.ts`）：
  - bp 循环里累积 `const evidenceAssetIds: string[] = [];`（assets 全量 push）。
  - 252 行元数据查询 where 改**条件拼装 OR 数组**（空集防御，沿用 attIds 的 ['none'] 哨兵手法）：

```ts
const metaWhere: Prisma.ArchiveMetadataWhereInput = {
  OR: [
    { attachmentId: { in: attIds.length > 0 ? attIds : ['none'] } },
    ...(evidenceAssetIds.length > 0 ? [{ fileAssetId: { in: evidenceAssetIds } }] : []),
  ],
};
```

  include 加 `fileAsset: { select: { originalName: true } }`（ArchiveMetadata.fileAsset 关系已核验存在，fileAssetId @unique）。
  - payload 的 fileName 取值改 `m.attachment?.fileName ?? m.fileAsset?.originalName ?? m.fileAssetId`。
  - 兜底建档循环（230-251 行）之后追加证据件兜底：对无 ArchiveMetadata 的证据件建行（`findUnique({ where: { fileAssetId } })` 先查——**fileAssetId 唯一约束，双写必撞**；`title: \`${item.title}·开评标接收件·${fa.originalName ?? fa.key}\`、`responsibles` 同现有、`sourceModule: 'export-fallback'`、`formedAt` 取 FileAsset.createdAt），`.catch(() => undefined)` 不阻断。

- [ ] **Step 6: 跑测试**：`pnpm --filter api test -- archive` → 全 PASS（含 asip 集成 spec——元数据 where 变更需 mock 相应 prisma 调用，若 spec 红，按其 mock 风格补 `archiveMetadata.findMany` 的返回）。
- [ ] **Step 7: Commit**

```bash
git add apps/api/src/archive/archive-scope.service.ts apps/api/src/archive/archive-scope.seed.ts apps/api/src/archive/archive-export.service.ts apps/api/src/archive/archive-pickup-categories.spec.ts
git commit -m "fix(archive): 勾稽范围对齐回流包等5类目+元数据覆盖证据件+分页防截断（P2-1/P2-5）"
```

---

### Task 5: 会场交流入开标文件包（P2-2，用户裁定公聊+私聊全量）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:1162-1295`（buildHandoverPackage）
- Test: `apps/api/src/bid/bid-handover.spec.ts`（追加用例）

**Interfaces:**
- Produces: 开标文件包 `packageVersion: 2`，新段 `hallMessages`（仅非空时输出）；段结构 `{ room, supplierName, senderName, senderRole, type, content, fileAssetId, createdAt }[]`。

- [ ] **Step 1: 追加失败测试**（bid-handover.spec.ts，按既有 completeOpening 的 prisma mock 排队手法；**对照实际代码核验**：该 spec 用集中式 mock 工厂（32 行区域 `fileAsset: { create, upsert }` 等），新增查询必须先在工厂补 `openingHallMessage: { findMany: jest.fn().mockResolvedValue([]) }`，否则存量用例全部 TypeError）：

```ts
it('会场交流（公聊+私聊）全量入开标文件包（P2-2）', async () => {
  // 工厂补 prisma.openingHallMessage.findMany 返回 2 条（PUBLIC 1 + PRIVATE 1 带 supplierId），
  // bidSupplier 行含对应 supplierId→supplierName 映射
  // 断言：包 JSON 含 hallMessages[2]，PRIVATE 条 supplierName 已解析为公司名，
  // packageVersion === 2，fingerprint 覆盖新段（重算 JSON.stringify(body) === fingerprint）
});
it('无会场消息时 hallMessages 不输出（保持包紧凑）', async () => {
  // openingHallMessage.findMany 返回 [] → 包无 hallMessages 键，version 仍为 2
});
```

（枚举已核验：`OpeningHallRoomType = PUBLIC | PRIVATE`、`OpeningHallMessageType = TEXT`、senderRole = HOST|SUPPLIER|SYSTEM——schema.prisma:168-182。）

- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现**（buildHandoverPackage）：
  - Promise.all 批次追加第 6 查询：`this.prisma.openingHallMessage.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' }, select: { roomType: true, supplierId: true, senderName: true, senderRole: true, type: true, content: true, fileAssetId: true, createdAt: true } })`（注意现批次含 roundMode 条件分支，解构同步扩一位；查询结果**防御性 `Array.isArray(x) ? x : []` 归一**——opening-amount-unit.util 同款，防 jest mock 缺省炸裂）。
  - `suppliers` 已含 `supplierId/supplierName` → `const supplierNameBySupplierId = new Map(suppliers.map(s => [s.supplierId, s.supplierName]));`
  - body 追加（放 `bidRounds` 之后）：

```ts
// P2-2（2026-09-22 用户裁定）：会场交流全量入包（公聊+私聊）——还原开标现场互动。
// senderName 为发送时快照；PRIVATE 的 supplierId 解析为公司名（存证不依赖日后改名）。
hallMessages: hallMessages.length > 0 ? hallMessages.map(m => ({
  room: m.roomType,
  supplierName: m.supplierId ? supplierNameBySupplierId.get(m.supplierId) ?? null : null,
  senderName: m.senderName, senderRole: m.senderRole, type: m.type, content: m.content,
  fileAssetId: m.fileAssetId, createdAt: m.createdAt.toISOString(),
})) : undefined,
```

  - `packageVersion: 1` → `2`，注释 `// 2026-09-22：+hallMessages（会场交流全量）`。
  - **幂等说明**：已移交项目走 completeOpening 短路不重算——存量包由 Task 6 脚本补齐，新项目直接产 v2。

- [ ] **Step 4: 跑测试**：`pnpm --filter api test -- bid-handover` → PASS。
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid-handover.spec.ts
git commit -m "feat(bid): 开标文件包v2纳入会场交流全量（公聊+私聊）——还原现场互动（P2-2）"
```

---

### Task 6: 存量开标文件包回填脚本（P1-2 + 存量 hallMessages）

**Files:**
- Create: `apps/api/scripts/backfill-opening-handover.ts`
- Test: `apps/api/scripts/backfill-opening-handover.spec.ts`

**Interfaces:**
- Produces（纯函数，spec 消费）：
  - `applyOpeningPackageBackfill(pkg: LegacyPkg, unitByBsId: Map<string, string | null>, hallMessages: HallMsgRow[], supplierNameBySupplierId: Map<string, string>): { pkg: LegacyPkg; plan: BackfillPlan }`
  - `BackfillPlan = { changed: boolean; fields: string[]; recordChanges: Array<{ supplierName: string; from: string; to: string }>; addedMessages: number }`
- CLI：`npx tsx scripts/backfill-opening-handover.ts`（dry-run 默认）`--execute` 真实执行；自载 `.env`；PrismaClient + minio Client 直连（沿 `clean-legacy-plaintext.ts` 先例，不 import Nest 模块）。

- [ ] **Step 1: 写失败测试**（spec 只测纯函数，沿 `migrate-ai-report-category.spec.ts` 风格）：

```ts
import { applyOpeningPackageBackfill, LegacyPkg, HallMsgRow } from './backfill-opening-handover';

const basePkg: LegacyPkg = {
  packageType: 'BID_OPENING_HANDOVER', packageVersion: 1,
  openingRecords: [
    { supplierName: '甲', bidSupplierId: 'bs1', amount: '152.9', amountUnit: null },
    { supplierName: '乙', bidSupplierId: 'bs2', amount: '88 万元', amountUnit: '万元' }, // 已带单位，跳过
    { supplierName: '丙', bidSupplierId: 'bs3', amount: '壹佰万元整', amountUnit: null }, // 非裸数字（旧轨文本），跳过
  ],
  fingerprint: 'old',
};

it('dual-v2 裸数字补单位戳并渲染「N 万元」', () => {
  const { pkg, plan } = applyOpeningPackageBackfill(basePkg, new Map([['bs1', '万元'], ['bs2', '万元'], ['bs3', null]]), [], new Map());
  expect(pkg.openingRecords[0]).toMatchObject({ amount: '152.9 万元', amountUnit: '万元' });
  expect(pkg.openingRecords[1].amount).toBe('88 万元');   // 不动
  expect(pkg.openingRecords[2].amount).toBe('壹佰万元整'); // 不动
  expect(plan.fields).toContain('amountUnit');
  expect(plan.recordChanges).toEqual([{ supplierName: '甲', from: '152.9', to: '152.9 万元' }]);
});

it('hallMessages 注入升 v2 并解析私聊公司名；fingerprint 重算自洽', () => {
  const msgs: HallMsgRow[] = [{ roomType: 'PRIVATE', supplierId: 'sup1', senderName: '陈源远', senderRole: 'HOST', type: 'TEXT', content: '请确认', fileAssetId: null, createdAt: new Date('2026-09-10T06:00:00Z') }];
  const { pkg, plan } = applyOpeningPackageBackfill(basePkg, new Map([['bs1', '万元']]), msgs, new Map([['sup1', '成都华建']]));
  expect(pkg.packageVersion).toBe(2);
  expect(pkg.hallMessages[0]).toMatchObject({ room: 'PRIVATE', supplierName: '成都华建', content: '请确认' });
  expect(pkg.legacyBackfill.fields.sort()).toEqual(['amountUnit', 'hallMessages']);
  // fingerprint 自洽：去掉 fingerprint 后重算 sha256(JSON.stringify(body)) 应相等（spec 内用 node:crypto 复算）
});

it('无变化时 changed=false 且原包原样返回（幂等）', () => {
  const { pkg, plan } = applyOpeningPackageBackfill(basePkg, new Map(), [], new Map());
  expect(plan.changed).toBe(false);
  expect(pkg).toEqual(basePkg);
});
```

- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现脚本**（骨架，纯函数完整实现 + main）：

```ts
// apps/api/scripts/backfill-opening-handover.ts
// 背景/用法注释沿 migrate-ai-report-category.ts 格式（dry-run 默认、--execute、.env 自载、幂等）
// 规则（与 buildHandoverPackage 现行口径一致）：
//  - 单位：record.amountUnit == null && 单位解析为'万元' && BARE_NUM_RE 匹配 amount
//    （BARE_NUM_RE 逐字复制自 opening-amount-unit.util.ts：/^[\d,]+(?:\.\d+)?$/——勿自造变体）
//    → amountUnit='万元'、amount=`${amount} 万元`
//  - 单位解析在 main 内联实现（BidOpeningRecord.amountUnit 戳优先 → SupplierBidSubmission.envelopeVersion==='dual-v2' 回退），
//    不 import src 的 resolveOpeningAmountUnitMap（保持脚本零 Nest 依赖，clean-legacy 先例）；两处口径以 util 注释互指
//  - hallMessages：包无该段且 DB 有消息 → 注入段 + packageVersion→2 + legacyBackfill 标记
//  - fingerprint：sha256(JSON.stringify(body 无 fingerprint 键))；上传 JSON.stringify(pkg, null, 2)
//  - FileAsset.update({ size, sha256: hash(buffer) })——与 completeOpening 同口径（buffer 哈希≠body 指纹）
// main：遍历 FileAsset key='bid-opening-handover/{bpId}.json' → download → resolveUnits →
//       fetch messages/suppliers map → applyOpeningPackageBackfill → dry-run 打印变更清单 / --execute 上传+落库
```

- [ ] **Step 4: 跑测试**：`pnpm --filter api test -- backfill-opening` → PASS。
- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/backfill-opening-handover.ts apps/api/scripts/backfill-opening-handover.spec.ts
git commit -m "chore(scripts): 存量开标文件包回填——dual-v2金额补单位+会场交流注入（P1-2）"
```

---

### Task 7: 全量回归 + 构建 + 启动冒烟

**Files:** 无新增（验证任务）。

- [ ] **Step 1: 全量单测**：`pnpm --filter api test` → 全绿（关注 bid-handover / archive-* / upload / bid-archive.digest）。
- [ ] **Step 2: 构建**：`pnpm --filter api build` → 0 error（memory：单测绿≠能编译启动）。
- [ ] **Step 3: 启动冒烟**：`cd apps/api && PORT=4099 node dist/main.js &` → `curl -s -o /dev/null -w '%{http_code}' http://localhost:4099/api/docs` 期望 200 → kill。观察启动日志无 DI/导入错误。
- [ ] **Step 4: 若红**：按 systematic-debugging 修（不在本计划展开）；若绿则不提交（无文件变更）。

---

### Task 8: 线上执行回填 + 实物复验（P1-2 验收）

- [ ] **Step 1: dry-run**：`cd apps/api && npx tsx scripts/backfill-opening-handover.ts` → 期望列出 JJ-2026091003 **仅 3 条金额补单位**——已核验该项目 `OpeningHallMessage` 为 **0 条**（演示从未在大厅发言），hallMessages 注入在本库无实例、其正确性由 Task 6 单测锁定；其余 DOWNLOAD 项目无包自然跳过。
- [ ] **Step 2: execute**：`npx tsx scripts/backfill-opening-handover.ts --execute` → 打印上传+落库结果。
- [ ] **Step 3: 实物复验**（MinIO）：

```bash
CID=$(docker ps -q -f name=minio | head -1)
docker exec "$CID" mc cat local/water-erp/bid-opening-handover/cmtveupp60016uu59lg543sme.json > /tmp/after.json
python3 - <<'EOF'
import json, hashlib
d = json.load(open('/tmp/after.json'))
assert all(r.get('amountUnit') == '万元' for r in d['openingRecords']), '单位未补齐'
assert d.get('legacyBackfill', {}).get('fields') == ['amountUnit'], '回填标记不符（JJ 会场消息 0 条，只应有 amountUnit）'
body = {k: v for k, v in d.items() if k != 'fingerprint'}
assert hashlib.sha256(json.dumps(body).encode()).hexdigest() == d['fingerprint'], '指纹不自洽'
print('OK: 单位/回填标记/指纹全部自洽')
EOF
```

- [ ] **Step 4: DB 指纹一致性**：`psql` 查该 FileAsset 的 sha256 == sha256(/tmp/after.json 字节)。
- [ ] **Step 5: 二次 dry-run 验幂等**：输出 changed=0。

---

### Task 9: 演示端到端重走（P3 + 回流包 v2 目检）

> 目标：走通 签字闭环 → 回流包 → :3005 接收/检测/导出，并完成 memory 中的演示前待办（回流包 v2 aiAnalysis/scoreItemDefinitions 段目检 + ASIP 卷 opening_sign_page/ai_bid_report 类目目检）。**不点「完整归档」**（会把演示项目翻 ARCHIVED，保留演示态；闸门逻辑已有单测覆盖）。

- [ ] **Step 1: 启动依赖**：确认 postgres/redis/minio 起（`pnpm infra:up`）；`pnpm dev:api` + `pnpm dev:bid` + `pnpm dev:web`（或 `pnpm dev` 全量，注意先清 stale 端口——memory `stale-dev-servers-eaddrinuse`）。
- [ ] **Step 2: :3007 重走签字闭环**（chrome-devtools MCP）：`:3006` 登录 `陈源远/陈源远@2026`（admin tab 分流写 token_bid）→ 跳 :3007 `/bid` → JJ-2026091003 工作区 → 评标签字 tab → 生成签字包（canGenerate：EVALUATING+已有结果 ✓）→ 逐正选专家登记（已签字/视为同意；扫描件可不复传——09-21 的旧扫描 FileAsset 仍在卷内）→ 全员闭环自动 closedAt → 生成评标回流包。
- [ ] **Step 3: :3005 接收验证**：登录 `Swhi-CGZX-01` → 项目详情开标确认面板 → 「评标资料接收」横幅出现 + 下载回流包。
- [ ] **Step 4: 四性检测**：归档管理页找到 JJ 对应 PMI（**已核验存在**：`cmtvdx881002xuu2ceb27yesk`，`/archive` 台账按项目名「引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务」检索）→ 运行检测 → **结果应含回流件/评标回流包、签字扫描、开标签字扫描等新类目明细且 PASS**（Task 2 验收点）。
- [ ] **Step 5: ASIP 导出 + 卷内目检**：若范围必选项有缺（如招标文件附件缺失阻断），通过 UI 在对应阶段补传最小附件后重试 → 导出 → 下载 ZIP 解包检查：`09_开评标接收件/` 含 `bid_evaluation_sign_handover/`、`expert_sign_scan/`、`opening_sign_scan/`、`bid_sign_packet/` 各件；`其他/元数据.json` 含证据件行（Task 4 验收点）；`固化验证信息.txt` 逐文件指纹齐全。
- [ ] **Step 6: 回流包 v2 内容目检**：下载回流包 JSON 检查 `aiAnalysis`（provenance/每家结论/report docx 引用）、`scoreItemDefinitions`、`expertSignStatuses` 身份核验域、`hallMessages` 不在此包（在开标文件包，Task 8 已验）。
- [ ] **Step 7: 截图存档**（可选）+ 发现任何断链如实记录（不粉饰）。

---

### Task 10: 报告与记忆收尾

- [ ] **Step 1: 更新审查报告** `water-erp/docs/开评标归档链路完备性审查-归档包回流包-2026-09-22.md`：文末追加「整改记录（2026-09-22）」小节——逐条标注 P1-1/P1-2/P2-1/P2-2/P2-5 已修（附 commit hash）、P2-3 另开任务、P2-4 数据面说明、P3 已重走。
- [ ] **Step 2: 更新记忆** `~/.claude/projects/-home-asus----ERP/memory/archive-chain-audit-2026-09-22.md`：从「待修」改为「已修」状态 + 关键坑（收集器是单一取件源，改归档取件必走它；回填脚本已执行过一次）。
- [ ] **Step 3: 汇总提交**：

```bash
git add docs/开评标归档链路完备性审查-归档包回流包-2026-09-22.md
git commit -m "docs(audit): 归档链路审查整改记录——P1/P2 五项闭环"
```

- [ ] **Step 4: 报告未推送提交数**（不主动 push）。

---

## Verification（整体验收标准）

1. `pnpm --filter api test` 全绿；`pnpm --filter api build` 0 error；boot smoke 200。
2. 演示项目开标文件包：三家金额 `N 万元` + `amountUnit:'万元'` + `hallMessages` 段 + 指纹自洽 + DB sha256 一致 + 脚本二次 dry-run 零变更。
3. 四性检测结果含回流包/签字扫描/开标签字页明细且 PASS；人为改一个对象字节后重跑应 FAIL（可选加测）。
4. ASIP 卷 `09_开评标接收件/` 含 5 类证据件、`元数据.json` 覆盖证据件、`固化验证信息.txt` 指纹数=卷内文件数。
5. 回流包 v2 段目检通过；:3005 横幅/下载/检测/导出全链路浏览器实测通过。

## Self-Review 记录

- 报告第五节逐条覆盖：P1-1→Task 1/2/3；P1-2→Task 6/8；P2-1→Task 4；P2-2→Task 5/6；P2-5→Task 1/2/4；P2-3 用户裁定另开（计划开头声明）；P2-4 非代码（Task 10 记录）；P3→Task 9。✓
- **对照实际代码核验（用户要求，2026-09-22 完成）**：
  - `archive-export-guards.spec.ts` import `fetchAllPaged` 自 export service → re-export 方案保持兼容 ✓
  - `ArchiveMetadata.fileAsset` 关系 + `fileAssetId @unique` 存在 → 元数据 include/兜底建档可行，须先查后建 ✓
  - `resolveOpeningAmountUnitMap` 全文与 `BARE_NUM_RE=/^[\d,]+(?:\.\d+)?$/` 已核对 → 脚本逐字复制该正则 ✓
  - `main.ts:108` `process.env.PORT || PORTS.api` → `PORT=4099 node dist/main.js` 冒烟可行 ✓
  - `OpeningHallRoomType=PUBLIC|PRIVATE` 等枚举 ✓；`bid-handover.spec.ts` 集中式 mock 工厂 → 新增查询须补 `openingHallMessage` delegate ✓
  - JJ 项目 PMI 存在（cmtvdx881002xuu2ceb27yesk）✓；**JJ 的 OpeningHallMessage=0 条** → 回填只补单位、hallMessages 靠单测锁定（Task 8 预期已如实改写）✓
- 类型一致性：`collectBidEvidenceAssets`/`CollectedEvidence`/`extractEvidenceRefIds` 在 Task 1/2/3 签名一致；`applyOpeningPackageBackfill` 的 LegacyPkg/HallMsgRow 在 Task 6 spec 与实现一致。✓
- 无占位符：所有代码步骤给了实际代码或精确到行的改造说明；Task 9 浏览器步骤为操作序列（无可写代码）。✓
