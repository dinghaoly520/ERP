# 评分标准页 AI 提取得分点 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理员在 bid-portal 评分标准页得分点编辑器里点"AI 提取建议"，系统同步从该项目招标文件提取该评分项的得分点建议，管理员审核后批量导入。

**Architecture:** 新建 `ScorePointExtractorService`（注入 `LlmService` + `LlmOutputValidator` + `PlaintextFetcherService` + `OcrService` + `PrismaService`）—— 复用招标文件解密读取链路 + DeepSeek 强制 JSON 输出 + 校验重试；招标文件文本 per 项目 5 分钟内存缓存避免重复 OCR。同步端点（模式 C）返回建议数组**不落库**；管理员审核后走 batch 端点事务批量 create。

**Tech Stack:** NestJS 11 + Prisma（后端）；Next.js 16 + React 19（bid-portal）；DeepSeek via `LlmService.chatJson`；Jest（测试）。

## Global Constraints

- 工作目录 `water-erp/`；后端 `pnpm --filter api ...`，前端 `pnpm --filter bid-portal ...`。
- **同步端点**（模式 C，参考 `ai/ai.controller.ts:95-100` tenderFieldGenerate）。不建 task 表、不轮询。
- LLM 调用走 `LlmService.chatJson<T>()`（`local-ai/llm.service.ts:74`，强制 `response_format: json_object` + 代码块剥离）；校验用 `LlmOutputValidator.retryChatJson<T>()`（`local-ai/llm-output-validator.ts:281-325`，签名 `retryChatJson<T>(llm, sys, user, validate: (raw)=>raw is T, maxRetries=2, signal?)`）。两者都在 `@Global() LocalAiModule`，直接构造函数注入。
- 招标文件获取走 `PlaintextFetcherService.fetchTenderPlaintext(projectId)`（`ai-bid-analysis/services/plaintext-fetcher.service.ts:88`，未就绪返回 null）+ `processFile(ocrService, buffer, fileName)`（`ai-bid-analysis/utils/file-processor.ts`，DOCX→mammoth / PDF→OCR:8100）。
- **招标文本 per 项目内存缓存**：`Map<projectId, {text, expiresAt}>`，TTL 5 分钟。Nest service 默认 singleton，跨请求共享。
- **AI 不落库、不回填** `BidScoreItem.scoringCriteria`（管理员权威通道，见 `score-criteria-inferer.service.ts:3` 设计决策）。AI 只返回建议数组；导入走 batch 端点（管理员审核后）。
- 阶段锁复用 `assertScoreItemsEditable`（EVALUATING/ARCHIVED → ConflictException `SCORE_ITEMS_LOCKED`）。batch 端点要锁；extract 端点只读不锁（标准定义阶段即可提取建议）。
- commit message：中文 conventional + 空行 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 沿用 `BidController` 类级 `@Roles`，不加方法级权限。
- 模块装配：`BidModule` 需 `imports: [AiBidAnalysisModule]`（它 exports 全部 services，含 `PlaintextFetcherService`）。若引发 BullMQ queue 重复注册冲突，替代方案：在 `ScorePointExtractorService` 内联 fetch+decrypt+processFile 逻辑（参考 `plaintext-fetcher.service.ts:88-142`）。

## 现状（已核实，phase ① 已交付）

- point CRUD 端点已存在：`GET/POST/PATCH/DELETE /bid/projects/:id/score-items/:itemId/points[/:pointId]`（`bid.controller.ts:193-229`）。
- `BidScorePoint` Prisma 模型已存在（`schema.prisma:389`）。
- 前端 `score-points-editor.tsx` + API client（`bid.ts` ScorePoint 类型 + 4 CRUD 函数）已存在。
- `bid.service.ts` 已有 `assertScoreItemInProject(projectId, itemId)`（校验归属 + 阶段锁）。

## File Structure

