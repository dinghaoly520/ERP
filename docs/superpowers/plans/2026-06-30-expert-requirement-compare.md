# 专家条款响应对比视图（可标注·中联动）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在专家辅助评标页新增「条款响应对比」视图——以招标文件提取的实质性条款为骨架，逐条关联 AI 定位的投标响应（原文摘录+页码），专家可标注认可/异议/存疑，异议联动到专家评审报告与打分页提示。

**Architecture:** 复用现有 ai-bid-analysis OCR/LLM 管线。新增 requirement-response matcher（bidder.processor 加步），产出逐条响应定位存 `AiBidderResult.requirementResponses`；新增 `BidRequirementReview` 表存专家标注（per-expert）；扩展 expert 端点返回对比数据 + 标注 CRUD + 打分页 category 级联动；前端在 AssistPanel 加对比分区、打分页加异议高亮。

**Tech Stack:** NestJS 11 + Prisma + BullMQ + DeepSeek LLM；Next.js 16 + React 19 + Tailwind v4；shared 类型 `@water-erp/shared`。

## Global Constraints

- **requirementId 必须稳定**：基于 `category|content` 规范化（去 ★号/空白/标点/小写）的 sha256 前 10 位；matcher 与标注均引用此 id（堵重跑失联）。
- **评标独立性（合规红线）**：标注仅本人可见；系统不改分、不阻断报告确认；异议仅做报告披露 + 打分页 category 级高亮强制二次确认。
- **联动粒度 category 级**：招标条款与评分项非一一对应，异议映射到 category（该 category 下任一条款被标异议 → 该类评分项提示）。
- **报告时序修正（对 spec 的修正）**：专家异议入**专家评审报告**（`getReport`/`EvaluationReport`），**不**入 AI docx 报告（后者在 AI 分析完成时生成，早于专家评审）。
- **fileId 修正**：matcher 的 `location.fileId` 来自投标文件 `FileAsset.id`；`plaintextFetcher` 须扩展返回 fileId。
- TDD：每个后端 task 先写失败测试。前端无单测设施，靠 `tsc --noEmit` + 浏览器手验。
- 改 `packages/shared` 后必须 `pnpm --filter @water-erp/shared build`。
- migration 非交互：`prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`（或设 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`）。

## File Structure

**新建：**
- `apps/api/src/ai-bid-analysis/utils/requirement-id.ts` — 稳定 id 派生 + `stabilizeRequirements`
- `apps/api/src/ai-bid-analysis/utils/requirement-id.spec.ts`
- `apps/api/src/ai-bid-analysis/prompts/requirement-matching.prompt.ts` — matcher prompt
- `apps/api/src/ai-bid-analysis/services/requirement-matcher.service.ts` — 条款-响应定位器
- `apps/api/src/ai-bid-analysis/services/requirement-matcher.service.spec.ts`
- `apps/api/src/expert/dto/upsert-requirement-review.dto.ts`
- `apps/expert-portal/src/components/evaluate/assist/requirement-compare-panel.tsx`
- `apps/api/prisma/migrations/<ts>_requirement_compare/` — migration.sql

**修改：**
- `apps/api/prisma/schema.prisma` — `AiBidderResult.requirementResponses` + 新 `BidRequirementReview` model
- `apps/api/src/ai-bid-analysis/services/tender-extractor.service.ts` — 落库前 stabilize
- `apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts` — 返回 fileId
- `apps/api/src/ai-bid-analysis/queues/bidder.processor.ts` — 集成 matcher
- `apps/api/src/ai-bid-analysis/queues/bidder.processor.spec.ts` — matcher 步测试
- `apps/api/src/expert/expert.service.ts` — getAssistData/getMyScores/getReport 扩展 + 标注 CRUD
- `apps/api/src/expert/expert.service.spec.ts`
- `apps/api/src/expert/expert.controller.ts` — 标注端点
- `packages/shared/src/types.ts` — AssistData 增字段 + RequirementResponse/BidRequirementReview
- `apps/expert-portal/src/components/evaluate/assist/assist-panel.tsx` — 插入对比分区 + 重编号
- `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx` — upsert review 调用 + 打分页联动

---

## Phase 1 — requirementId 稳定化

### Task 1: 稳定 id 工具 `requirement-id.ts`

**Files:**
- Create: `apps/api/src/ai-bid-analysis/utils/requirement-id.ts`
- Test: `apps/api/src/ai-bid-analysis/utils/requirement-id.spec.ts`

**Interfaces:**
- Produces: `stableReqId(category: string, content: string): string`；`stabilizeRequirements(req: TenderRequirements): TenderRequirements`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/src/ai-bid-analysis/utils/requirement-id.spec.ts
import { stableReqId, stabilizeRequirements } from './requirement-id';
import type { TenderRequirements } from '../types';

describe('requirement-id', () => {
  it('同 category+content 产出相同 id', () => {
    expect(stableReqId('technical', '工期不超过365日历天'))
      .toBe(stableReqId('technical', '工期不超过365日历天'));
  });

  it('★号/空白/标点差异不影响 id', () => {
    expect(stableReqId('technical', '★ 工期不超过 365 日历天。'))
      .toBe(stableReqId('technical', '工期不超过365日历天'));
  });

  it('不同 content 产出不同 id', () => {
    expect(stableReqId('technical', '工期不超过365日历天'))
      .not.toBe(stableReqId('technical', '资质等级甲级'));
  });

  it('不同 category 同 content 产出不同 id', () => {
    expect(stableReqId('technical', '某要求'))
      .not.toBe(stableReqId('commercial', '某要求'));
  });

  it('stabilizeRequirements 覆盖三类 requirement 的 id', () => {
    const req: TenderRequirements = {
      projectName: 'p', projectType: 't',
      qualificationRequirements: [{ id: 'q1', category: '资质', content: '甲级资质', isRequired: true, evidenceType: '证书' }],
      technicalRequirements: [{ id: 't1', category: '技术', content: '工期365天', isStarred: true, weight: 10 }],
      commercialRequirements: [{ id: 'c1', category: '商务', content: '质保2年', isRequired: true }],
      priceEvaluationMethod: '基准价法',
      scoringRules: { technicalMax: 0, commercialMax: 0, priceMax: 0, technicalWeights: {}, commercialWeights: {}, priceMethod: '', notes: '' },
    };
    const out = stabilizeRequirements(req);
    expect(out.technicalRequirements![0].id).toBe(stableReqId('technical', '工期365天'));
    expect(out.qualificationRequirements![0].id).toBe(stableReqId('qualification', '甲级资质'));
    expect(out.commercialRequirements![0].id).toBe(stableReqId('commercial', '质保2年'));
    // 其余字段原样保留
    expect(out.technicalRequirements![0].isStarred).toBe(true);
    expect(out.projectName).toBe('p');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- requirement-id`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/ai-bid-analysis/utils/requirement-id.ts
import { createHash } from 'crypto';
import type { TenderRequirements } from '../types';

/** 规范化：去 ★号/空白/标点/小写 → sha256 前 10 位 */
export function stableReqId(category: string, content: string): string {
  const norm = `${category}|${content ?? ''}`.replace(/[★\s\p{P}]/gu, '').toLowerCase();
  return createHash('sha256').update(norm).digest('hex').slice(0, 10);
}

