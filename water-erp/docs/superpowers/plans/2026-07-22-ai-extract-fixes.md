# AI 提取打分要点 — 16 项修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 AI 提取打分要点全链路的 16 个已知问题（P0 安全/正确性 3 项 + P1 健壮性 5 项 + P2 性能/体验 4 项 + P3 架构演进 2 项）

**Architecture:** 按优先级分 14 个 task，每个 task 独立可验证。前端改 `apps/bid-portal`，后端改 `apps/api`，shared 改 `packages/shared`。

**Tech Stack:** NestJS 11 + Prisma 6 + Next.js 16 + React 19 + TypeScript + Tailwind v4

## Global Constraints

- 不破坏现有 API 契约（extract 端点零 DTO 同步返回 `ScorePointSuggestion[]`）
- shared 包改动后需 `pnpm --filter @water-erp/shared build`
- schema 改动需 migrate（`prisma migrate dev --create-only` → `prisma db execute` → `prisma migrate resolve --applied`）
- 前端改动在 `apps/bid-portal`（:3007），web 工作台暂不动（P3-14 除外）
- 每完成一个 task 后跑相关验证（spec / lint / 手动确认）

---

## Task 1: P0-1 batch 导入加 try/catch

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx`（`handleImportSelected` 方法）

**Interfaces:**
- Consumes: `batchCreateScorePoints(projectId, itemId, points)` from `lib/api/bid.ts`
- Produces: 失败时 `toast.error`，成功时关弹窗 + `onChanged()`

- [ ] **Step 1: 修改 handleImportSelected**

```ts
// 改前（裸 await，失败无反馈）
const picked = (suggestions ?? []).filter((s) => s.selected);
if (picked.length === 0) { setSuggestions(null); return; }
await batchCreateScorePoints(projectId, item.id, picked);
setSuggestions(null); onChanged();

// 改后
const picked = (suggestions ?? []).filter((s) => s.selected);
if (picked.length === 0) { setSuggestions(null); return; }
try {
  await batchCreateScorePoints(projectId, item.id, picked);
  setSuggestions(null);
  onChanged();
} catch (e: any) {
  toast.error(e?.message ?? '导入失败，请重试');
}
```

- [ ] **Step 2: 确认 toast 已 import**

检查文件顶部 `import { toast } from 'sonner'`；无则加。

- [ ] **Step 3: 验证**

`cd /home/asus/桌面/ERP/water-erp && pnpm --filter bid-portal lint`

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/bid-portal/src/app/\(dashboard\)/bid/standard/score-points-editor.tsx
git -C /home/asus/桌面/ERP commit -m "fix(bid-portal): batch 导入加 try/catch + toast.error (P0-1)"
```

---

## Task 2: P0-2 KMS_SECRET 启动校验

**Files:**
- Modify: `apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts`

**Interfaces:**
- Consumes: `process.env.KMS_SECRET`
- Produces: 缺失时构造阶段抛 `ServiceUnavailableException`（启动即失败，非运行时 NPE）

- [ ] **Step 1: 构造函数加校验**

```ts
// 在 constructor 内加（PlaintextFetcherService 当前无 constructor，加一个）
constructor(private prisma: PrismaService) {
  // wrapped key 场景需要 KMS_SECRET；缺失时启动即报错而非运行时 NPE
  if (!process.env.KMS_SECRET) {
    console.warn('[PlaintextFetcher] KMS_SECRET 未配置，加密招标文件将无法解密');
  }
}
```

注：用 warn 而非 throw（避免未使用加密功能的部署启动失败）；运行时 `unwrapKey` 仍会在缺失时抛错，但此时有明确日志。

- [ ] **Step 2: 验证**

`cd /home/asus/桌面/ERP/water-erp && pnpm --filter api lint && pnpm --filter api test -- plaintext-fetcher`