| 层 | 文件 | 责任 |
|----|------|------|
| prompt | `apps/api/src/bid/prompts/score-points.prompt.ts`（新） | 提取得分点的 system + user prompt 模板 |
| service | `apps/api/src/bid/score-point-extractor.service.ts`（新） | LLM 提取 + 招标文本缓存 |
| DTO | `apps/api/src/bid/dto/batch-create-score-points.dto.ts`（新） | batch 导入校验 |
| service | `apps/api/src/bid/bid.service.ts`（改） | 加 `batchCreateScorePoints` |
| controller | `apps/api/src/bid/bid.controller.ts`（改） | 加 extract + batch 端点 |
| module | `apps/api/src/bid/bid.module.ts`（改） | imports AiBidAnalysisModule + 注册 ScorePointExtractorService |
| 前端 API | `apps/bid-portal/src/lib/api/bid.ts`（改） | `extractScorePoints` + `batchCreateScorePoints` 函数 |
| 前端 UI | `apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx`（改） | "AI 提取建议" 按钮 + 审核弹窗 |
| 测试 | `apps/api/src/bid/score-point-extractor.service.spec.ts`（新） | 提取逻辑测试 |
| 测试 | `apps/api/src/bid/bid.service.spec.ts`（改） | batchCreateScorePoints 测试 |

---

### Task 1: ScorePointExtractorService + prompt + 模块装配（TDD）

**Files:**
- Create: `apps/api/src/bid/prompts/score-points.prompt.ts`
- Create: `apps/api/src/bid/score-point-extractor.service.ts`
- Create: `apps/api/src/bid/score-point-extractor.service.spec.ts`
- Modify: `apps/api/src/bid/bid.module.ts`

**Interfaces:**
- Consumes: `LlmService`、`LlmOutputValidator`、`PlaintextFetcherService`（来自 AiBidAnalysisModule）、`OcrService`、`PrismaService`
- Produces: `ScorePointExtractorService.extractScorePoints(projectId, itemId): Promise<ScorePointSuggestion[]>`，其中 `ScorePointSuggestion = { name: string; fullScore: number; evidenceHint: string; objective: boolean }`。供 Task 2 的 controller 调用。

- [ ] **Step 1: 创建 prompt 模板 `prompts/score-points.prompt.ts`**

```ts
export const SCORE_POINTS_EXTRACT_SYSTEM = '你是资深评标专家。根据招标文件，为指定评分项提取"得分条款"（评分点 / checklist 子项）建议。';

export const SCORE_POINTS_EXTRACT_PROMPT = `请为以下评分项提取得分条款建议。

## 评分项
{{SCORE_ITEM}}

## 该评分项满分
{{MAX_SCORE}}

## 已有得分点名称（避免重复建议）
{{EXISTING_POINTS}}

## 招标文件内容
{{TENDER_TEXT}}

## 要求
- objective=true 为客观条款（可明确判定，如"提供 ISO9001 证书"、"近三年类似业绩≥3项"）；objective=false 为需专家主观判断的项（如"方案先进性"）。
- fullScore 合计不要超过评分项满分 {{MAX_SCORE}}。
- 必须依据招标文件具体条款，不要臆造。
- evidenceHint 指明在投标文件何处定位证据。

## 输出格式（严格 JSON，不要 markdown 代码块）
{
  "items": [
    { "name": "得分点名称", "fullScore": 5, "evidenceHint": "评审要点", "objective": true }
  ]
}`;
```

- [ ] **Step 2: 写失败测试 `score-point-extractor.service.spec.ts`**