/** 覆盖 requirements 三类条目的 id 为稳定派生值（保留其余字段） */
export function stabilizeRequirements(req: TenderRequirements): TenderRequirements {
  const map = <T extends { content: string }>(arr: T[] | undefined, category: string): T[] | undefined =>
    arr?.map((r) => ({ ...r, id: stableReqId(category, r.content) } as T));
  return {
    ...req,
    qualificationRequirements: map(req.qualificationRequirements, 'qualification'),
    technicalRequirements: map(req.technicalRequirements, 'technical'),
    commercialRequirements: map(req.commercialRequirements, 'commercial'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- requirement-id`
Expected: PASS（5 passed）

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/ai-bid-analysis/utils/requirement-id.ts apps/api/src/ai-bid-analysis/utils/requirement-id.spec.ts
git -C /home/asus/桌面/ERP commit -m "feat(ai-bid): 稳定 requirementId 工具（content-hash）"
```

### Task 2: tenderExtractor 落库前 stabilize

**Files:**
- Modify: `apps/api/src/ai-bid-analysis/services/tender-extractor.service.ts`
- Test: `apps/api/src/ai-bid-analysis/services/tender-extractor.service.spec.ts`（新建或追加）

**Interfaces:**
- Consumes: `stabilizeRequirements` from Task 1
- Produces: `extract()` 返回的 `TenderRequirements` 三类条目 id 为稳定值

- [ ] **Step 1: Write failing test**

```ts
// tender-extractor.service.spec.ts（追加；若无则新建 describe）
import { TenderExtractorService } from './tender-extractor.service';
import { stableReqId } from '../utils/requirement-id';

describe('TenderExtractorService', () => {
  it('extract 返回的 requirement id 经稳定化（非 LLM 原始 q1/t1）', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({
      projectName: 'p', projectType: 't',
      technicalRequirements: [{ id: 't1', category: '技术', content: '工期365天', isStarred: true, weight: 10 }],
      qualificationRequirements: [], commercialRequirements: [],
      priceEvaluationMethod: 'x',
      scoringRules: { technicalMax:0, commercialMax:0, priceMax:0, technicalWeights:{}, commercialWeights:{}, priceMethod:'', notes:'' },
    }) } as any;
    const svc = new TenderExtractorService(llm);
    const out = await svc.extract('tender text', 'task-1');
    expect(out.technicalRequirements![0].id).toBe(stableReqId('technical', '工期365天'));
    expect(out.technicalRequirements![0].id).not.toBe('t1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- tender-extractor`
Expected: FAIL（id 仍是 't1'）

- [ ] **Step 3: Write minimal implementation**

```ts
// tender-extractor.service.ts —— extract() 末尾 return 前加：
import { stabilizeRequirements } from '../utils/requirement-id';
// ... existing extract body ...
    return stabilizeRequirements(result);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- tender-extractor`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP commit -am "feat(ai-bid): tenderExtractor 落库前稳定化 requirement id"
```

---

## Phase 2 — 数据模型

### Task 3: Prisma migration（requirementResponses + BidRequirementReview）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_requirement_compare/migration.sql`

**Interfaces:**
- Produces: `AiBidderResult.requirementResponses Json?`；新 model `BidRequirementReview`

- [ ] **Step 1: 编辑 schema**

在 `model AiBidderResult` 增字段（紧邻 `scoreItems`）：
```prisma
  requirementResponses Json?  // 条款-响应定位（matcher 产物）
```

在 schema 末尾新增 model：
```prisma
model BidRequirementReview {
  id             String   @id @default(cuid())
  projectId      String
  bidderResultId String
  expertId       String
  requirementId  String
  category       String
  verdict        String   // ack | dispute | doubt
  note           String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([projectId, bidderResultId, expertId, requirementId])
  @@map("bid_requirement_reviews")
}
```

- [ ] **Step 2: 生成 migration（非交互）**

Run:
```bash
cd apps/api && PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 npx prisma migrate dev --create-only --name requirement_compare
```
Expected: 生成 `migrations/<ts>_requirement_compare/migration.sql`，含 `ALTER TABLE "ai_bidder_results" ADD COLUMN "requirementResponses" JSONB;` + `CREATE TABLE "bid_requirement_reviews"...`

- [ ] **Step 3: 应用 migration + 生成 client**

Run:
```bash
cd apps/api && npx prisma migrate dev
pnpm db:generate
```
Expected: migration applied，`@prisma/client` 含新字段/model。

- [ ] **Step 4: 验证 client 类型**

Run: `pnpm --filter api build`
Expected: 编译通过（新 model 类型可用）

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git -C /home/asus/桌面/ERP commit -m "feat(db): AiBidderResult.requirementResponses + BidRequirementReview"
```

---

## Phase 3 — matcher（条款-响应定位）

### Task 4: plaintextFetcher 返回 fileId

**Files:**
- Modify: `apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts`
- Test: `apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.spec.ts`

**Interfaces:**
- Produces: `fetchBidderPlaintext(bidSupplierId, which)` 返回 `{ buffer: Buffer; fileId: string } | null`（原返回 Buffer）

- [ ] **Step 1: Write failing test**

```ts
// plaintext-fetcher.service.spec.ts（追加；复用现有 mock 框架）
it('fetchBidderPlaintext 返回 { buffer, fileId }', async () => {
  // 复用现有 spec 的 prisma/minio mock 设置（assetId='fa-tech'）
  const out = await service.fetchBidderPlaintext('bs-1', 'technical');
  expect(out).not.toBeNull();
  expect(out!.fileId).toBe('fa-tech');
  expect(Buffer.isBuffer(out!.buffer)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- plaintext-fetcher`
Expected: FAIL（`out.fileId` undefined）

- [ ] **Step 3: Write minimal implementation**

修改 `fetchBidderPlaintext` 返回值（`assetId` 已在 line 45 计算、`asset.id` 即它）：
```ts
// 原：return buffer;
// 改：
return { buffer, fileId: assetId };
// 各处提前 return（如校验失败 return null）保持 null
```
同步返回类型签名：`Promise<{ buffer: Buffer; fileId: string } | null>`。

- [ ] **Step 4: 更新调用方 bidder.processor（biz 分支也改全，勿省略）**

> 前置确认（#8）：`plaintextFetcher` 投标方法确切名（完整 Read 为 `fetchBidderPlaintext`，以完整 Read 为准）；grep 全仓确认无其他调用方（应仅 bidder.processor）。

bidder.processor 顶部先声明外层变量（Task 7 matcher 要用 fileId + bizOcr.pages）：
```ts
let bizOcr: any = null;
let techFileId: string | null = null;
let bizFileId: string | null = null;
```
tech 分支（原 line 76-80）改为解构：
```ts
const tech = await this.plaintextFetcher.fetchBidderPlaintext(bidSupplierId, 'technical');
const techBuffer = tech?.buffer ?? Buffer.from('');
techFileId = tech?.fileId ?? null;
const techOcr = await processFile(this.ocrService, techBuffer, 'technical.pdf');
```
biz 分支（原 line 84-89 try 内）同样解构（**不要省略**）：
```ts
const biz = await this.plaintextFetcher.fetchBidderPlaintext(bidSupplierId, 'business');
const bizBuffer = biz?.buffer ?? Buffer.from('');
bizFileId = biz?.fileId ?? null;
bizOcr = await processFile(this.ocrService, bizBuffer, 'business.pdf');
businessText = bizOcr.text;
```
跑 `pnpm --filter api build` 确认编译。

- [ ] **Step 4b: 同步更新现有 plaintext-fetcher.service.spec.ts（#2）**

返回类型从 `Buffer` 改为 `{ buffer, fileId }`，现有断言会失败。把原 `expect(Buffer.isBuffer(result)).toBe(true)` 等改为 `expect(Buffer.isBuffer(result.buffer)).toBe(true)`；涉及 fileId 的用例补 `expect(result.fileId).toBe(...)`。跑 `pnpm --filter api test -- plaintext-fetcher` 全绿。

- [ ] **Step 5: Run tests + commit**

Run: `pnpm --filter api test -- plaintext-fetcher && pnpm --filter api build`
Expected: PASS + 编译通过

```bash
git -C /home/asus/桌面/ERP commit -am "refactor(ai-bid): fetchBidderPlaintext 返回 fileId 供 matcher 跳转定位"
```

### Task 5: requirement-matching prompt

**Files:**
- Create: `apps/api/src/ai-bid-analysis/prompts/requirement-matching.prompt.ts`

**Interfaces:**
- Produces: `REQUIREMENT_MATCHING_PROMPT`（含 `{{REQUIREMENTS}}` `{{PAGES}}` 占位）

- [ ] **Step 1: 编写 prompt**

```ts
// requirement-matching.prompt.ts
export const REQUIREMENT_MATCHING_PROMPT = `你是招投标响应核查专家。下面给出【招标要求条目】（每条带 seq 序号）与【投标文件分页文本】。
对每条招标要求，在投标文件中定位其响应内容，判定响应状态并摘录证据。

## 招标要求条目（JSON，含 seq 序号）
{{REQUIREMENTS}}

## 投标文件分页文本（每页含 file 标识与 page 页码）
{{PAGES}}

## 任务
逐条输出 responses 数组，每项：
- seq：对应招标要求条目的 seq（原样回填小整数，勿臆造或改写）
- status：met（满足）/ partial（部分满足）/ unmet（不满足）/ not_found（投标文件未提及）
- excerpt：投标文件中支撑判定的原文摘录（≤120 字，not_found 时为空串）
- file：摘录所在文件标识（technical/business，not_found 时为 null）
- page：摘录所在页码（数字，not_found 时为 null）
- confidence：0-1

## 规则
1. 仅依据投标文件文本判定，不得臆造。
2. excerpt 必须是投标文件原文片段，不可改写。
3. ★号实质性条款若未明确响应，判 unmet 或 not_found，不得默认 met。
4. seq 必须原样回填输入条目的序号（小整数）。
5. 输出严格 JSON：{ "responses": [ { seq, status, excerpt, file, page, confidence } ] }`;
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter api build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/ai-bid-analysis/prompts/requirement-matching.prompt.ts
git -C /home/asus/桌面/ERP commit -m "feat(ai-bid): 条款-响应匹配 prompt"
```

### Task 6: RequirementMatcherService

**Files:**
- Create: `apps/api/src/ai-bid-analysis/services/requirement-matcher.service.ts`
- Test: `apps/api/src/ai-bid-analysis/services/requirement-matcher.service.spec.ts`

**Interfaces:**
- Consumes: `TenderRequirements`（已稳定 id）、分页文本 `Array<{ file: string; page: number; text: string }>`、`LlmService.chatJson`
- Produces: `RequirementResponse[]`（requirementId/category/tenderContent/isStarred/status/excerpt/location{fileId,page}/confidence）

- [ ] **Step 1: Write failing test**

```ts
// requirement-matcher.service.spec.ts
import { RequirementMatcherService } from './requirement-matcher.service';
import type { TenderRequirements } from '../types';

describe('RequirementMatcherService', () => {
  const req: TenderRequirements = {
    projectName: 'p', projectType: 't',
    technicalRequirements: [
      { id: 'STABLE_T1', category: '技术', content: '工期不超过365日历天', isStarred: true, weight: 10 },
    ],
    qualificationRequirements: [], commercialRequirements: [],
    priceEvaluationMethod: 'x',
    scoringRules: { technicalMax:0, commercialMax:0, priceMax:0, technicalWeights:{}, commercialWeights:{}, priceMethod:'', notes:'' },
  };
  const pages = [
    { file: 'technical', page: 1, text: '我司承诺工期 360 日历天完成全部施工。' },
  ];

  it('LLM 回填 seq，matcher 映射回 stableId（prompt 不含 hash id）', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: 1, status: 'met', excerpt: '承诺工期 360 日历天', file: 'technical', page: 1, confidence: 0.9 },
    ] }) } as any;
    const svc = new RequirementMatcherService(llm);
    const out = await svc.match(req, pages, { technical: 'fa-tech', business: 'fa-biz' }, 'task-1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      requirementId: 'STABLE_T1', status: 'met',   // seq=1 → stableId
      tenderContent: '工期不超过365日历天', isStarred: true,
      excerpt: '承诺工期 360 日历天',
      location: { fileId: 'fa-tech', page: 1 }, confidence: 0.9,
    });
    const calledPrompt = llm.chatJson.mock.calls[0][1] as string;
    expect(calledPrompt).not.toContain('STABLE_T1');   // hash id 不进 prompt
    expect(calledPrompt).toContain('"seq": 1');
  });

  it('not_found 时 location 为 null', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: 1, status: 'not_found', excerpt: '', file: null, page: null, confidence: 0.3 },
    ] }) } as any;
    const out = await svcMatch(llm);
    expect(out[0].location).toBeNull();
  });

  it('缺页号/文件时 location 降级 null', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: 1, status: 'partial', excerpt: 'x', file: 'business', page: null, confidence: 0.5 },
    ] }) } as any;
    const out = await svcMatch(llm);
    expect(out[0].location).toBeNull(); // page 缺
  });

  it('LLM 回填未知 seq（越界）→ 该条丢弃不崩', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: 99, status: 'met', excerpt: 'x', file: 'technical', page: 1, confidence: 0.9 },
    ] }) } as any;
    const out = await svcMatch(llm);
    expect(out).toHaveLength(0);
  });

  async function svcMatch(llm: any) {
    return new RequirementMatcherService(llm).match(req, pages, { technical: 'fa-tech', business: 'fa-biz' }, 'task-1');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- requirement-matcher`
Expected: FAIL（service 不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// requirement-matcher.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../local-ai/llm.service';
import { REQUIREMENT_MATCHING_PROMPT } from '../prompts/requirement-matching.prompt';
import { deterministicSeed } from '../utils';
import type { TenderRequirements } from '../types';

export interface RequirementResponse {
  requirementId: string;
  category: 'qualification' | 'technical' | 'commercial';
  tenderContent: string;
  isStarred: boolean;
  status: 'met' | 'partial' | 'unmet' | 'not_found';
  excerpt: string;
  location: { fileId: string; page: number } | null;
  confidence: number;
}

interface PageInput { file: string; page: number; text: string }
interface FileIdMap { technical: string | null; business: string | null }

@Injectable()
export class RequirementMatcherService {
  private readonly logger = new Logger(RequirementMatcherService.name);
  constructor(private llmService: LlmService) {}

  async match(req: TenderRequirements, pages: PageInput[], fileIds: FileIdMap, taskId?: string): Promise<RequirementResponse[]> {
    const flat = this.flattenRequirements(req); // [{ seq, requirementId(stable), category, tenderContent, isStarred }]
    if (flat.length === 0 || pages.length === 0) return [];

    // prompt 只给 seq+content+isStarred（不暴露 hash id；LLM 回填小整数 seq 比 hash 可靠）
    const prompt = REQUIREMENT_MATCHING_PROMPT
      .replace('{{REQUIREMENTS}}', JSON.stringify(flat.map((f) => ({ seq: f.seq, content: f.tenderContent, isStarred: f.isStarred }))))
      .replace('{{PAGES}}', JSON.stringify(pages));

    const result = await this.llmService.chatJson<{ responses: Array<{ seq: number; status: any; excerpt: string; file: string | null; page: number | null; confidence: number }> }>(
      '你是招投标响应核查专家。',
      prompt, 0, undefined,
      taskId ? deterministicSeed(taskId + ':req-match') : undefined,
    );

    const bySeq = new Map(flat.map((f) => [f.seq, f]));
    return (result.responses ?? [])
      .map((r) => {
        const meta = bySeq.get(r.seq);
        if (!meta) return null; // LLM 回填未知 seq → 丢弃
        const fileId = r.file ? (r.file === 'technical' ? fileIds.technical : r.file === 'business' ? fileIds.business : null) : null;
        const location = fileId && typeof r.page === 'number' ? { fileId, page: r.page } : null;
        return {
          requirementId: meta.requirementId,
          category: meta.category,
          tenderContent: meta.tenderContent,
          isStarred: meta.isStarred,
          status: r.status,
          excerpt: r.excerpt ?? '',
          location,
          confidence: r.confidence ?? 0,
        };
      })
      .filter((x): x is RequirementResponse => x !== null);
  }

  private flattenRequirements(req: TenderRequirements): Array<{ seq: number; requirementId: string; category: any; tenderContent: string; isStarred: boolean }> {
    let seq = 0;
    const take = () => ++seq;
    return [
      ...(req.qualificationRequirements ?? []).map((r) => ({ seq: take(), requirementId: r.id, category: 'qualification' as const, tenderContent: r.content, isStarred: false })),
      ...(req.technicalRequirements ?? []).map((r) => ({ seq: take(), requirementId: r.id, category: 'technical' as const, tenderContent: r.content, isStarred: !!r.isStarred })),
      ...(req.commercialRequirements ?? []).map((r) => ({ seq: take(), requirementId: r.id, category: 'commercial' as const, tenderContent: r.content, isStarred: false })),
    ];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- requirement-matcher`
Expected: PASS（4 passed）

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/ai-bid-analysis/services/requirement-matcher.service.ts apps/api/src/ai-bid-analysis/services/requirement-matcher.service.spec.ts
git -C /home/asus/桌面/ERP commit -m "feat(ai-bid): RequirementMatcherService 条款-响应定位器"
```

### Task 7: bidder.processor 集成 matcher

**Files:**
- Modify: `apps/api/src/ai-bid-analysis/queues/bidder.processor.ts`
- Modify: `apps/api/src/ai-bid-analysis/queues/bidder.processor.spec.ts`
- Modify: `apps/api/src/ai-bid-analysis/ai-bid-analysis.module.ts`（provider 注册 RequirementMatcherService）

**Interfaces:**
- Consumes: Task 4（techFileId/bizFileId）、Task 6（RequirementMatcherService）、`task.requirements`（已稳定 id）、`techOcr.pages`/`bizOcr.pages`
- Produces: `aiBidderResult.requirementResponses` 写入

- [ ] **Step 1: Write failing test**

在 `bidder.processor.spec.ts` 追加（复用现有 spec 的 provider/mock 框架，给 `requirementMatcher` mock）：
```ts
it('matcher 步产出 requirementResponses 并写入 bidderResult', async () => {
  // 现有 spec 已 mock 完整 process 流程；追加：
  requirementMatcher.match.mockResolvedValue([
    { requirementId: 'r1', category: 'technical', tenderContent: '工期', isStarred: true, status: 'met', excerpt: '360天', location: { fileId: 'fa-tech', page: 1 }, confidence: 0.9 },
  ]);
  await processor.process({ data: { bidderResultId: 'br-1', taskId: 't-1' } } as any);
  expect(prisma.aiBidderResult.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'br-1' },
    data: expect.objectContaining({ requirementResponses: expect.any(Array) }),
  }));
  expect(prisma.aiBidderResult.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ requirementResponses: expect.arrayContaining([expect.objectContaining({ requirementId: 'r1' })]) }),
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- bidder.processor`
Expected: FAIL（未写 requirementResponses）

- [ ] **Step 3: Write minimal implementation**

`bidder.processor.ts`：
1. 构造函数注入 `private requirementMatcher: RequirementMatcherService`
2. `module.ts` providers 加 `RequirementMatcherService`
3. 在 step 4（scoring）之后、final `aiBidderResult.update`（line 245）之前插入：
```ts
// 条款-响应定位（requirementResponses）
let requirementResponses: any[] = [];
try {
  const techPages = (techOcr.pages ?? []).map((p: any) => ({ file: 'technical', page: p.page, text: p.text }));
  const bizPages = businessText && bizOcr?.pages ? (bizOcr.pages ?? []).map((p: any) => ({ file: 'business', page: p.page, text: p.text })) : [];
  // bizOcr 需保留对象（Task 4 改造后）：把 bizOcr 提到外层作用域
  if (task.requirements) {
    requirementResponses = await this.requirementMatcher.match(
      task.requirements as any,
      [...techPages, ...bizPages],
      { technical: techFileId, business: bizFileId },
      taskId,
    );
  }
} catch (e) {
  this.logger.warn(`bidderResult ${bidderResultId}: requirement matching failed: ${(e as Error).message.slice(0, 150)}`);
}
```
4. final `aiBidderResult.update` 的 `data` 增 `requirementResponses: requirementResponses as any,`

> 注：Task 4 改造后 `bizBuffer/bizOcr` 在 try 块内，需把 `bizOcr`/`bizFileId` 声明提到外层（`let bizOcr: any = null; let bizFileId: string | null = null;`），try 内赋值。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- bidder.processor`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP commit -am "feat(ai-bid): bidder.processor 集成条款-响应定位器，写入 requirementResponses"
```

---

## Phase 4 — 专家端点扩展

### Task 8: getAssistData 返回对比数据

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（`getAssistData` bidderResult 分支）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Produces: `getAssistData` 返回对象增 `requirements`（招标条款，来自 `task.requirements`）、`requirementResponses`（来自 `bidderResult.requirementResponses`）、`reviews`（本人 `BidRequirementReview` 列表）

- [ ] **Step 1: Write failing test**

```ts
// expert.service.spec.ts getAssistData describe 内追加
it('返回 requirements + requirementResponses + 本人 reviews', async () => {
  prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
  prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', conflictedSupplierIds: [] });
  prisma.aiBidderResult.findFirst.mockResolvedValue({
    id: 'br-1', status: 'COMPLETED', totalScore: 80, scoreItems: [], categoryTotals: {}, keyInfo: {},
    strengths: [], weaknesses: [], overallComment: '', qualificationStatus: '通过', riskLevel: 'low',
    requirementResponses: [{ requirementId: 'r1', category: 'technical', status: 'met', location: { fileId: 'fa1', page: 1 } }],
    concordance: null,
    bidSupplier: { supplierName: '甲公司' },
  });
  prisma.aiBidAnalysisTask.findUnique.mockResolvedValue({ id: 't-1', requirements: { technicalRequirements: [{ id: 'r1', content: '工期', isStarred: true }] } });
  prisma.aiBidReport.findUnique.mockResolvedValue(null);
  prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([{ requirementId: 'r1', verdict: 'dispute', note: '存疑' }]) };

  const out = await service.getAssistData('u1', 'proj-1', 'sup-1');
  expect(out.source).toBe('ai_bidder_result');
  expect(out.requirements).toEqual({ technicalRequirements: [{ id: 'r1', content: '工期', isStarred: true }] });
  expect(out.requirementResponses).toHaveLength(1);
  expect(out.reviews).toEqual([{ requirementId: 'r1', verdict: 'dispute', note: '存疑' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- expert.service.spec`
Expected: FAIL（`out.requirements` undefined）

- [ ] **Step 3: Write minimal implementation**

`getAssistData` 现有 task 查询改为带 `requirements`：
```ts
const task = await this.prisma.aiBidAnalysisTask.findUnique({
  where: { projectId },
  select: { id: true, requirements: true },   // 增 requirements
});
```
在 bidderResult 分支 return 对象增三项；reviews 在 task 块内查（已有 `if (task)` 块）：
```ts
// if (task) 块内增：
let myReviews: any[] = [];
myReviews = await this.prisma.bidRequirementReview.findMany({
  where: { bidderResultId: bidderResult.id, expertId: expert.id },
});
```
return 对象增：
```ts
requirements: task?.requirements ?? null,
requirementResponses: bidderResult.requirementResponses ?? [],
reviews: myReviews,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- expert.service.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP commit -am "feat(expert): getAssistData 返回招标条款/响应定位/本人标注"
```

### Task 9: 标注 CRUD（service + controller + dto）

**Files:**
- Create: `apps/api/src/expert/dto/upsert-requirement-review.dto.ts`
- Modify: `apps/api/src/expert/expert.service.ts`（增 `upsertRequirementReview` / `listRequirementReviews`）
- Modify: `apps/api/src/expert/expert.controller.ts`
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Produces: `POST /expert/projects/:id/assist/:supplierId/reviews`（upsert）；`GET` 同路径（list，仅本人）
- Service: `upsertRequirementReview(userId, projectId, supplierId, dto)`、`listRequirementReviews(userId, projectId, supplierId)`

- [ ] **Step 1: Write failing test**

```ts
// expert.service.spec.ts 追加
describe('requirement reviews', () => {
  beforeEach(() => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING' });
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', conflictedSupplierIds: [], signedIn: true, avoidanceConfirmed: true });
    prisma.aiBidderResult.findFirst.mockResolvedValue({ id: 'br-1', status: 'COMPLETED' });
    prisma.bidRequirementReview = { upsert: jest.fn(), findMany: jest.fn() };
  });

  it('upsert 写入本人标注（唯一约束 upsert）', async () => {
    prisma.bidRequirementReview.upsert.mockResolvedValue({ id: 'rv-1' });
    await service.upsertRequirementReview('u1', 'proj-1', 'sup-1', { requirementId: 'r1', category: 'technical', verdict: 'dispute', note: 'x' });
    expect(prisma.bidRequirementReview.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_bidderResultId_expertId_requirementId: { projectId: 'proj-1', bidderResultId: 'br-1', expertId: 'exp-1', requirementId: 'r1' } },
      create: expect.objectContaining({ verdict: 'dispute', expertId: 'exp-1' }),
    }));
  });

  it('list 仅返回本人标注', async () => {
    prisma.bidRequirementReview.findMany.mockResolvedValue([{ requirementId: 'r1' }]);
    const out = await service.listRequirementReviews('u1', 'proj-1', 'sup-1');
    expect(prisma.bidRequirementReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ expertId: 'exp-1' }) }));
    expect(out).toHaveLength(1);
  });

  it('非本项目专家 → 403', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(null);
    await expect(service.upsertRequirementReview('u1', 'proj-1', 'sup-1', { requirementId: 'r1', category: 'technical', verdict: 'ack' }))
      .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
  });

  it('回避名单中的供应商 → 403', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', conflictedSupplierIds: ['sup-1'] });
    await expect(service.upsertRequirementReview('u1', 'proj-1', 'sup-1', { requirementId: 'r1', category: 'technical', verdict: 'ack' }))
      .rejects.toMatchObject({ response: { code: 'CONFLICTED_SUPPLIER' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- expert.service.spec`
Expected: FAIL（方法不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
// upsert-requirement-review.dto.ts
import { IsString, IsIn, IsOptional, IsNotEmpty } from 'class-validator';
export class UpsertRequirementReviewDto {
  @IsString() @IsNotEmpty() requirementId: string;
  @IsIn(['qualification', 'technical', 'commercial']) category: string;
  @IsIn(['ack', 'dispute', 'doubt']) verdict: string;
  @IsString() @IsOptional() note?: string;
}
```

```ts
// expert.service.ts 增私有门控复用 + 两个方法
  private async resolveReviewContext(userId: string, projectId: string, supplierId: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId } });
    if (!project || (project.stage !== 'OPENING' && project.stage !== 'EVALUATING')) {
      throw new ForbiddenException({ error: '项目不在可操作阶段', code: 'PROJECT_NOT_ACTIVE' });
    }
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
    }
    const conflictedIds: string[] = ((expert.conflictedSupplierIds as unknown) as string[]) || [];
    if (conflictedIds.includes(supplierId)) {
      throw new ForbiddenException({ error: '该供应商在您的回避名单中', code: 'CONFLICTED_SUPPLIER' });
    }
    const bidderResult = await this.prisma.aiBidderResult.findFirst({
      where: { bidSupplierId: supplierId, status: 'COMPLETED' },
      select: { id: true },
    });
    if (!bidderResult) throw new NotFoundException({ error: '该供应商 AI 分析尚未完成', code: 'NOT_FOUND' });
    return { expert, bidderResult };
  }

  async upsertRequirementReview(userId: string, projectId: string, supplierId: string, dto: UpsertRequirementReviewDto) {
    const { expert, bidderResult } = await this.resolveReviewContext(userId, projectId, supplierId);
    return this.prisma.bidRequirementReview.upsert({
      where: { projectId_bidderResultId_expertId_requirementId: {
        projectId, bidderResultId: bidderResult.id, expertId: expert.id, requirementId: dto.requirementId,
      } },
      create: { projectId, bidderResultId: bidderResult.id, expertId: expert.id, requirementId: dto.requirementId, category: dto.category, verdict: dto.verdict, note: dto.note },
      update: { verdict: dto.verdict, note: dto.note },
    });
  }

  async listRequirementReviews(userId: string, projectId: string, supplierId: string) {
    const { expert, bidderResult } = await this.resolveReviewContext(userId, projectId, supplierId);
    return this.prisma.bidRequirementReview.findMany({
      where: { bidderResultId: bidderResult.id, expertId: expert.id },
    });
  }
```
（`ForbiddenException`/`NotFoundException` 已在文件顶部 import；确认补 import）

controller 增（注意路由顺序：在 `assist/:supplierId` 之后、`assist/compare` 之前注册，避免 `reviews` 被 supplierId 吞）：
```ts
  @Get('projects/:projectId/assist/:supplierId/reviews')
  listReviews(@CurrentUser('sub') userId: string, @Param('projectId') p: string, @Param('supplierId') s: string) {
    return this.expertService.listRequirementReviews(userId, p, s);
  }
  @Post('projects/:projectId/assist/:supplierId/reviews')
  upsertReview(@CurrentUser('sub') userId: string, @Param('projectId') p: string, @Param('supplierId') s: string, @Body() dto: UpsertRequirementReviewDto) {
    return this.expertService.upsertRequirementReview(userId, p, s, dto);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- expert.service.spec && pnpm --filter api build`
Expected: PASS + 编译通过

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/expert/dto/upsert-requirement-review.dto.ts
git -C /home/asus/桌面/ERP commit -am "feat(expert): 招标条款标注 CRUD（仅本人，复用门控）"
```

### Task 10: getMyScores 返回异议 category 映射

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（`getMyScores`）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Produces: `getMyScores` 返回 `{ records: BidScoreRecord[]; disputeCategories: string[] }`（大写评分 category：QUALIFICATION/TECHNICAL/BUSINESS）

- [ ] **Step 1: Write failing test**

```ts
// expert.service.spec.ts getMyScores describe 内（若无则新建）
it('返回 records + disputeCategories（映射为大写）', async () => {
  prisma.bidExpert.findFirst.mockResolvedValue({ id: 'exp-1', userId: 'u1', signedIn: true, avoidanceConfirmed: true });
  prisma.bidScoreRecord.findMany.mockResolvedValue([]);
  prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
    { category: 'technical', verdict: 'dispute' },
    { category: 'commercial', verdict: 'dispute' },
    { category: 'qualification', verdict: 'ack' }, // 非异议不计
  ]) };
  const out = await service.getMyScores('u1', 'proj-1');
  expect(out.records).toEqual([]);
  expect(out.disputeCategories).toEqual(['TECHNICAL', 'BUSINESS']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- expert.service.spec`
Expected: FAIL（返回的是数组，无 disputeCategories）

- [ ] **Step 3: Write minimal implementation**

```ts
// getMyScores 改为：
  async getMyScores(userId: string, projectId: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });
    if (!expert.signedIn || !expert.avoidanceConfirmed) {
      throw new ForbiddenException({ error: '请先完成身份核验和回避确认', code: 'VERIFICATION_REQUIRED' });
    }
    const [records, disputes] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({ where: { expertId: expert.id }, include: { scoreItem: true } }),
      this.prisma.bidRequirementReview.findMany({ where: { projectId, expertId: expert.id, verdict: 'dispute' }, select: { category: true } }),
    ]);
    const UPPER: Record<string, string> = { qualification: 'QUALIFICATION', technical: 'TECHNICAL', commercial: 'BUSINESS' };
    const disputeCategories = [...new Set(disputes.map((d) => UPPER[d.category]).filter(Boolean))];
    return { records, disputeCategories };
  }