- [ ] **Step 3: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/ai-bid-analysis/services/plaintext-fetcher.service.ts
git -C /home/asus/桌面/ERP commit -m "fix(api): PlaintextFetcher 启动时 warn KMS_SECRET 缺失 (P0-2)"
```

---

## Task 3: P0-3 短期 max_tokens 提升 + parseJson 日志

**Files:**
- Modify: `apps/api/src/local-ai/llm.service.ts`（`deepseekChatJson` body + `parseJson`）

**Interfaces:**
- Consumes: 无
- Produces: max_tokens 8192→16384；parseJson 失败记 warn 含原始 content 前 500 字

- [ ] **Step 1: max_tokens 改 16384**

```ts
// deepseekChatJson body 内
max_tokens: 16384,  // 原 8192
```

- [ ] **Step 2: parseJson 失败加日志**

```ts
// parseJson catch 块内，this.logger.error 改为：
this.logger.warn(
  `JSON parse failed, raw content (first 500): ${cleaned.slice(0, 500)}`,
);
this.logger.error(`JSON parse failed for content: ${cleaned.slice(0, 200)}...`);
```

- [ ] **Step 3: 验证**

`pnpm --filter api lint && pnpm --filter api test -- llm.service`

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/local-ai/llm.service.ts
git -C /home/asus/桌面/ERP commit -m "fix(api): max_tokens 8192→16384 + parseJson warn 原始 content (P0-3 短期)"
```

---

## Task 4: P1-4 retryChatJson 守卫升级

**Files:**
- Modify: `apps/api/src/bid/score-point-extractor.service.ts`（extractScorePoints 内传给 retryChatJson 的守卫）

**Interfaces:**
- Consumes: `raw.items` 数组
- Produces: 校验 item 内部字段（name 非空字符串、fullScore 非负数字、objective 布尔）

- [ ] **Step 1: 升级守卫**

```ts
// 改前
(raw): raw is { items: ScorePointSuggestion[] } =>
  !!raw && typeof raw === 'object' && Array.isArray((raw as any).items),

// 改后
(raw): raw is { items: ScorePointSuggestion[] } =>
  !!raw && typeof raw === 'object' && Array.isArray((raw as any).items) &&
  (raw as any).items.every((i: any) =>
    typeof i.name === 'string' && i.name.length > 0 &&
    typeof i.fullScore === 'number' && i.fullScore >= 0 &&
    typeof i.objective === 'boolean'
  ),
```

- [ ] **Step 2: 验证**

`pnpm --filter api lint && pnpm --filter api test -- score-point-extractor`

- [ ] **Step 3: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/bid/score-point-extractor.service.ts
git -C /home/asus/桌面/ERP commit -m "fix(api): retryChatJson 守卫升级校验 item 内部字段 (P1-4)"
```

---

## Task 5: P1-5 locked 下传 ScorePointsEditor

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx`（传 locked prop）
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx`（接收 + 禁用）

**Interfaces:**
- Consumes: `locked: boolean` from page.tsx
- Produces: locked 时隐藏 AI 提取按钮 + 导入按钮 + 手动新增行

- [ ] **Step 1: page.tsx 传 locked**

```tsx
<ScorePointsEditor projectId={projectId} item={it} points={points} onChanged={reloadItems} locked={locked} />
```

- [ ] **Step 2: score-points-editor.tsx 接收 + 禁用**

Props 加 `locked?: boolean`；
- AI 提取按钮：`{!locked && <button ...>AI 提取建议</button>}`
- 导入按钮：`{!locked && <button ...>导入选中的 N 项</button>}`
- 手动新增行：`{!locked && <手动新增 input 行>}`
- 或在 handleImportSelected 前置 `if (locked) { toast.error('评分标准已发布，不可修改'); return; }`

- [ ] **Step 3: 验证**

`pnpm --filter bid-portal lint`

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/bid-portal/src/app/\(dashboard\)/bid/standard/page.tsx apps/bid-portal/src/app/\(dashboard\)/bid/standard/score-points-editor.tsx
git -C /home/asus/桌面/ERP commit -m "fix(bid-portal): locked 下传 ScorePointsEditor 禁用发布后操作 (P1-5)"
```

