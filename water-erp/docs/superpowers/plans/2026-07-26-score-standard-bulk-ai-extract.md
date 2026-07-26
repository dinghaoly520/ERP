# 评分标准编制：模板按钮合并 + 一键 AI 提取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 :3005「评分标准编制」面板的「应用标准模板」「模板库」合并为单一「应用模板」入口（内置标准模板置顶），并新增一键「AI 提取」按钮，一次性提取全部评分项的得分点建议、分组审核后批量导入。

**Architecture:** 后端在 `ScorePointExtractorService` 新增 `extractAllScorePoints`，预取一次招标文件文本后顺序复用现有单项 `extractScorePoints`（缓存 + LLM 信号量已就绪），新端点 `POST /bid/projects/:id/score-items/points/extract-all` 返回按评分项分组的建议。前端抽共享 `SuggestionRow` 组件供单项弹窗与新的分组审核弹窗复用；模板合并为纯前端改造，复用两个现有后端端点。

**Tech Stack:** NestJS 11 + Jest（api）；React 19 + Next.js 16 + Tailwind v4（web）；`@water-erp/shared` 共享类型（tsc 编译到 dist）。

## Global Constraints

- UI 文案全部中文，沿用现有按钮样式与色值（蓝 `#064ea2`、绿 `#11a874`、边框 `#dce6f3`）。
- 改 `packages/shared` 后必须 `pnpm --filter @water-erp/shared build`，否则消费方读到旧 dist。
- 不新增 LLM 直连调用——全部复用现有 `LlmService`/`ScorePointExtractorService` 链路。
- 不引入新依赖；不动 `--webpack`（dev 走 Turbopack）。
- 每次 commit 前 `git branch --show-current` 确认分支（多会话共库）；**不要 push**，commit 后只提醒未推送数量。
- 命令均从 `/home/asus/桌面/ERP/water-erp` 执行。
- Spec: `water-erp/docs/superpowers/specs/2026-07-26-score-standard-bulk-ai-extract-design.md`。

---

### Task 1: shared — 新增 `ScorePointSuggestionGroup` 类型

**Files:**
- Modify: `packages/shared/src/types.ts`（`ScorePointSuggestion` 定义之后，约 :150）

**Interfaces:**
- Produces: `ScorePointSuggestionGroup`（Task 2 后端返回值、Task 5 前端消费）

- [ ] **Step 1: 在 `packages/shared/src/types.ts` 的 `ScorePointSuggestion` 接口后追加**

```ts
/** 一键 AI 提取：按评分项分组的得分点建议（extract-all 端点返回） */
export interface ScorePointSuggestionGroup {
  itemId: string;
  itemName: string;
  category: string; // ScoreCategory 联合，与 BidScoreItem.category 保持一致用 string
  maxScore: number;
  suggestions: ScorePointSuggestion[];
}
```

- [ ] **Step 2: 构建 shared 包**

Run: `pnpm --filter @water-erp/shared build`
Expected: 成功；`packages/shared/dist/types.d.ts` 含 `ScorePointSuggestionGroup`（`grep ScorePointSuggestionGroup packages/shared/dist/types.d.ts` 有输出）。

- [ ] **Step 3: 确认两个消费方类型不破**

Run: `pnpm --filter api exec tsc --noEmit && pnpm --filter web exec tsc --noEmit`
Expected: 均无输出（退出码 0）。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/dist
git commit -m "feat(shared): 新增 ScorePointSuggestionGroup 类型"
```

> 注：`dist/` 是否入库以仓库现状为准（`git ls-files packages/shared/dist | head -1` 有输出才 add dist）。

---

### Task 2: api — `extractAllScorePoints` + extract-all 路由（TDD）

**Files:**
- Modify: `apps/api/src/bid/score-point-extractor.service.spec.ts`（扩充 prisma mock + 新 describe）
- Modify: `apps/api/src/bid/score-point-extractor.service.ts`（新方法）
- Modify: `apps/api/src/bid/bid.controller.ts`（新路由，紧跟单项 extract 路由 :336-341 之后）

**Interfaces:**
- Consumes: `ScorePointSuggestionGroup`（Task 1）
- Produces: `ScorePointExtractorService.extractAllScorePoints(projectId): Promise<ScorePointSuggestionGroup[]>`；HTTP `POST /bid/projects/:id/score-items/points/extract-all`

- [ ] **Step 1: 扩充 spec 的 prisma mock**

把 `score-point-extractor.service.spec.ts` 顶部：

```ts
  const prisma = {
    bidScoreItem: { findFirst: jest.fn() },
  };