```

- [ ] **Step 4: Run test to verify it passes + 更新消费方**

Run: `pnpm --filter api test -- expert.service.spec`
Expected: PASS
> 前端消费 getMyScores 处在 Task 15 同步改为 `.records`。

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP commit -am "feat(expert): getMyScores 返回异议 category 映射（打分页联动）"
```

---

## Phase 5 — 专家评审报告异议披露

### Task 11: getReport 增返本人异议

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts`（`getReport`）
- Test: `apps/api/src/expert/expert.service.spec.ts`

**Interfaces:**
- Produces: `EvaluationReport` 增 `myDisputedReviews: Array<{ supplierId; supplierName; requirementId; category; tenderContent; note }>`（本人 verdict=dispute 标注，跨 supplier）

> 时序说明：异议在专家评标时产生，晚于 AI docx 报告（Task 7 已注明）。故异议入**专家评审报告**（confirmReport 时确认），不入 AI docx。

> 前置（#5）：先 Read `expert.service.ts` 的 `getReport` 全文，确认现有返回结构（EvaluationReport 如何组装、supplierScores 来源）与 `expert.service.spec.ts` 的 getReport mock 框架。下方测试为骨架，按实际结构与 mock 框架调整（字段名/prisma mock 路径），切勿照抄。

- [ ] **Step 1: Write failing test**

```ts
// expert.service.spec.ts getReport describe 内追加
it('附带本人异议条款（跨供应商）', async () => {
  // 复用现有 getReport mock 框架（project/scoreItems/expert 等），追加：
  prisma.bidRequirementReview = { findMany: jest.fn().mockResolvedValue([
    { bidderResultId: 'br-1', requirementId: 'r1', category: 'technical', note: '工期存疑' },
  ]) };
  prisma.aiBidderResult.findMany.mockResolvedValue([{ id: 'br-1', bidSupplier: { id: 'sup-1', supplierName: '甲' } }]);
  prisma.aiBidderResult.findFirst.mockResolvedValue({ requirementResponses: [{ requirementId: 'r1', tenderContent: '工期365天' }] });
  const out = await service.getReport('u1', 'proj-1');
  expect(out.myDisputedReviews).toEqual([expect.objectContaining({ supplierName: '甲', requirementId: 'r1', tenderContent: '工期365天', note: '工期存疑' })]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test -- expert.service.spec`
Expected: FAIL（无 myDisputedReviews）

- [ ] **Step 3: Write minimal implementation**

`getReport` 末尾组装返回对象前，增：
```ts
const disputed = await this.prisma.bidRequirementReview.findMany({
  where: { projectId, expertId: expert.id, verdict: 'dispute' },
});
// 关联 supplierName + tenderContent（从 requirementResponses 反查）
const brIds = [...new Set(disputed.map((d) => d.bidderResultId))];
const brs = brIds.length ? await this.prisma.aiBidderResult.findMany({
  where: { id: { in: brIds } },
  include: { bidSupplier: { select: { id: true, supplierName: true } }, },
}) : [];
const contentMap = new Map<string, string>();
for (const br of brs) {
  for (const r of (br.requirementResponses as any[]) ?? []) contentMap.set(`${br.id}:${r.requirementId}`, r.tenderContent ?? '');
}
const myDisputedReviews = disputed.map((d) => {
  const br = brs.find((b) => b.id === d.bidderResultId);
  return {
    supplierId: br?.bidSupplier?.id ?? '',
    supplierName: br?.bidSupplier?.supplierName ?? '',
    requirementId: d.requirementId,
    category: d.category,
    tenderContent: contentMap.get(`${d.bidderResultId}:${d.requirementId}`) ?? '',
    note: d.note ?? '',
  };
});
```
return 对象增 `myDisputedReviews`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test -- expert.service.spec`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP commit -am "feat(expert): 评审报告披露本人异议条款"
```

---

## Phase 6 — 前端

### Task 12: shared 类型

**Files:**
- Modify: `packages/shared/src/types.ts`

**Interfaces:**
- Produces: `RequirementResponse`、`BidRequirementReview`；`AssistData` 增 `requirements`/`requirementResponses`/`reviews`；`EvaluationReport` 增 `myDisputedReviews`

- [ ] **Step 1: 编辑 types.ts**

> #3：下方 `RequirementResponse` 为权威定义。Task 6 service 内联的同名 interface 是 Phase 3 早于 shared 的临时定义；本 task build 后，回头把 `requirement-matcher.service.ts` 的内联 `RequirementResponse` 删掉，改 `import type { RequirementResponse } from '@water-erp/shared'`。

在 `AiScoreItem` 后增：
```ts
export interface RequirementResponse {
  requirementId: string;
  category: 'qualification' | 'technical' | 'commercial';
  tenderContent: string;
  isStarred: boolean;
  status: 'met' | 'partial' | 'unmet' | 'not_found';
  excerpt: string;
  location: { fileId: string; page: number } | null;
  confidence: number;
}
export interface BidRequirementReview {
  requirementId: string;
  category: string;
  verdict: 'ack' | 'dispute' | 'doubt';
  note?: string | null;
}
```
`AssistData` 增可选字段：
```ts
  requirements?: any;
  requirementResponses?: RequirementResponse[];
  reviews?: BidRequirementReview[];
```
`EvaluationReport` 增：
```ts
  myDisputedReviews?: Array<{ supplierId: string; supplierName: string; requirementId: string; category: string; tenderContent: string; note: string }>;
```

- [ ] **Step 2: Build shared**

Run: `pnpm --filter @water-erp/shared build`
Expected: 编译通过，`dist/` 更新

- [ ] **Step 3: Commit**

```bash
git -C /home/asus/桌面/ERP commit -am "feat(shared): RequirementResponse/BidRequirementReview 类型 + AssistData/EvaluationReport 扩展"
```

### Task 13: RequirementComparePanel 组件

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/assist/requirement-compare-panel.tsx`

**Interfaces:**
- Consumes: `AssistData.requirements` / `requirementResponses` / `reviews`；`onReview(payload)` → POST upsert
- Produces: 按 category 分组的条款↔响应↔标注对比视图

- [ ] **Step 1: 编写组件**

```tsx
// requirement-compare-panel.tsx
'use client';
import { useState } from 'react';
import { Star, ExternalLink, CheckCircle, AlertCircle, HelpCircle, XCircle } from 'lucide-react';
import type { RequirementResponse, BidRequirementReview } from '@water-erp/shared';
import { api } from '@/lib/api';

interface ReqItem { id: string; category: string; content: string; isStarred?: boolean; acceptanceCriteria?: string; threshold?: string; evidenceType?: string; }

const CAT_LABEL: Record<string, string> = { qualification: '资格要求', technical: '技术要求', commercial: '商务要求' };
const STATUS_CFG: Record<string, { label: string; color: string; icon: any }> = {
  met: { label: '满足', color: 'text-emerald-600', icon: CheckCircle },
  partial: { label: '部分', color: 'text-amber-600', icon: HelpCircle },
  unmet: { label: '不满足', color: 'text-red-600', icon: XCircle },
  not_found: { label: '未提及', color: 'text-[oklch(0.55_0.01_264)]', icon: AlertCircle },
};

export function RequirementComparePanel({
  projectId, supplierId, requirements, responses, reviews,
}: {
  projectId: string; supplierId: string;
  requirements: any; responses: RequirementResponse[]; reviews: BidRequirementReview[];
}) {
  const [local, setLocal] = useState<Record<string, BidRequirementReview>>(
    () => Object.fromEntries(reviews.map((r) => [r.requirementId, r])),
  );

  const flat: ReqItem[] = [
    ...(requirements?.qualificationRequirements ?? []).map((r: any) => ({ ...r, category: 'qualification' })),
    ...(requirements?.technicalRequirements ?? []).map((r: any) => ({ ...r, category: 'technical' })),
    ...(requirements?.commercialRequirements ?? []).map((r: any) => ({ ...r, category: 'commercial' })),
  ];
  const respBy = (id: string) => responses.find((r) => r.requirementId === id);

  const setVerdict = async (item: ReqItem, verdict: 'ack' | 'dispute' | 'doubt') => {
    const prev = local[item.id];
    const next = { ...prev, requirementId: item.id, category: item.category, verdict, note: prev?.note ?? '' };
    setLocal({ ...local, [item.id]: next });
    try {
      await api.post(`/expert/projects/${projectId}/assist/${supplierId}/reviews`, {
        requirementId: item.id, category: item.category, verdict, note: next.note,
      });
    } catch { /* toast 由全局拦截器处理 */ }
  };
  const setNote = (item: ReqItem, note: string) => {
    const verdict = local[item.id]?.verdict ?? 'doubt';
    setLocal({ ...local, [item.id]: { requirementId: item.id, category: item.category, verdict, note } });
  };
  const saveNote = async (item: ReqItem) => {
    const r = local[item.id];
    if (!r) return;
    await api.post(`/expert/projects/${projectId}/assist/${supplierId}/reviews`, {
      requirementId: item.id, category: item.category, verdict: r.verdict, note: r.note,
    });
  };

  if (!flat.length) {
    return <div className="text-center py-6 text-xs text-[oklch(0.55_0.01_264)]">招标条款分析中或暂无条款数据</div>;
  }

  const grouped = ['qualification', 'technical', 'commercial'] as const;
  return (
    <div className="space-y-3">
      {grouped.map((cat) => {
        const items = flat.filter((i) => i.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} className="glass-card glass-card-lighter rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[oklch(0.91_0.006_264)] bg-white/40">
              <span className="font-bold text-sm text-[var(--color-text)]">{CAT_LABEL[cat]}</span>
              {cat === 'technical' && <span className="text-[10px] text-amber-600">★ 号为实质性条款</span>}
            </div>
            <div className="divide-y divide-[oklch(0.94_0.004_264)]">
              {items.map((item) => {
                const resp = respBy(item.id);
                const review = local[item.id];
                const isDispute = review?.verdict === 'dispute';
                const sc = resp ? STATUS_CFG[resp.status] : null;
                return (
                  <div key={item.id} className={`grid grid-cols-12 gap-3 p-3 ${isDispute ? 'bg-amber-50' : ''}`}>
                    {/* 招标条款 */}
                    <div className="col-span-5">
                      <div className="flex items-start gap-1.5">
                        {item.isStarred && <Star size={12} className="text-amber-500 fill-amber-400 shrink-0 mt-0.5" />}
                        <p className="text-xs text-[var(--color-text)] leading-relaxed">{item.content}</p>
                      </div>
                      {(item.acceptanceCriteria || item.threshold) && (
                        <p className="text-[10px] text-[oklch(0.55_0.01_264)] mt-1 ml-5">验收/阈值：{item.acceptanceCriteria || item.threshold}</p>
                      )}
                    </div>
                    {/* AI 响应 */}
                    <div className="col-span-4">
                      {resp && sc ? (
                        <>
                          <div className={`flex items-center gap-1 text-xs font-semibold ${sc.color}`}>
                            <sc.icon size={12} /> {sc.label}
                          </div>
                          {resp.excerpt && <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-relaxed">“{resp.excerpt}”</p>}
                          {resp.location && (
                            <a href={`/api/upload/files/${resp.location.fileId}#page=${resp.location.page}`} target="_blank" rel="noopener"
                              className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-primary)] hover:underline mt-1">
                              <ExternalLink size={10} /> 投标原文第 {resp.location.page} 页
                            </a>
                          )}
                        </>
                      ) : <span className="text-[10px] text-[oklch(0.55_0.01_264)]">AI 响应定位中</span>}
                    </div>
                    {/* 标注 */}
                    <div className="col-span-3">
                      <div className="flex gap-1.5 mb-1">
                        {(['ack', 'dispute', 'doubt'] as const).map((v) => (
                          <button key={v} onClick={() => setVerdict(item, v)}
                            className={`text-[10px] px-2 py-0.5 rounded border ${
                              review?.verdict === v
                                ? v === 'ack' ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
                                  : v === 'dispute' ? 'bg-red-100 border-red-300 text-red-700'
                                  : 'bg-amber-100 border-amber-300 text-amber-700'
                                : 'border-[oklch(0.91_0.006_264)] text-[oklch(0.55_0.01_264)] hover:bg-white/60'
                            }`}>
                            {v === 'ack' ? '认可' : v === 'dispute' ? '异议' : '存疑'}
                          </button>
                        ))}
                      </div>
                      {review && (
                        <textarea
                          value={review.note ?? ''} onChange={(e) => setNote(item, e.target.value)} onBlur={() => saveNote(item)}
                          placeholder="备注（可选）" rows={1}
                          className="w-full text-[10px] px-2 py-1 rounded border border-[oklch(0.91_0.006_264)] bg-white/70 resize-none focus:outline-none focus:border-[var(--color-primary)]" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-[oklch(0.55_0.01_264)] text-center">标注仅本人可见；异议将在评审报告中披露，并在打分页提示核对。</p>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter expert-portal exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/expert-portal/src/components/evaluate/assist/requirement-compare-panel.tsx
git -C /home/asus/桌面/ERP commit -m "feat(expert-portal): 条款响应对比视图组件"
```

### Task 14: AssistPanel 插入对比分区 + 重编号

**Files:**
- Modify: `apps/expert-portal/src/components/evaluate/assist/assist-panel.tsx`
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（传 requirements/responses/reviews + projectId/supplierId）

**Interfaces:**
- Consumes: Task 13 组件；`AssistData` 新字段

- [ ] **Step 1: assist-panel.tsx 改造**

1. props 增 `projectId: string`（已有）、在主组件 `<AssistPanel>` 调用处由 page 传入 `assistData.requirements` 等（已在 assistData 内，无需额外 prop）。
2. import：`import { RequirementComparePanel } from './requirement-compare-panel';`
3. 主组件 return（line 1270+）在 ①评分分析 `<section>` 之后插入新 ②，并把现有 ②关键信息→③、③④→④⑤、⑤综合排名→⑥：
```tsx
      {/* ② 条款响应对比（新） */}
      <section>
        <SectionHeader number={2} title="条款响应对比" subtitle="· 招标条款 ↔ 投标响应" />
        <div className="mt-3">
          <RequirementComparePanel
            key={activeSupplier}   // #4: 切换供应商强制 remount，刷新标注 state
            projectId={projectId}
            supplierId={activeSupplier}
            requirements={assistData.requirements}
            responses={assistData.requirementResponses ?? []}
            reviews={assistData.reviews ?? []}
          />
        </div>
      </section>

      {/* ③ 关键信息（原②） */}
      <section>
        <SectionHeader number={3} title="关键信息" subtitle="· OCR 提取的结构化数据" />
        ...
      {/* ④ + ⑤ 数据一致性 + 串通检测（原③④，SectionNumber n 改 4/5） */}
      {/* ⑥ 综合排名（原⑤，number 改 6） */}
```
（仅改 `SectionHeader number=` / `SectionNumber n=` 的数字 prop；正文不变。）

4. 降级：`requirementResponses` 空但 `assistData` 存在 → RequirementComparePanel 内部已显示"分析中"占位（Task 13），无需额外处理。

- [ ] **Step 2: page.tsx 确认传参**

`<AssistPanel>` 已接收 `assistData`（含新字段）+ `projectId` + `activeSupplier`，无需改动；确认 `loadAssist` 拿到的 assistData 含 requirements/responses/reviews（Task 8 后端已返）。

- [ ] **Step 3: 类型检查 + 手验**

Run: `pnpm --filter expert-portal exec tsc --noEmit`
Expected: 无类型错误

浏览器：登录专家 → 进入 assist step → 见 ②条款响应对比分区，条款/响应/标注控件渲染。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP commit -am "feat(expert-portal): AssistPanel 插入条款响应对比分区（重编号 ②-⑥）"
```

### Task 15: 打分页 category 级联动

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`

**Interfaces:**
- Consumes: `getMyScores` 新返回 `{ records, disputeCategories }`

- [ ] **Step 1: 改造打分页**

1. 加载已打分时取 disputeCategories（#6）：先 grep `evaluate/[id]/page.tsx` 定位现有 `getMyScores` 调用处（填充 `scores` state 的确切代码），据实改为：
```ts
const { records, disputeCategories } = await api.get<{ records: any[]; disputeCategories: string[] }>(`/expert/projects/${projectId}/my-scores`);
setDisputeCategories(new Set(disputeCategories));   // 新 state：const [disputeCategories, setDisputeCategories] = useState<Set<string>>(new Set());
records.forEach(...); // 原填充 scores 逻辑不变
```
2. scoring step 渲染（line 1041 `Object.entries(grouped)`）命中 category 加角标 + 确认 checkbox：
```tsx
{Object.entries(grouped).map(([category, items]) => {
  const disputed = disputeCategories.has(category);
  return (
    <div key={category} className={`bg-blue-50 rounded-xl border overflow-hidden ${disputed ? 'border-amber-300 ring-1 ring-amber-200' : 'border-blue-100'}`}>
      <div className="flex items-center justify-between p-4 border-b border-blue-100" style={{ borderLeft: `2px solid ${CATEGORY_COLOR[category] || '#064ea2'}` }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold px-3 py-1 rounded-lg" style={{ color: CATEGORY_COLOR[category] || '#064ea2', backgroundColor: (CATEGORY_COLOR[category] || '#064ea2') + '18' }}>{CATEGORY_LABEL[category] || category}</span>
          {disputed && <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">⚠ 有异议条款待核对</span>}
        </div>
        {/* 原通过/分数汇总 */}
      </div>
      {/* 原评分项列表 */}
      {disputed && (
        <label className="flex items-center gap-2 px-4 py-2 bg-amber-50/60 border-t border-amber-200 text-xs text-amber-800">
          <input type="checkbox" checked={!!confirmedDispute[category]} onChange={(e) => setConfirmedDispute({ ...confirmedDispute, [category]: e.target.checked })} />
          已核对本类异议条款
        </label>
      )}
    </div>
  );
})}
```
（新 state：`const [confirmedDispute, setConfirmedDispute] = useState<Record<string, boolean>>({});`）
3. `submitScores`（line 380+）拦截：在现有 `missingReasons` 校验之后增：
```ts
const unconfirmed = [...disputeCategories].filter((c) => !confirmedDispute[c]);
if (unconfirmed.length > 0) {
  toast.warning(`以下类别有异议条款未核对：${unconfirmed.map((c) => CATEGORY_LABEL[c] || c).join('、')}`);
  return;
}
```

> 切换供应商重置核对状态（#6）：`disputeCategories` 是项目级（本人所有 dispute，不随供应商变），但 `confirmedDispute` 是 UI 核对态，须随供应商切换重置——在供应商侧边栏 `onSelect`（`setActiveSupplier` 处，约 page.tsx:589）补 `setConfirmedDispute({})`。

- [ ] **Step 2: 类型检查 + 手验**

Run: `pnpm --filter expert-portal exec tsc --noEmit`
Expected: 无类型错误

浏览器：先在 ②标注一条异议 → 进打分页 → 对应 category 分组高亮 + 角标 + checkbox；未勾选提交 → toast 拦截；勾选后可提交（分值不变）。

- [ ] **Step 3: 报告页异议小节（可选，复用对比卡片样式）**

report step 渲染处（`EvaluationReport`），若 `report.myDisputedReviews?.length`，增一个 amber 卡片列出异议（supplierName + tenderContent + note）。样式参照 RequirementComparePanel 的异议行。

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP commit -am "feat(expert-portal): 打分页 category 级异议联动 + 报告页异议披露"
```

---

## 完成验证（端到端）

- [ ] seed 后 cmqhero-bid-proj01 跑 AI 分析（已有管线）→ `aiBidderResult.requirementResponses` 非空
- [ ] 专家进入 assist step → ②条款响应对比分区渲染条款/响应/页码跳转
- [ ] 标注异议 → 打分页对应 category 高亮 + checkbox 拦截
- [ ] 报告确认 → EvaluationReport 含 myDisputedReviews
- [ ] 全量：`pnpm --filter api test`（后端单测绿）+ `pnpm --filter expert-portal exec tsc --noEmit`（前端类型绿）

## Self-Review 笔记（计划 vs spec 覆盖）

- requirementId 稳定化 → Task 1-2 ✅
- AiBidderResult.requirementResponses + migration → Task 3 ✅
- matcher（含 fileId 修正）→ Task 4-7 ✅
- getAssistData 扩展 → Task 8 ✅
- 标注 CRUD + 仅本人 + 门控 → Task 9 ✅
- getMyScores category 联动 → Task 10 ✅
- 报告异议（时序修正：专家评审报告非 AI docx）→ Task 11 ✅
- shared 类型 → Task 12 ✅
- 前端对比视图 + 打分页联动 + 报告页 → Task 13-15 ✅
- 合规边界（不改分/不阻断/仅本人）→ Task 9 门控 + Task 10/15 软提示 ✅
- 降级（requirements 空/响应空）→ Task 13 占位 + Task 14 注 ✅