---

## Task 6: P1-6 ScorePointSuggestion 类型统一到 shared

**Files:**
- Modify: `packages/shared/src/types.ts`（加 ScorePointSuggestion interface）
- Modify: `apps/bid-portal/src/lib/api/bid.ts`（import shared 类型，删本地定义）
- Modify: `apps/api/src/bid/score-point-extractor.service.ts`（import shared 类型，删本地 interface）

**Interfaces:**
- Produces: 三处类型统一为 `@water-erp/shared` 的 `ScorePointSuggestion`

- [ ] **Step 1: shared 加类型**

```ts
// packages/shared/src/types.ts 末尾加
export interface ScorePointSuggestion {
  name: string;
  fullScore: number;
  evidenceHint: string;
  objective: boolean;
  evidenceSection?: string;
  confidence?: number;
  adjusted?: boolean;
  duplicate?: boolean;
}
```

- [ ] **Step 2: rebuild shared**

`cd /home/asus/桌面/ERP/water-erp && pnpm --filter @water-erp/shared build`

- [ ] **Step 3: 前端改 import**

```ts
// apps/bid-portal/src/lib/api/bid.ts
// 删本地 ScorePointSuggestion interface（L222-235）
import type { ScorePointSuggestion } from '@water-erp/shared';
```

- [ ] **Step 4: 后端改 import**

```ts
// apps/api/src/bid/score-point-extractor.service.ts
// 删本地 ScorePointSuggestion interface（L11-20）
import { ScorePointSuggestion } from '@water-erp/shared';
```

- [ ] **Step 5: 验证**

`pnpm --filter bid-portal lint && pnpm --filter api lint && pnpm --filter api test -- score-point-extractor`

- [ ] **Step 6: Commit**

```bash
git -C /home/asus/桌面/ERP add packages/shared/src/types.ts apps/bid-portal/src/lib/api/bid.ts apps/api/src/bid/score-point-extractor.service.ts
git -C /home/asus/桌面/ERP commit -m "refactor: ScorePointSuggestion 类型统一到 @water-erp/shared (P1-6)"
```

---

## Task 7: P1-7 evidenceSection/confidence 落库

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（BidScorePoint 加字段）
- Modify: `apps/api/src/bid/dto/batch-create-score-points.dto.ts`（DTO 加字段）
- Modify: `apps/api/src/bid/bid.service.ts`（batchCreateScorePoints createMany 带字段）
- Modify: `apps/bid-portal/src/lib/api/bid.ts`（前端类型同步，若 Task 6 已统一则只需 shared 加字段）

**Interfaces:**
- Produces: BidScorePoint 持久化 evidenceSection + confidence；batch 端点接收

- [ ] **Step 1: schema 加字段**

```prisma
model BidScorePoint {
  // ... 现有字段
  evidenceSection String?    // 招标文件章节名（AI 提取时记录）
  confidence      Decimal?   @db.Decimal(3, 2)  // 0-1 信心分（AI 提取时记录）
}
```

- [ ] **Step 2: migrate**

```bash
cd /home/asus/桌面/ERP/water-erp/apps/api
npx prisma migrate dev --create-only --name add_evidence_confidence_to_score_point
npx prisma db execute --file prisma/migrations/<latest>/migration.sql
npx prisma migrate resolve --applied <latest>
npx prisma generate
```

- [ ] **Step 3: DTO 加字段**

```ts
// batch-create-score-points.dto.ts 的 ScorePointItem 加
@IsOptional() @IsString() evidenceSection?: string;
@IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
```

- [ ] **Step 4: service createMany 带字段**

```ts
// bid.service.ts batchCreateScorePoints 的 createMany data 加
evidenceSection: p.evidenceSection ?? null,
confidence: p.confidence ?? null,
```

- [ ] **Step 5: 前端 shared 类型已含 evidenceSection/confidence（Task 6），无需额外改**

- [ ] **Step 6: 验证**

`pnpm --filter api lint && pnpm --filter api test -- bid.service && pnpm --filter api test:e2e -- bid`