```ts
import { ScorePointExtractorService } from './score-point-extractor.service';

describe('ScorePointExtractorService', () => {
  let service: ScorePointExtractorService;
  const llm = { chatJson: jest.fn() };
  const validator = { retryChatJson: jest.fn() };
  const plaintextFetcher = { fetchTenderPlaintext: jest.fn() };
  const ocr = {};
  const prisma = {
    bidScoreItem: { findFirst: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScorePointExtractorService(
      llm as any,
      validator as any,
      plaintextFetcher as any,
      ocr as any,
      prisma as any,
    );
  });

  it('评分项不存在抛 NOT_FOUND', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue(null);
    await expect(service.extractScorePoints('p1', 'iX')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('招标文件未就绪（fetchTenderPlaintext 返回 null）抛 TENDER_NOT_READY', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(null);
    await expect(service.extractScorePoints('p1', 'i1')).rejects.toMatchObject({
      response: { code: 'TENDER_NOT_READY' },
    });
  });

  it('返回 LLM 提取的建议数组（不落库）', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [{ name: '已有项' }] });
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
    // processFile 是模块级函数，需 mock —— 见 Step 3 实现里将其作为可注入依赖或 jest.mock
    validator.retryChatJson.mockResolvedValue({
      items: [
        { name: '施工组织设计', fullScore: 15, evidenceHint: '技术标施工组织章节', objective: true },
      ],
    });
    const r = await service.extractScorePoints('p1', 'i1');
    expect(r).toEqual([{ name: '施工组织设计', fullScore: 15, evidenceHint: '技术标施工组织章节', objective: true }]);
    expect(validator.retryChatJson).toHaveBeenCalledTimes(1);
  });

  it('招标文本缓存命中：第二次不重新 fetch', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractScorePoints('p1', 'i1');
    await service.extractScorePoints('p1', 'i1');
    expect(plaintextFetcher.fetchTenderPlaintext).toHaveBeenCalledTimes(1);
  });
});
```

> 注：`processFile` 是 `ai-bid-analysis/utils/file-processor.ts` 的模块级函数。Step 3 实现里用 `jest.mock('../../ai-bid-analysis/utils/file-processor')` mock 它（返回 `{ text: '...' }`）。测试文件顶部加：
> ```ts
> jest.mock('../../ai-bid-analysis/utils/file-processor', () => ({
>   processFile: jest.fn().mockResolvedValue({ text: 'mocked tender text' }),
> }));
> ```

- [ ] **Step 3: 运行测试，确认失败**

```bash
pnpm --filter api test -- score-point-extractor
```
Expected: FAIL（service 未定义）。

- [ ] **Step 4: 实现 `score-point-extractor.service.ts`**

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { LlmService } from '../local-ai/llm.service';
import { LlmOutputValidator } from '../local-ai/llm-output-validator';
import { PlaintextFetcherService } from '../ai-bid-analysis/services/plaintext-fetcher.service';
import { OcrService } from '../local-ai/ocr.service';
import { PrismaService } from '../prisma/prisma.service';
import { processFile } from '../ai-bid-analysis/utils/file-processor';
import { SCORE_POINTS_EXTRACT_SYSTEM, SCORE_POINTS_EXTRACT_PROMPT } from './prompts/score-points.prompt';

export interface ScorePointSuggestion {
  name: string;
  fullScore: number;
  evidenceHint: string;
  objective: boolean;
}

@Injectable()
export class ScorePointExtractorService {
  private readonly tenderTextCache = new Map<string, { text: string; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly llm: LlmService,
    private readonly validator: LlmOutputValidator,
    private readonly plaintextFetcher: PlaintextFetcherService,
    private readonly ocr: OcrService,
    private readonly prisma: PrismaService,
  ) {}

  async extractScorePoints(projectId: string, itemId: string): Promise<ScorePointSuggestion[]> {
    const item = await this.prisma.bidScoreItem.findFirst({
      where: { id: itemId, projectId },
      include: { points: true },
    });
    if (!item) {
      throw new BadRequestException({ error: '评分项不存在', code: 'NOT_FOUND' });
    }

    const tenderText = await this.getTenderText(projectId);
    if (!tenderText) {
      throw new BadRequestException({ error: '招标文件未就绪（未发布招标公告或无招标文件）', code: 'TENDER_NOT_READY' });
    }

    const prompt = SCORE_POINTS_EXTRACT_PROMPT
      .replace('{{SCORE_ITEM}}', JSON.stringify({ category: item.category, name: item.name }))
      .replace(/{{MAX_SCORE}}/g, String(Number(item.maxScore)))
      .replace('{{EXISTING_POINTS}}', JSON.stringify(item.points.map((p) => p.name)))
      .replace('{{TENDER_TEXT}}', JSON.stringify(tenderText.slice(0, 10000)));

    const result = await this.validator.retryChatJson<{ items: ScorePointSuggestion[] }>(
      this.llm,
      SCORE_POINTS_EXTRACT_SYSTEM,
      prompt,
      (raw): raw is { items: ScorePointSuggestion[] } =>
        !!raw && typeof raw === 'object' && Array.isArray((raw as any).items),
      2,
    );

    return result.items;
  }