```

改为：

```ts
  const prisma = {
    bidScoreItem: { findFirst: jest.fn(), findMany: jest.fn() },
  };
```

- [ ] **Step 2: 在 spec 文件末尾（最后一个 `it` 所在 describe 闭合前）追加失败测试**

```ts
  // ── extractAllScorePoints：一键提取全部评分项 ──

  it('一键提取：跳过 PRICE 项，其余项分组返回', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 't1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
      { id: 'pr1', projectId: 'p1', category: 'PRICE', name: '价格评分', maxScore: 30, points: [] },
    ]);
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
    validator.retryChatJson.mockResolvedValue({
      items: [{ name: '施工组织设计', fullScore: 10, evidenceHint: '', objective: true }],
    });
    const r = await service.extractAllScorePoints('p1');
    expect(r.map((g) => g.itemId)).toEqual(['t1']);
    expect(r[0]).toMatchObject({ itemName: '技术评分', category: 'TECHNICAL', maxScore: 50 });
    expect(r[0].suggestions).toHaveLength(1);
  });

  it('一键提取：逐项聚合且保留空建议组，招标文件只取一次（缓存）', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 't1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
      { id: 'b1', projectId: 'p1', category: 'BUSINESS', name: '商务评分', maxScore: 20, points: [] },
    ]);
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
    validator.retryChatJson
      .mockResolvedValueOnce({ items: [{ name: 'A', fullScore: 10, evidenceHint: '', objective: true }] })
      .mockResolvedValueOnce({ items: [] });
    const r = await service.extractAllScorePoints('p1');
    expect(r).toHaveLength(2);
    expect(r[0].suggestions).toHaveLength(1);
    expect(r[1]).toMatchObject({ itemId: 'b1', suggestions: [] });
    expect(plaintextFetcher.fetchTenderPlaintext).toHaveBeenCalledTimes(1);
  });

  it('一键提取：招标文件未就绪抛 TENDER_NOT_READY', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 't1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
    ]);
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(null);
    await expect(service.extractAllScorePoints('p1')).rejects.toMatchObject({
      response: { code: 'TENDER_NOT_READY' },
    });
  });

  it('一键提取：单项 LLM 失败该组为空，不中断整批', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 't1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
      { id: 'b1', projectId: 'p1', category: 'BUSINESS', name: '商务评分', maxScore: 20, points: [] },
    ]);
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
    validator.retryChatJson
      .mockRejectedValueOnce(new Error('llm down'))
      .mockResolvedValueOnce({ items: [{ name: 'B', fullScore: 5, evidenceHint: '', objective: true }] });
    const r = await service.extractAllScorePoints('p1');
    expect(r[0].suggestions).toEqual([]);
    expect(r[1].suggestions).toHaveLength(1);
  });

  it('一键提取：无评分项返回空数组且不取招标文件', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([]);
    await expect(service.extractAllScorePoints('p1')).resolves.toEqual([]);
    expect(plaintextFetcher.fetchTenderPlaintext).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter api test -- score-point-extractor`
Expected: 5 个新用例全部 FAIL（`service.extractAllScorePoints is not a function`），原有用例仍 PASS。

- [ ] **Step 4: 在 `score-point-extractor.service.ts` 实现**

把文件顶部 import 改为：

```ts
import { ScorePointSuggestion, ScorePointSuggestionGroup } from '@water-erp/shared';
```

在 `extractScorePoints` 方法之后（`// ── E1 辅助方法 ──` 注释之前）插入：

```ts
  /**
   * 一键提取：全部非 PRICE 评分项逐项复用 extractScorePoints。
   * 招标文件文本预取一次写入 tenderTextCache（TTL 1min），逐项调用零成本命中；
   * 单项 LLM 失败由其内部 E6 降级返回 []，不中断整批。
   */
  async extractAllScorePoints(projectId: string): Promise<ScorePointSuggestionGroup[]> {
    const items = await this.prisma.bidScoreItem.findMany({
      where: { projectId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      include: { points: true },
    });
    if (items.length === 0) return [];

    const tenderText = await this.getTenderText(projectId);
    if (!tenderText) {
      throw new BadRequestException({ error: '招标文件未就绪（未发布招标公告或无招标文件）', code: 'TENDER_NOT_READY' });
    }

    const groups: ScorePointSuggestionGroup[] = [];
    for (const item of items) {
      if (item.category === 'PRICE') continue; // E5: 价格分由报价公式计算
      const suggestions = await this.extractScorePoints(projectId, item.id);
      groups.push({
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        maxScore: Number(item.maxScore),
        suggestions,
      });
    }
    return groups;
  }
```

- [ ] **Step 5: 在 `bid.controller.ts` 单项 extract 路由之后追加路由**

```ts
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('projects/:id/score-items/points/extract-all')
  @ApiOperation({ summary: '一键 AI 提取全部评分项的得分点建议（同步，不落库）' })
  extractAllScorePoints(@Param('id') id: string) {
    return this.scorePointExtractor.extractAllScorePoints(id);
  }
```

（`@Throttle` 装饰器已在该控制器使用，无需新 import。路由段数与 `:itemId/points/extract` 不同，无冲突。）

- [ ] **Step 6: 跑测试与静态检查**

Run: `pnpm --filter api test -- score-point-extractor && pnpm --filter api lint && pnpm --filter api build`
Expected: 全部用例 PASS；lint 无错误；build 成功。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/bid/score-point-extractor.service.ts apps/api/src/bid/score-point-extractor.service.spec.ts apps/api/src/bid/bid.controller.ts
git commit -m "feat(api): 得分点一键提取端点 extract-all"
```

---

### Task 3: web — 抽出共享 `SuggestionRow`（行为不变的重构）

**Files:**
- Create: `apps/web/src/components/projects/score-standard/suggestion-row.tsx`
- Modify: `apps/web/src/components/projects/score-standard/score-points-editor.tsx`（替换审核弹窗内 :229-262 的内联建议行）

**Interfaces:**
- Produces: `SuggestionRow` 组件 + `EditableSuggestion` 类型（Task 5 的分组弹窗消费）

- [ ] **Step 1: 创建 `suggestion-row.tsx`**

```tsx
'use client';

import type { ScorePointSuggestion } from '@/lib/api/bid';

export type EditableSuggestion = ScorePointSuggestion & { selected: boolean };

type Props = {
  suggestion: EditableSuggestion;
  onToggleSelected: () => void;
  onChange: (patch: Partial<ScorePointSuggestion>) => void;
};

/** AI 提取得分点建议行：单项审核弹窗与一键提取分组弹窗共用 */
export function SuggestionRow({ suggestion: s, onToggleSelected, onChange }: Props) {
  const conf = s.confidence ?? 0;
  const confColor = conf >= 0.8 ? 'text-[#11a874]' : conf >= 0.5 ? 'text-[#f5a623]' : 'text-[#e74c3c]';
  return (
    <div
      className={`rounded-lg border px-2 py-2 text-sm ${s.duplicate ? 'border-[#fde68a] bg-[#fffbeb]' : s.adjusted ? 'border-[#fde68a] bg-[#fffdf5]' : 'border-[oklch(0.92_0.004_265)]'}`}
    >
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={s.selected} onChange={onToggleSelected} />
        <input
          className="min-w-[120px] flex-1 rounded border border-[oklch(0.9_0.005_264)] px-1.5 py-0.5"
          value={s.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <input
          type="number"
          min={0}
          step={0.5}
          className="w-16 rounded border border-[oklch(0.9_0.005_264)] px-1 py-0.5 text-right font-mono"
          value={s.fullScore}
          onChange={(e) => onChange({ fullScore: Number(e.target.value) })}
        />
        {s.adjusted && (
          <span title="分数被等比缩放" className="text-xs">
            ⚠️
          </span>
        )}
        <button
          onClick={() => onChange({ objective: !s.objective })}
          className={`rounded px-1.5 py-0.5 text-xs ${s.objective ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}
        >
          {s.objective ? '客观' : '主观'}
        </button>
        <span className={`font-mono text-xs ${confColor}`} title={`信心分 ${conf}`}>
          {conf >= 0.8 ? '●●●' : conf >= 0.5 ? '●●○' : '●○○'}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-[oklch(0.55_0.01_264)]">
        {s.evidenceSection && (
          <span className="truncate" title={s.evidenceSection}>
            📎 {s.evidenceSection}
          </span>
        )}
        {s.evidenceHint && (
          <span className="truncate max-w-[200px]" title={s.evidenceHint}>
            {s.evidenceHint}
          </span>
        )}
        {s.duplicate && (
          <span className="rounded bg-[#fef3c7] px-1.5 py-0.5 text-[#92400e] font-bold">可能重复</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `score-points-editor.tsx` 顶部追加 import**

```tsx
import { SuggestionRow } from './suggestion-row';
```

- [ ] **Step 3: 替换审核弹窗内的 `suggestions.map` 块**

把 `score-points-editor.tsx` 中「AI 提取建议审核弹窗」里的：

```tsx
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {suggestions.map((s, idx) => {
                const conf = s.confidence ?? 0;
                const confColor = conf >= 0.8 ? 'text-[#11a874]' : conf >= 0.5 ? 'text-[#f5a623]' : 'text-[#e74c3c]';
                return (
                <div key={idx} className={`rounded-lg border px-2 py-2 text-sm ${s.duplicate ? 'border-[#fde68a] bg-[#fffbeb]' : s.adjusted ? 'border-[#fde68a] bg-[#fffdf5]' : 'border-[oklch(0.92_0.004_265)]'}`}>
                  ...（原 ~30 行建议行 JSX）...
                </div>
                );
              })}
            </div>
```

替换为：

```tsx
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {suggestions.map((s, idx) => (
                <SuggestionRow
                  key={idx}
                  suggestion={s}
                  onToggleSelected={() =>
                    setSuggestions((prev) => prev!.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p)))
                  }
                  onChange={(patch) =>
                    setSuggestions((prev) => prev!.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
                  }
                />
              ))}
            </div>
```

`suggestions` 的元素类型 `(ScorePointSuggestion & { selected: boolean })` 与 `EditableSuggestion` 一致，无需改状态声明。

- [ ] **Step 4: 类型检查 + lint**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: 无错误。

- [ ] **Step 5: 手动回归（如本地 LLM 可用）**

启动 `pnpm dev:api`（含 LLM 环境）+ `pnpm dev:web`，:3005 打开任一项目「评分标准编制」→ 展开一个打分类评分项 → 「AI 提取建议」→ 确认审核弹窗中建议行的勾选/改名/调分/客观主观切换/置信度/重复标记与改造前视觉、行为一致。LLM 不可用时以 tsc + diff 等价性为准。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/projects/score-standard/suggestion-row.tsx apps/web/src/components/projects/score-standard/score-points-editor.tsx
git commit -m "refactor(web): 抽出 SuggestionRow 建议行组件"
```

---

### Task 4: web — 合并模板按钮为「应用模板」

**Files:**
- Modify: `apps/web/src/components/projects/score-standard/template-library-dialog.tsx`（顶部固定「标准评分模板」行）
- Modify: `apps/web/src/components/projects/score-standard/score-standard-editor.tsx`（删「应用标准模板」按钮及 `handleApplyTemplate`；「模板库」改名）

**Interfaces:**
- Consumes: 现有 `applyScoreTemplate(projectId)`（`lib/api/bid.ts:150`，标准模板端点）、`applySavedScoreTemplate`（已保存模板）

- [ ] **Step 1: `template-library-dialog.tsx` 追加 import 与状态**

import 处改为：

```tsx
import {
  listScoreTemplates,
  applySavedScoreTemplate,
  applyScoreTemplate,
  deleteScoreTemplate,
  type ScoreTemplateRef,
  type BidScoreItem,
} from '@/lib/api/bid';
```

在 `const [deleteTarget, setDeleteTarget] = ...` 后追加：

```tsx
  const [applyingStandard, setApplyingStandard] = useState(false);
```

在 `handleApply` 之前追加：

```tsx
  const handleApplyStandard = async () => {
    setApplyingStandard(true);
    try {
      const updated = await applyScoreTemplate(projectId);
      onChanged(updated);
      toast.success('已应用标准评分模板');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '应用失败');
    } finally {
      setApplyingStandard(false);
    }
  };
```

- [ ] **Step 2: 重构弹窗主体——标准模板置顶，已保存模板列表在后**

把 Modal 内从 `<p className="mb-3 ...">应用按名称合并...</p>` 起到列表结束的整块替换为：

```tsx
        <p className="mb-3 rounded-lg bg-[#f3f7fc] px-3 py-2 text-xs text-[#5a6d8a]">
          应用按名称合并到当前项目（已存在的项不重复添加），不会覆盖或删除已有项。
        </p>

        {loading ? (
          <div className="py-10 text-center text-sm text-[#8a96aa]">加载中…</div>
        ) : (
          <div className="space-y-1.5">
            {/* 系统内置标准模板（置顶） */}
            <div className="flex items-center gap-3 rounded-lg border border-[#dce6f3] bg-[#f8fbff] px-3 py-2.5">
              <FileSpreadsheet size={16} strokeWidth={1.5} className="shrink-0 text-[#064ea2]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[#18243a]">标准评分模板</span>
                  <span className="shrink-0 rounded-full bg-[#f3f7fc] px-2 py-0.5 text-xs font-bold text-[#5a6d8a]">
                    系统内置
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-[#8a96aa]">
                  系统默认 · 资格审查 / 响应性 / 商务 / 技术 / 价格五类标准项
                </div>
              </div>
              <button
                onClick={handleApplyStandard}
                disabled={locked || applyingStandard}
                title={locked ? '评分标准已锁定，无法应用' : '应用到此项目'}
                className="rounded-lg bg-[#064ea2] px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#054280] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {applyingStandard ? '应用中…' : '应用'}
              </button>
            </div>

            {/* 已保存模板 */}
            {templates.length === 0 ? (
              <div className="py-6 text-center text-sm text-[#8a96aa]">
                尚无保存的模板。可在评分项页用「存为模板」创建。
              </div>
            ) : (
              templates.map((t) => {
                const mine = !!t.createdById;
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-lg border border-[#edf2f7] bg-white px-3 py-2.5"
                  >
                    <FileSpreadsheet size={16} strokeWidth={1.5} className="shrink-0 text-[#064ea2]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[#18243a]">{t.name}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                            mine ? 'bg-[#e6f0fb] text-[#064ea2]' : 'bg-[#f3f7fc] text-[#5a6d8a]'
                          }`}
                        >
                          {mine ? '我的' : '公共'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-[#8a96aa]">
                        {t.createdByName || '—'} · {new Date(t.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleApply(t)}
                        disabled={locked || applyingId === t.id}
                        title={locked ? '评分标准已锁定，无法应用' : '应用到此项目'}
                        className="rounded-lg bg-[#064ea2] px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#054280] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {applyingId === t.id ? '应用中…' : '应用'}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(t)}
                        title={mine ? '删除模板' : '删除公共模板（仅管理员可成功）'}
                        className="rounded-lg p-1.5 text-[#5a6d8a] transition hover:bg-[#fef2f2] hover:text-[#e74c3c]"
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
```

- [ ] **Step 3: `score-standard-editor.tsx` 删除「应用标准模板」**

删除 `handleApplyTemplate` 整个函数（:129-139），以及 toolbar 中：

```tsx
          <button
            onClick={handleApplyTemplate}
            className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
          >
            <FileSpreadsheet size={14} strokeWidth={1.8} />
            应用标准模板
          </button>
```

- [ ] **Step 4: 「模板库」按钮改名「应用模板」**

```tsx
      <button
        onClick={() => setShowLib(true)}
        className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
      >
        <FileSpreadsheet size={14} strokeWidth={1.8} />
        应用模板
      </button>
```

- [ ] **Step 5: 更新空态提示文案**

把 tableBlock 空态里的：

```tsx
              评分项是评标的前置条件——无评分项则专家无法打分。请「应用标准模板」或手动新增。
```

改为：

```tsx
              评分项是评标的前置条件——无评分项则专家无法打分。请点击「应用模板」选用标准模板，或手动新增。
```

- [ ] **Step 6: 清理未使用 import**

`applyScoreTemplate` 从 `score-standard-editor.tsx` 的 `@/lib/api/bid` import 列表中移除（该文件不再直接用）。

- [ ] **Step 7: 类型检查 + lint**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: 无错误。

- [ ] **Step 8: 手动验证**

:3005 打开「评分标准编制」：工具栏只剩「应用模板」（无「应用标准模板」）；点开弹窗顶部为「标准评分模板 · 系统内置」行，应用成功 toast 且列表刷新合并；已保存模板行应用 / 删除照旧。

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/projects/score-standard/template-library-dialog.tsx apps/web/src/components/projects/score-standard/score-standard-editor.tsx
git commit -m "feat(web): 合并评分模板按钮为「应用模板」，标准模板置顶"
```

---

### Task 5: web — 一键 AI 提取（客户端 + 分组审核弹窗 + 接线）

**Files:**
- Modify: `apps/web/src/lib/api/bid.ts`（新客户端函数 + 类型再导出）
- Create: `apps/web/src/components/projects/score-standard/bulk-extract-review-dialog.tsx`
- Modify: `apps/web/src/components/projects/score-standard/score-standard-editor.tsx`（状态 + 两个 handler + 按钮 + 弹窗渲染）

**Interfaces:**
- Consumes: `extractAllScorePoints` HTTP（Task 2）、`SuggestionRow`/`EditableSuggestion`（Task 3）、`batchCreateScorePoints`（现有，`lib/api/bid.ts:207`）
- Produces: `extractAllScorePoints(bidProjectId, options?)` 客户端；`BulkExtractReviewDialog`；`EditableGroup` 类型

- [ ] **Step 1: `lib/api/bid.ts` 追加客户端函数**

把文件顶部：

```ts
import type { ScorePointSuggestion } from '@water-erp/shared';
export type { ScorePointSuggestion };
```

改为：

```ts
import type { ScorePointSuggestion, ScorePointSuggestionGroup } from '@water-erp/shared';
export type { ScorePointSuggestion, ScorePointSuggestionGroup };
```

在 `extractScorePoints` 函数之后追加：

```ts
/** 一键 AI 提取：全部评分项（除 PRICE）分组返回建议（同步、不落库；300s 超时可经 options.signal 中断）。限流 3 次/分。*/
export function extractAllScorePoints(bidProjectId: string, options?: RequestInit) {
  return api.post<ScorePointSuggestionGroup[]>(
    `/bid/projects/${bidProjectId}/score-items/points/extract-all`,
    {},
    options,
  );
}
```

- [ ] **Step 2: 创建 `bulk-extract-review-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '@water-erp/shared';
import type { ScorePointSuggestion, ScorePointSuggestionGroup } from '@/lib/api/bid';
import { Modal } from '@/components/workbench';
import { SuggestionRow, type EditableSuggestion } from './suggestion-row';

export type EditableGroup = Omit<ScorePointSuggestionGroup, 'suggestions'> & {
  suggestions: EditableSuggestion[];
};

interface Props {
  open: boolean;
  groups: EditableGroup[]; // 调用方已按 confidence 降序 + duplicate 默认不选
  locked: boolean;
  onClose: () => void;
  onImport: (groups: EditableGroup[]) => Promise<void>;
}

export function BulkExtractReviewDialog({ open, groups, locked, onClose, onImport }: Props) {
  const [state, setState] = useState<EditableGroup[]>(groups);
  const [importing, setImporting] = useState(false);

  const total = state.reduce((s, g) => s + g.suggestions.length, 0);
  const selectedCount = state.reduce((s, g) => s + g.suggestions.filter((x) => x.selected).length, 0);
  const duplicateCount = state.reduce((s, g) => s + g.suggestions.filter((x) => x.duplicate).length, 0);

  const patchSuggestion = (itemId: string, idx: number, patch: Partial<ScorePointSuggestion>) =>
    setState((prev) =>
      prev.map((g) =>
        g.itemId === itemId
          ? { ...g, suggestions: g.suggestions.map((p, i) => (i === idx ? { ...p, ...patch } : p)) }
          : g,
      ),
    );

  const toggleSuggestion = (itemId: string, idx: number) =>
    setState((prev) =>
      prev.map((g) =>
        g.itemId === itemId
          ? { ...g, suggestions: g.suggestions.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p)) }
          : g,
      ),
    );

  const toggleGroupAll = (itemId: string, selected: boolean) =>
    setState((prev) =>
      prev.map((g) => (g.itemId === itemId ? { ...g, suggestions: g.suggestions.map((p) => ({ ...p, selected })) } : g)),
    );

  const toggleAll = (selected: boolean) =>
    setState((prev) => prev.map((g) => ({ ...g, suggestions: g.suggestions.map((p) => ({ ...p, selected })) })));

  const handleImport = async () => {
    setImporting(true);
    try {
      await onImport(state);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 提取得分点建议（来自招标文件）"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="neu-btn-soft">
            取消
          </button>
          {!locked && (
            <button
              onClick={handleImport}
              disabled={importing || selectedCount === 0}
              className="rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#054280] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {importing ? '导入中…' : `导入选中的 ${selectedCount} 项`}
            </button>
          )}
        </>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto">
        <div className="mb-3 flex items-center justify-between rounded-lg bg-[#f3f7fc] px-3 py-2 text-xs text-[#5a6d8a]">
          <span>
            共 <span className="font-mono font-bold">{total}</span> 项建议 · 已选{' '}
            <span className="font-mono font-bold">{selectedCount}</span> 项
            {duplicateCount > 0 && ` · ${duplicateCount} 项疑似重复`}
          </span>
          <button
            onClick={() => toggleAll(selectedCount < total)}
            className="font-bold text-[#064ea2] hover:underline"
          >
            {selectedCount === total ? '取消全选' : '全选'}
          </button>
        </div>

        <div className="space-y-4">
          {state.map((g) => {
            const color = CATEGORY_COLOR[g.category] || '#94a3b8';
            const groupSelected = g.suggestions.filter((s) => s.selected).length;
            return (
              <div key={g.itemId}>
                <div className="mb-1.5 flex items-center gap-2 text-sm">
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold"
                    style={{ color, backgroundColor: `${color}18` }}
                  >
                    {CATEGORY_LABEL[g.category] || g.category}
                  </span>
                  <span className="font-medium text-[#18243a]">{g.itemName}</span>
                  <span className="font-mono text-xs text-[#8a96aa]">大类满分 {g.maxScore}</span>
                  <span className="ml-auto flex items-center gap-1 text-xs text-[#5a6d8a]">
                    已选 {groupSelected}/{g.suggestions.length}
                    <button
                      onClick={() => toggleGroupAll(g.itemId, groupSelected < g.suggestions.length)}
                      className="ml-1 font-bold text-[#064ea2] hover:underline"
                    >
                      {groupSelected === g.suggestions.length ? '取消全选' : '全选'}
                    </button>
                  </span>
                </div>
                <div className="space-y-1.5">
                  {g.suggestions.map((s, idx) => (
                    <SuggestionRow
                      key={idx}
                      suggestion={s}
                      onToggleSelected={() => toggleSuggestion(g.itemId, idx)}
                      onChange={(patch) => patchSuggestion(g.itemId, idx, patch)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: `score-standard-editor.tsx` 更新 imports**

lucide import 列表加入 `Sparkles`。`@/lib/api/bid` import 最终为（Task 4 已移除 `applyScoreTemplate`，此处新增 `batchCreateScorePoints`、`extractAllScorePoints`）：

```ts
import {
  batchCreateScorePoints,
  createScoreItem,
  deleteScoreItem,
  ensureBidProject,
  extractAllScorePoints,
  getBidProjectDetail,
  listScoreItems,
  publishScoreStandard,
  updateScoreItem,
  type BidProjectRef,
  type BidScoreItem,
  type ScoreCategory,
} from '@/lib/api/bid';
```

组件 import 追加：

```tsx
import { BulkExtractReviewDialog, type EditableGroup } from './bulk-extract-review-dialog';
```

- [ ] **Step 4: 追加状态**

在 `const [showLib, setShowLib] = useState(false);` 后：

```tsx
  const [bulkGroups, setBulkGroups] = useState<EditableGroup[] | null>(null);
  const [extractingAll, setExtractingAll] = useState(false);
```

- [ ] **Step 5: 追加两个 handler**（放在 `handlePublish` 之后）

```tsx
  const handleBulkExtract = async () => {
    if (!bpId) return;
    if (items.length === 0) {
      toast.error('请先「应用模板」或手动新增评分项');
      return;
    }
    if (items.every((i) => i.category === 'PRICE')) {
      toast.error('当前评分项均为价格项，无需 AI 提取');
      return;
    }
    setExtractingAll(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300_000);
    try {
      const groups = await extractAllScorePoints(bpId, { signal: controller.signal });
      const withSelection: EditableGroup[] = groups
        .filter((g) => g.suggestions.length > 0)
        .map((g) => ({
          ...g,
          suggestions: [...g.suggestions]
            .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
            .map((s) => ({ ...s, selected: !s.duplicate })),
        }));
      if (withSelection.length === 0) {
        toast.info('AI 未提取到任何得分点建议');
      } else {
        setBulkGroups(withSelection);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.name 判 AbortError + e?.message 回退（与单项提取一致）
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        toast.error('AI 提取超时（300s），招标文件可能较大，请稍后重试');
      } else {
        toast.error(e?.message ?? 'AI 提取暂时不可用，请稍后重试或逐项提取。');
      }
    } finally {
      clearTimeout(timer);
      setExtractingAll(false);
    }
  };

  const handleBulkImport = async (groups: EditableGroup[]) => {
    if (!bpId) return;
    const picked = groups
      .map((g) => ({ itemId: g.itemId, points: g.suggestions.filter((s) => s.selected) }))
      .filter((g) => g.points.length > 0);
    if (picked.length === 0) {
      setBulkGroups(null);
      return;
    }
    const results = await Promise.allSettled(picked.map((g) => batchCreateScorePoints(bpId, g.itemId, g.points)));
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    for (const r of results) {
      if (r.status === 'rejected') {
        toast.error(r.reason instanceof Error ? r.reason.message : '部分得分点导入失败');
      }
    }
    if (okCount > 0) {
      toast.success(`已导入得分点（${okCount}/${picked.length} 个评分项）`);
      setBulkGroups(null);
      await reloadItems();
    }
  };
```

- [ ] **Step 6: toolbar 加「AI 提取」按钮**

`{!locked && (<>...</>)}` 块内，`handlePublish` 按钮**之前**插入：

```tsx
          <button
            onClick={handleBulkExtract}
            disabled={extractingAll}
            className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={14} strokeWidth={1.8} />
            {extractingAll ? '提取中…' : 'AI 提取'}
          </button>
```

最终工具栏顺序：存为模板 ｜ 应用模板 ｜（未锁定：）AI 提取 ｜ 发布评分标准 ｜ 新增评分项。

- [ ] **Step 7: 渲染弹窗**

在 `{bpId && <TemplateLibraryDialog .../>}` 之后追加：

```tsx
      {bulkGroups && bpId && (
        <BulkExtractReviewDialog
          open
          groups={bulkGroups}
          locked={locked}
          onClose={() => setBulkGroups(null)}
          onImport={handleBulkImport}
        />
      )}
```

- [ ] **Step 8: 类型检查 + lint**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: 无错误。

- [ ] **Step 9: 端到端手动验证清单**

前置：`pnpm dev:api`（LLM/OCR 环境就绪）+ `pnpm dev:web`，以 `Swhi-CGZX-01` 登录 :3005。

1. 空项目（无评分项）点「AI 提取」→ toast「请先「应用模板」或手动新增评分项」；
2. 「应用模板」→ 应用「标准评分模板」→ 五类标准项落表；
3. 有已发布招标公告 + 招标文件的项目点「AI 提取」→ 按钮「提取中…」→ 分组弹窗：组头（类别 badge + 名称 + 大类满分 + 组全选）、置信度 ●●●、「可能重复」默认不选；
4. 改名 / 调分 / 客观主观切换 / 全局全选 / 取消 → 状态正确；
5. 「导入选中的 N 项」→ 表格展开行可见得分点落库、toast 汇总；重复提取 → 新建议标「可能重复」；
6. 未发布招标公告的项目点「AI 提取」→ toast「招标文件未就绪（未发布招标公告或无招标文件）」；
7. 已发布评分标准（locked）的项目 → 无「AI 提取」按钮；
8. 回归：单项「AI 提取建议」弹窗行为与 Task 3 前一致；「应用模板」弹窗内已保存模板的应用 / 删除照旧。

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/api/bid.ts apps/web/src/components/projects/score-standard/bulk-extract-review-dialog.tsx apps/web/src/components/projects/score-standard/score-standard-editor.tsx
git commit -m "feat(web): 评分标准一键 AI 提取得分点（分组审核导入）"
```