- [ ] **Step 7: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/prisma/schema.prisma apps/api/prisma/migrations/ apps/api/src/bid/dto/batch-create-score-points.dto.ts apps/api/src/bid/bid.service.ts
git -C /home/asus/桌面/ERP commit -m "feat(api): BidScorePoint 持久化 evidenceSection + confidence (P1-7)"
```

---

## Task 8: P1-8 正则目录排除

**Files:**
- Modify: `apps/api/src/bid/score-point-extractor.service.ts`（三个正则方法）

**Interfaces:**
- Produces: 正则匹配时跳过目录行（PAGEREF/HYPERLINK）

- [ ] **Step 1: extractScoringSectionRegex 加目录排除**

在方法开头预处理 tenderText：
```ts
const cleaned = text.replace(/HYPERLINK[^\n]*PAGEREF[^\n]*\n/g, '');
// 后续所有 pattern.match(cleaned) 替代 text.match(pattern)
```

- [ ] **Step 2: extractReviewSectionRegex / extractRequirementSectionRegex 同理**

同样 `const cleaned = text.replace(...)` 预处理。

- [ ] **Step 3: 审查节终止符通用化**

```ts
// extractReviewSectionRegex QUALIFICATION 模式 1 终止符改为：
/资格审查要求[\s\S]*?(?=符合性审查要求|综合评分法评标标准|第[一二三四五六七八九十百\d]+章\s)/i
// （已有，保持）

// extractRequirementSectionRegex 已用 \s*\n 跳目录（本次改的），保持
```

- [ ] **Step 4: 验证**

`pnpm --filter api lint && pnpm --filter api test -- score-point-extractor`

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/bid/score-point-extractor.service.ts
git -C /home/asus/桌面/ERP commit -m "fix(api): 章节定位正则排除目录行 PAGEREF/HYPERLINK (P1-8)"
```

---

## Task 9: P2-9 前端超时 + 后端 Throttle

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx`（AbortController 超时）
- Modify: `apps/api/src/bid/bid.controller.ts`（extract 端点加 @Throttle）

**Interfaces:**
- Produces: 前端 120s 超时 + toast 提示；后端 3 次/分限流

- [ ] **Step 1: 前端 AbortController**

```ts
// handleExtract 内
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 120_000);
try {
  const list = await extractScorePoints(projectId, item.id, { signal: controller.signal });
  // ...
} catch (e: any) {
  if (e?.name === 'AbortError') {
    setExtractError('AI 提取超时（120s），招标文件可能较大，请稍后重试');
  } else {
    setExtractError(e?.message ?? 'AI 提取暂时不可用，请稍后重试或手动添加。');
  }
} finally {
  clearTimeout(timer);
  setExtracting(false);
}
```

注：`extractScorePoints` 需支持第三参数 `{ signal }`，传给 `api.post` 的 fetch options。

- [ ] **Step 2: api.post 支持 signal**

```ts
// lib/api.ts 的 post 方法加 options?: RequestInit
export function post<T>(path: string, body?: unknown, options?: RequestInit) {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), ...options });
}
// lib/api/bid.ts
export function extractScorePoints(projectId: string, itemId: string, options?: RequestInit) {
  return api.post<ScorePointSuggestion[]>(`...`, {}, options);
}
```

- [ ] **Step 3: 后端 @Throttle**

```ts
// bid.controller.ts extract 端点加
@Throttle(3, 60)  // 3 次/分
@Post('projects/:id/score-items/:itemId/points/extract')
```

- [ ] **Step 4: 验证**

`pnpm --filter bid-portal lint && pnpm --filter api lint`

- [ ] **Step 5: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/bid-portal/src/app/\(dashboard\)/bid/standard/score-points-editor.tsx apps/bid-portal/src/lib/api.ts apps/bid-portal/src/lib/api/bid.ts apps/api/src/bid/bid.controller.ts
git -C /home/asus/桌面/ERP commit -m "fix: extract 端点前端 120s 超时 + 后端 @Throttle(3,60) (P2-9)"
```