  private async getTenderText(projectId: string): Promise<string | null> {
    const cached = this.tenderTextCache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.text;
    }
    const buffer = await this.plaintextFetcher.fetchTenderPlaintext(projectId);
    if (!buffer) return null;
    const processed = await processFile(this.ocr, buffer, 'tender.pdf');
    this.tenderTextCache.set(projectId, { text: processed.text, expiresAt: Date.now() + ScorePointExtractorService.CACHE_TTL_MS });
    return processed.text;
  }
}
```

- [ ] **Step 5: 改 `bid.module.ts` —— imports AiBidAnalysisModule + 注册 provider**

```ts
// 顶部 import 加
import { AiBidAnalysisModule } from '../ai-bid-analysis/ai-bid-analysis.module';
import { ScorePointExtractorService } from './score-point-extractor.service';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    NotificationModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.TENDER_PROCESSING }),
    AiBidAnalysisModule,   // ← 加：为了注入 PlaintextFetcherService
  ],
  controllers: [BidController],
  providers: [BidService, BidGateway, ClarificationAiService, ScorePointExtractorService],   // ← 加
  exports: [BidGateway, BidService, ClarificationAiService],
})
```

> 如果 `AiBidAnalysisModule` 的 import 导致 BullMQ queue 重复注册或循环依赖报错，**STOP**，报告 BLOCKED 给 controller（替代方案：把 PlaintextFetcher 的 fetch+decrypt 逻辑内联到 ScorePointExtractorService，参考 `plaintext-fetcher.service.ts:88-142`）。

- [ ] **Step 6: 运行测试，确认通过**

```bash
pnpm --filter api test -- score-point-extractor
```
Expected: 4 个 case PASS，输出 pristine。

- [ ] **Step 7: 编译 + 启动冒烟（确认 DI 装配无误）**

```bash
pnpm --filter api exec tsc --noEmit
```
Expected: 无报错。如果 tsc 报 AiBidAnalysisModule 循环依赖，按 Step 5 的 STOP 规则处理。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/bid/prompts apps/api/src/bid/score-point-extractor.service.ts apps/api/src/bid/score-point-extractor.service.spec.ts apps/api/src/bid/bid.module.ts
git commit -m "feat(api): ScorePointExtractorService — AI 从招标文件提取得分点建议

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: extract 端点（controller）

**Files:**
- Modify: `apps/api/src/bid/bid.controller.ts`

**Interfaces:**
- Consumes: Task 1 的 `ScorePointExtractorService.extractScorePoints`
- Produces: `POST /bid/projects/:id/score-items/:itemId/points/extract` → `ScorePointSuggestion[]`

- [ ] **Step 1: 在 `bid.controller.ts` 注入 service + 加端点**

顶部 import：
```ts
import { ScorePointExtractorService } from './score-point-extractor.service';
```

构造函数加注入（在现有 `private readonly bidService: BidService` 旁）：
```ts
constructor(
  private readonly bidService: BidService,
  private readonly scorePointExtractor: ScorePointExtractorService,
  // ... 其他现有依赖
) {}
```

在 point CRUD 端点之后（约 `bid.controller.ts:229` 后）加：
```ts
  @Post('projects/:id/score-items/:itemId/points/extract')
  @ApiOperation({ summary: 'AI 从招标文件提取得分点建议（同步，不落库）' })
  extractScorePoints(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.scorePointExtractor.extractScorePoints(id, itemId);
  }
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter api exec tsc --noEmit
```
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bid/bid.controller.ts
git commit -m "feat(api): AI 提取得分点建议端点

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: batch 导入 service + 端点 + DTO（TDD）

**Files:**
- Create: `apps/api/src/bid/dto/batch-create-score-points.dto.ts`
- Modify: `apps/api/src/bid/bid.service.ts`
- Modify: `apps/api/src/bid/bid.service.spec.ts`
- Modify: `apps/api/src/bid/bid.controller.ts`

**Interfaces:**
- Consumes: `assertScoreItemInProject`（phase ① 已有）
- Produces: `BidService.batchCreateScorePoints(projectId, itemId, dto)` + `POST .../points/batch`

- [ ] **Step 1: 创建 DTO `batch-create-score-points.dto.ts`**

```ts
import { IsArray, ValidateNested, IsString, IsNotEmpty, IsNumber, Min, Max, IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ScorePointInputDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  fullScore: number;

  @IsString()
  @IsOptional()
  evidenceHint?: string;

  @IsBoolean()
  @IsOptional()
  objective?: boolean;
}