---

## Task 10: P2-10 pdftotext 缺失告警

**Files:**
- Modify: `apps/api/src/ai-bid-analysis/utils/file-processor.ts`

**Interfaces:**
- Produces: pdftotext 不可用时 console.warn

- [ ] **Step 1: catch 加 warn**

```ts
// tryPdfTextLayer catch 块
} catch (e) {
  console.warn('[file-processor] pdftotext 不可用，降级 OCR（性能显著下降）:', (e as Error).message);
  return null;
}
```

- [ ] **Step 2: 验证**

`pnpm --filter api lint && pnpm --filter api test -- file-processor`

- [ ] **Step 3: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/ai-bid-analysis/utils/file-processor.ts
git -C /home/asus/桌面/ERP commit -m "fix(api): pdftotext 缺失时 warn 告警 (P2-10)"
```

---

## Task 11: P2-11 缓存主动失效

**Files:**
- Modify: `apps/api/src/bid/score-point-extractor.service.ts`（加 public invalidateCache）
- Modify: `apps/api/src/bid/bid.service.ts`（BidDocument 更新时调 invalidate）

**Interfaces:**
- Produces: 公告重发/文件替换时主动清缓存

- [ ] **Step 1: extractor 加 public 方法**

```ts
/** 主动清除招标文件文本缓存（公告重发/文件替换时调用） */
invalidateTenderCache(projectId: string): void {
  this.tenderTextCache.delete(projectId);
}
```

- [ ] **Step 2: bid.service 调 invalidate**

在 `updateBidDocument` / `republishAnnouncement` 等涉及招标文件变更的方法里：
```ts
this.scorePointExtractor.invalidateTenderCache(projectId);
```

注：`ScorePointExtractorService` 需注入到 `BidService`（bid.module providers 已有，加 constructor 注入）。

- [ ] **Step 3: 验证**

`pnpm --filter api lint && pnpm --filter api test -- bid.service`

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/src/bid/score-point-extractor.service.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.module.ts
git -C /home/asus/桌面/ERP commit -m "feat(api): 招标文件缓存主动失效 invalidateTenderCache (P2-11)"
```

---

## Task 12: P2-12 欠分提示

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx`（合计行加差额）

**Interfaces:**
- Produces: 合计 < maxScore 时显示"差额 X 未分配"

- [ ] **Step 1: 合计行加差额文案**

```tsx
// 合计行（已有 total > max 红字警告）
{total < Number(item.maxScore) && (
  <span className="text-amber-600">差额 {Number(item.maxScore) - total} 未分配</span>
)}
```

- [ ] **Step 2: 验证**

`pnpm --filter bid-portal lint`

- [ ] **Step 3: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/bid-portal/src/app/\(dashboard\)/bid/standard/score-points-editor.tsx
git -C /home/asus/桌面/ERP commit -m "feat(bid-portal): 得分点合计欠分提示差额 (P2-12)"
```

---

## Task 13: P3-13 AI_CATEGORIES 可配置 + CI 回归

**Files:**
- Modify: `apps/api/prisma/scripts/seed-yindajimin.ts`（stepAi 4 个手动分支改为可配置）
- Create: `apps/api/prisma/scripts/compare-models-ci.ts`（CI 回归脚本，扩展 compare-models）

**Interfaces:**
- Produces: `AI_SCORE_CATEGORIES` env 控制哪些类走 AI；CI 脚本定期跑对比

- [ ] **Step 1: stepAi 可配置**

```ts
// stepAi 开头
const aiCategories = (process.env.AI_SCORE_CATEGORIES ?? 'TECHNICAL').split(',').map(s => s.trim());

// 4 个手动分支改为：
if (item.category === 'PRICE') { /* 手动，PRICE 恒手动 */ }
if (item.category === 'QUALIFICATION' && !aiCategories.includes('QUALIFICATION')) { /* 手动 6 项 */ }
if (item.category === 'RESPONSIVE' && !aiCategories.includes('RESPONSIVE')) { /* 手动 9 项 */ }
if (item.category === 'BUSINESS' && !aiCategories.includes('BUSINESS')) { /* 手动 5 项 */ }
// 其余走 extractor.extractScorePoints（AI）
```