export class BatchCreateScorePointsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScorePointInputDto)
  points: ScorePointInputDto[];
}
```

- [ ] **Step 2: 写失败测试（加到 `bid.service.spec.ts` 的"得分点管理"describe 块）**

```ts
it('batchCreateScorePoints 批量创建并校验阶段锁', async () => {
  // SUBMIT 阶段放行
  prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', project: { stage: 'SUBMIT' } });
  prisma.bidScorePoint.createMany.mockResolvedValue({ count: 2 });
  const r = await service.batchCreateScorePoints('p1', 'i1', {
    points: [
      { name: '点A', fullScore: 5 },
      { name: '点B', fullScore: 3, objective: false },
    ],
  });
  expect(r).toEqual({ count: 2 });
  expect(prisma.bidScorePoint.createMany).toHaveBeenCalledWith({
    data: [
      { scoreItemId: 'i1', name: '点A', fullScore: 5, evidenceHint: null, objective: true },
      { scoreItemId: 'i1', name: '点B', fullScore: 3, evidenceHint: null, objective: false },
    ],
  });
});

it('batchCreateScorePoints EVALUATING 阶段锁定抛错', async () => {
  prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', project: { stage: 'EVALUATING' } });
  await expect(service.batchCreateScorePoints('p1', 'i1', { points: [{ name: 'x', fullScore: 1 }] })).rejects.toThrow();
  expect(prisma.bidScorePoint.createMany).not.toHaveBeenCalled();
});
```

> 注意：`assertScoreItemInProject` 内部用 `prisma.bidScoreItem.findFirst`（含 `project.stage`），上面的 mock 已覆盖。若 spec 的 prisma mock 没有 `bidScorePoint.createMany`，在 mock 对象里补上。

- [ ] **Step 3: 运行测试，确认失败**

```bash
pnpm --filter api test -- bid.service.spec.ts
```
Expected: 2 个新 case FAIL（`batchCreateScorePoints` 未定义）。若 prisma mock 缺 `createMany`，先补 mock。

- [ ] **Step 4: 实现 `bid.service.ts` 的 `batchCreateScorePoints`**

在 `deleteScorePoint` 方法后加：

```ts
async batchCreateScorePoints(projectId: string, itemId: string, dto: BatchCreateScorePointsDto) {
  await this.assertScoreItemInProject(projectId, itemId);
  return this.prisma.bidScorePoint.createMany({
    data: dto.points.map((p) => ({
      scoreItemId: itemId,
      name: p.name,
      fullScore: p.fullScore,
      evidenceHint: p.evidenceHint ?? null,
      objective: p.objective ?? true,
    })),
  });
}
```

顶部 import 加：
```ts
import { BatchCreateScorePointsDto } from './dto/batch-create-score-points.dto';
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
pnpm --filter api test -- bid.service.spec.ts
```
Expected: 全部 PASS（含原有 + 2 个新 case）。

- [ ] **Step 6: controller 加 batch 端点**

`bid.controller.ts` import 加：
```ts
import { BatchCreateScorePointsDto } from './dto/batch-create-score-points.dto';
```

在 extract 端点后加：
```ts
  @Post('projects/:id/score-items/:itemId/points/batch')
  @ApiOperation({ summary: '批量导入得分点（管理员审核 AI 建议后）' })
  batchCreateScorePoints(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(BatchCreateScorePointsDto) dto: BatchCreateScorePointsDto,
  ) {
    return this.bidService.batchCreateScorePoints(id, itemId, dto);
  }
```

> 注：phase ① Task 5 已确认本仓库 `@Body()` 不传 DTO class（TS2769），用全局 ValidationPipe 按 metatype 校验。这里 `@Body(BatchCreateScorePointsDto)` 同理改为 `@Body() dto: BatchCreateScorePointsDto`。

- [ ] **Step 7: 编译验证**

```bash
pnpm --filter api exec tsc --noEmit
```
Expected: 无报错。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/bid/dto/batch-create-score-points.dto.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts apps/api/src/bid/bid.controller.ts
git commit -m "feat(api): 得分点批量导入端点 + DTO

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 前端 API client

**Files:**
- Modify: `apps/bid-portal/src/lib/api/bid.ts`

**Interfaces:**
- Consumes: Task 2/3 的端点
- Produces: `extractScorePoints(projectId, itemId)` + `batchCreateScorePoints(projectId, itemId, points)`

- [ ] **Step 1: 在 `bid.ts` 加类型 + 两个函数（在 `deleteScorePoint` 后）**

```ts
export interface ScorePointSuggestion {
  name: string;
  fullScore: number;
  evidenceHint: string;
  objective: boolean;
}

export function extractScorePoints(projectId: string, itemId: string) {
  return api.post<ScorePointSuggestion[]>(`/bid/projects/${projectId}/score-items/${itemId}/points/extract`, {});
}
export function batchCreateScorePoints(
  projectId: string,
  itemId: string,
  points: Array<{ name: string; fullScore: number; evidenceHint?: string; objective?: boolean }>,
) {
  return api.post<{ count: number }>(`/bid/projects/${projectId}/score-items/${itemId}/points/batch`, { points });
}
```

- [ ] **Step 2: 类型检查**

```bash
pnpm --filter bid-portal exec tsc --noEmit
```
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add apps/bid-portal/src/lib/api/bid.ts
git commit -m "feat(bid-portal): 得分点 AI 提取 + 批量导入 API client

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 前端 UI — AI 提取按钮 + 审核弹窗

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx`

**Interfaces:**
- Consumes: Task 4 的 `extractScorePoints` + `batchCreateScorePoints`；现有 `onChanged`
- Produces: 编辑器内"AI 提取建议"按钮 → 加载建议 → 弹窗可勾选/编辑 → 确认后批量导入并刷新。

- [ ] **Step 1: 在 `score-points-editor.tsx` 加 AI 提取状态 + 处理**

顶部 import 加：
```ts
import { extractScorePoints, batchCreateScorePoints, type ScorePointSuggestion } from '@/lib/api/bid';
import { Sparkles, X } from 'lucide-react';
```

在组件内（`busy` state 旁）加：
```ts
const [extracting, setExtracting] = useState(false);
const [suggestions, setSuggestions] = useState<(ScorePointSuggestion & { selected: boolean })[] | null>(null);
const [extractError, setExtractError] = useState<string | null>(null);

async function handleExtract() {
  setExtracting(true);
  setExtractError(null);
  try {
    const list = await extractScorePoints(projectId, item.id);
    setSuggestions(list.map((s) => ({ ...s, selected: true })));
    if (list.length === 0) setExtractError('AI 未从招标文件提取到得分点建议。');
  } catch (e: any) {
    setExtractError(e?.message ?? 'AI 提取失败，请检查招标文件是否已发布。');
  } finally {
    setExtracting(false);
  }
}

async function handleImportSelected() {
  const picked = (suggestions ?? []).filter((s) => s.selected);
  if (picked.length === 0) { setSuggestions(null); return; }
  await batchCreateScorePoints(projectId, item.id, picked);
  setSuggestions(null);
  onChanged();
}
```

- [ ] **Step 2: 在编辑器顶部（合计提示旁）加"AI 提取建议"按钮**

在现有合计 `{!isPassFail && (...)}` 块旁加：
```tsx
<button
  onClick={handleExtract}
  disabled={extracting}
  className="flex items-center gap-1 rounded-lg border border-[oklch(0.85_0.02_260)] bg-white px-2.5 py-1 text-xs text-[oklch(0.35_0.03_258)] disabled:opacity-50"
  title="从招标文件自动提取得分条款建议"
>
  <Sparkles size={13} /> {extracting ? '提取中…' : 'AI 提取建议'}
</button>
{extractError && <span className="text-xs text-red-600">{extractError}</span>}
```