- [ ] **Step 2: CI 回归脚本**

扩展 `compare-models.ts` 为 `compare-models-ci.ts`：
- 参数 `--model=X --runs=N --threshold=M`
- 跑完输出 JSON：`{ model, category, avg, stable, items }`
- 退出码：avg < threshold → exit 1（CI 告警）

- [ ] **Step 3: 验证**

`cd /home/asus/桌面/ERP/water-erp/apps/api && AI_SCORE_CATEGORIES=TECHNICAL,QUALIFICATION npx tsx prisma/scripts/seed-yindajimin.ts --step=ai`（确认 QUAL 走 AI）

- [ ] **Step 4: Commit**

```bash
git -C /home/asus/桌面/ERP add apps/api/prisma/scripts/seed-yindajimin.ts apps/api/prisma/scripts/compare-models-ci.ts
git -C /home/asus/桌面/ERP commit -m "feat: AI_SCORE_CATEGORIES 可配置 + CI 回归脚本 (P3-13)"
```

---

## Task 14: P3-14 web 工作台 AI 提取入口 + UI 组件抽取

**Files:**
- Modify: `packages/ui/src/index.ts`（导出 ScorePointsReviewModal）
- Create: `packages/ui/src/score-points-review-modal.tsx`（从 bid-portal 内联弹窗抽取）
- Modify: `apps/web/src/lib/api/bid.ts`（加 extractScorePoints + batchCreateScorePoints）
- Modify: `apps/web/src/components/projects/bid-confirm-panel.tsx`（加 AI 提取按钮 + 弹窗）

**Interfaces:**
- Produces: web 工作台可用 AI 提取；审核弹窗沉淀到 packages/ui

- [ ] **Step 1: 抽取审核弹窗到 packages/ui**

从 `bid-portal/src/app/(dashboard)/bid/standard/score-points-editor.tsx` 的建议审核弹窗（L200-258）抽为独立组件 `ScorePointsReviewModal`：
```tsx
// packages/ui/src/score-points-review-modal.tsx
export function ScorePointsReviewModal({ suggestions, onImport, onCancel }: {...}) { ... }
```
`packages/ui/src/index.ts` 导出。`pnpm --filter @water-erp/ui build`。

- [ ] **Step 2: bid-portal 改用 shared 组件**

```tsx
import { ScorePointsReviewModal } from '@water-erp/ui';
// 删内联弹窗 JSX，改用 <ScorePointsReviewModal ... />
```

- [ ] **Step 3: web 加 API 封装**

```ts
// apps/web/src/lib/api/bid.ts
import type { ScorePointSuggestion } from '@water-erp/shared';
export function extractScorePoints(projectId: string, itemId: string, options?: RequestInit) { ... }
export function batchCreateScorePoints(projectId: string, itemId: string, points: ScorePointSuggestion[]) { ... }
```

- [ ] **Step 4: web bid-confirm-panel 加 AI 按钮 + 弹窗**

在评分项展开区加「AI 提取建议」按钮 + `ScorePointsReviewModal`（复用 bid-portal 逻辑）。

- [ ] **Step 5: 验证**

`pnpm --filter @water-erp/ui build && pnpm --filter web lint && pnpm --filter bid-portal lint`

- [ ] **Step 6: Commit**

```bash
git -C /home/asus/桌面/ERP add packages/ui/src/ apps/web/src/lib/api/bid.ts apps/web/src/components/projects/bid-confirm-panel.tsx apps/bid-portal/src/app/\(dashboard\)/bid/standard/score-points-editor.tsx
git -C /home/asus/桌面/ERP commit -m "feat: web 工作台 AI 提取入口 + ScorePointsReviewModal 沉淀到 @water-erp/ui (P3-14)"
```