- [ ] **Step 3: 加审核弹窗（建议列表，可勾选/编辑）**

在组件 return 的末尾（闭合 `</div>` 前）加：
```tsx
{suggestions && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
    <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">AI 提取得分点建议（来自招标文件）</h3>
        <button onClick={() => setSuggestions(null)} className="text-[oklch(0.6_0.01_264)] hover:text-red-600"><X size={16} /></button>
      </div>
      <div className="max-h-80 space-y-1.5 overflow-y-auto">
        {suggestions.map((s, idx) => (
          <div key={idx} className="flex items-center gap-2 rounded-lg border border-[oklch(0.92_0.004_265)] px-2 py-1.5 text-sm">
            <input type="checkbox" checked={s.selected} onChange={() => setSuggestions((prev) => prev!.map((p, i) => i === idx ? { ...p, selected: !p.selected } : p))} />
            <input
              className="flex-1 rounded border border-[oklch(0.9_0.005_264)] px-1.5 py-0.5"
              value={s.name}
              onChange={(e) => setSuggestions((prev) => prev!.map((p, i) => i === idx ? { ...p, name: e.target.value } : p))}
            />
            <input
              type="number" min={0} step={0.5} className="w-16 rounded border border-[oklch(0.9_0.005_264)] px-1 py-0.5 text-right"
              value={s.fullScore}
              onChange={(e) => setSuggestions((prev) => prev!.map((p, i) => i === idx ? { ...p, fullScore: Number(e.target.value) } : p))}
            />
            <button
              onClick={() => setSuggestions((prev) => prev!.map((p, i) => i === idx ? { ...p, objective: !p.objective } : p))}
              className={`rounded px-1.5 py-0.5 text-xs ${s.objective ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}
            >{s.objective ? '客观' : '主观'}</button>
            <span className="max-w-[120px] truncate text-xs text-[oklch(0.55_0.01_264)]" title={s.evidenceHint}>{s.evidenceHint}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={() => setSuggestions(null)} className="rounded-lg px-3 py-1 text-sm text-[oklch(0.5_0.01_264)]">取消</button>
        <button onClick={handleImportSelected} className="rounded-lg bg-[oklch(0.55_0.18_258)] px-3 py-1 text-sm text-white">导入选中的 {suggestions.filter((s) => s.selected).length} 项</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: 类型检查 + 手动验证**

```bash
pnpm --filter bid-portal exec tsc --noEmit
```
Expected: 无报错。手动验证（开 `http://localhost:3007/bid/project/<id>?tab=standard`，展开一个评分项，点"AI 提取建议"）由 controller/human 完成。

- [ ] **Step 5: Commit**

```bash
git add apps/bid-portal/src/app/\(dashboard\)/bid/standard/score-points-editor.tsx
git commit -m "feat(bid-portal): 得分点 AI 提取建议按钮 + 审核弹窗

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review 结论

- **Spec 覆盖**：Task 9 大纲 7 点全覆盖 —— 招标文件来源（Task 1 PlaintextFetcher）、LLM 解析（Task 1 chatJson+retryChatJson）、extract 端点（Task 2）、batch 导入端点（Task 3）、UI（Task 5）、边界"不回填 scoringCriteria"（Task 1 只返回建议不落库）。✅
- **Placeholder 扫描**：Task 1 Step 2 测试 mock 用了 `jest.mock(file-processor)`（标注清楚）；Task 3 Step 6 的 `@Body()` 已按 phase ① 经验改为不传 class。无 TBD。✅
- **类型一致**：`ScorePointSuggestion` 在 service（Task 1）、controller（Task 2）、API client（Task 4）、UI（Task 5）字段一致（name/fullScore/evidenceHint/objective）。batch 导入的 DTO `ScorePointInputDto` 与之兼容（evidenceHint/objective optional）。✅
- **风险点**：Task 1 Step 5 的 `AiBidAnalysisModule` import 若引发循环依赖/queue 冲突，计划已给出 STOP + 替代方案（内联 fetch 逻辑）。执行时第一个验证点。
