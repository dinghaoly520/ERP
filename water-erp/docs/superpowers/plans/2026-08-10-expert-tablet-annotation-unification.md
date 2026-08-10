# 专家打分平板：批注与备忘统一改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the two separate annotation mechanisms (inline textarea notes + ExpertMemo handwriting/keyboard memos) into a single ExpertMemo-backed system, with per-point count badges, multi-record support, desktop/tablet parity, and read-only admin visibility in :3005.

**Architecture:** Remove `PointChecklistScoring`'s inline note textarea; replace the MessageSquare icon with a read-only count badge. Route all annotations through `MemoPanel` bound to `scorePointId` + `scoreItemId`. Backend removes upsert semantics (allowing multiple memos per point) and adds admin-scoped read endpoints. Desktop evaluate page gets the same point-selection binding as tablet.

**Tech Stack:** NestJS 11 + Prisma (backend), Next.js 16 + React 19 + Tailwind v4 (expert-portal + web), `@water-erp/shared` types, `@water-erp/ui` components.

## Global Constraints

- No Prisma migration (no schema change) — `ExpertMemo.scoreItemId` column already exists but is currently always null from the frontend.
- `CreateMemoDto` already has `scoreItemId` field (validated, optional string).
- `ExpertMemo` type in `@water-erp/shared` already has `scoreItemId?: string | null`.
- OCR logic stays in backend (silent enhancement); frontend does not depend on OCR results.
- `pointDecisions[].note` field stays in the score submission payload for backward compatibility — just no longer rendered or written to.
- Follow `.impeccable.md` design system: neumorphic raised-border system, 1px hairlines, no flat shadows.
- After editing `packages/shared` or `packages/config`, rebuild: `pnpm --filter @water-erp/shared build`.
- Commit after each task. End commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Run `pnpm --filter api lint` and `pnpm --filter api test` for backend tasks.
- This is a single-branch feature on `main` — commit directly (memory: user does not auto-push).

---

## File Map

### Backend (`apps/api/src/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `expert/expert-memo.service.ts` | Modify | Remove upsert from `createMemo`; add `scoreItemId` filter to `getMemos`; add `getMemosForAdmin` + `getInkUrlForAdmin` |
| `expert/expert.controller.ts` | Modify | Add `@Query('scoreItemId')` to `listMemos` |
| `expert/expert-admin.controller.ts` | Modify | Inject `ExpertMemoService`; add 2 admin GET endpoints |

### Frontend — expert-portal (`apps/expert-portal/src/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/api.ts` | Modify | Add `scoreItemId` param to `listMemos` |
| `components/evaluate/point-checklist-scoring.tsx` | Modify | Remove inline textarea; add count badge |
| `components/memo/memo-panel.tsx` | Modify | `requirePointSelection` prop; remove upsert; fix `scoreItemId`; history recall; `onMemoCountChange` callback |
| `app/(tablet)/tablet/evaluate/[id]/page.tsx` | Modify | `pointMemoCounts` state; pass `scoreItemId`/`requirePointSelection`/`onMemoCountChange` |
| `app/(app)/evaluate/[id]/page.tsx` | Modify | `activePointId`/`activeScoreItemId`/`pointMemoCounts` state; wire PCS + MemoPanel |

### Frontend — web (:3005) (`apps/web/src/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/api/bid.ts` | Modify | Add `listExpertMemosForAdmin` + `getExpertMemoInkUrlForAdmin` |
| `components/projects/bid-confirm/evaluation-block.tsx` | Modify | Annotation badges in matrix detail; annotation popover/modal |

---

## Task 1: Backend — Remove upsert + add scoreItemId filter + admin endpoints

**Files:**
- Modify: `apps/api/src/expert/expert-memo.service.ts`
- Modify: `apps/api/src/expert/expert.controller.ts:467-475` (listMemos)
- Modify: `apps/api/src/expert/expert-admin.controller.ts:32` (inject service) + new endpoints

**Interfaces:**
- Produces: `ExpertMemoService.getMemosForAdmin(projectId, filters?: { expertId?, supplierId?, scoreItemId? })` → `Promise<ExpertMemo[]>`
- Produces: `ExpertMemoService.getInkUrlForAdmin(projectId, memoId)` → `Promise<{ url: string }>`
- Produces: `GET /expert-admin/projects/:projectId/memos?expertId&supplierId&scoreItemId`
- Produces: `GET /expert-admin/projects/:projectId/memos/:memoId/ink`

- [ ] **Step 1: Remove upsert from `createMemo`**

In `apps/api/src/expert/expert-memo.service.ts`, the `createMemo` method currently has no upsert code (upsert is in the frontend `MemoPanel`). Verify this by reading the method — the backend `createMemo` just does `prisma.expertMemo.create`. No backend upsert to remove.

- [ ] **Step 2: Add `scoreItemId` filter to `getMemos`**

In `expert-memo.service.ts`, method `getMemos` (line ~113), add `scoreItemId` parameter:

```typescript
async getMemos(
  userId: string,
  projectId: string,
  supplierId?: string,
  scorePointId?: string,
  scoreItemId?: string,
) {
  const expert = await this.prisma.bidExpert.findFirst({
    where: { userId, projectId },
  });
  if (!expert)
    throw new ForbiddenException({
      error: '您不是该项目的评审专家',
      code: 'NOT_PROJECT_EXPERT',
    });
  return this.prisma.expertMemo.findMany({
    where: {
      expertId: expert.id,
      projectId,
      ...(supplierId ? { supplierId } : {}),
      ...(scorePointId ? { scorePointId } : {}),
      ...(scoreItemId ? { scoreItemId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}
```

- [ ] **Step 3: Add `scoreItemId` query param to `expert.controller.ts` `listMemos`**

In `expert.controller.ts`, method `listMemos` (~line 467):

```typescript
@Get('projects/:projectId/memos')
listMemos(
  @CurrentUser('sub') userId: string,
  @Param('projectId') projectId: string,
  @Query('supplierId') supplierId?: string,
  @Query('scorePointId') scorePointId?: string,
  @Query('scoreItemId') scoreItemId?: string,
) {
  return this.memoService.getMemos(userId, projectId, supplierId, scorePointId, scoreItemId);
}
```

- [ ] **Step 4: Add `getMemosForAdmin` to `ExpertMemoService`**

Append to `expert-memo.service.ts`:

```typescript
async getMemosForAdmin(
  projectId: string,
  filters?: { expertId?: string; supplierId?: string; scoreItemId?: string },
) {
  return this.prisma.expertMemo.findMany({
    where: {
      projectId,
      ...(filters?.expertId ? { expertId: filters.expertId } : {}),
      ...(filters?.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(filters?.scoreItemId ? { scoreItemId: filters.scoreItemId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}
```

- [ ] **Step 5: Add `getInkUrlForAdmin` to `ExpertMemoService`**

Append to `expert-memo.service.ts`:

```typescript
async getInkUrlForAdmin(projectId: string, memoId: string) {
  const memo = await this.prisma.expertMemo.findFirst({
    where: { id: memoId, projectId },
    include: { inkFile: true },
  });
  if (!memo?.inkFile)
    throw new BadRequestException({
      error: '无墨迹原图',
      code: 'NO_INK',
    });
  return { url: await this.storage.getPresignedUrl(memo.inkFile.key) };
}
```

- [ ] **Step 6: Inject `ExpertMemoService` into `ExpertAdminController`**

In `expert-admin.controller.ts`, line 32, change constructor:

```typescript
constructor(
  private expertAdminService: ExpertAdminService,
  private memoService: ExpertMemoService,
) {}
```

Add import at top:

```typescript
import { ExpertMemoService } from './expert-memo.service';
```

- [ ] **Step 7: Add admin memo endpoints (BEFORE `@Get(':id')` at line 225)**

Insert these endpoints before the `// ── 动态 :id 路由 ──` section:

```typescript
  @Get('projects/:projectId/memos')
  @ApiOperation({ summary: '管理端：查看项目专家备忘/批注（只读，按 expert/supplier/scoreItem 过滤）' })
  listProjectMemos(
    @Param('projectId') projectId: string,
    @Query('expertId') expertId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('scoreItemId') scoreItemId?: string,
  ) {
    return this.memoService.getMemosForAdmin(projectId, { expertId, supplierId, scoreItemId });
  }

  @Get('projects/:projectId/memos/:memoId/ink')
  @ApiOperation({ summary: '管理端：获取专家笔迹原图预签名 URL' })
  getProjectMemoInkUrl(
    @Param('projectId') projectId: string,
    @Param('memoId') memoId: string,
  ) {
    return this.memoService.getInkUrlForAdmin(projectId, memoId);
  }
```

- [ ] **Step 8: Lint + test**

```bash
pnpm --filter api lint
pnpm --filter api test
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/expert/expert-memo.service.ts apps/api/src/expert/expert.controller.ts apps/api/src/expert/expert-admin.controller.ts
git commit -m "feat(api): 移除 memo upsert + 新增 scoreItemId 过滤 + 管理端只读批注端点

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Expert-portal API client — add scoreItemId to listMemos

**Files:**
- Modify: `apps/expert-portal/src/lib/api.ts:109-121`

**Interfaces:**
- Produces: `listMemos(projectId, supplierId?, scorePointId?, scoreItemId?)` → `Promise<ExpertMemo[]>`

- [ ] **Step 1: Add `scoreItemId` parameter to `listMemos`**

```typescript
export async function listMemos(
  projectId: string,
  supplierId?: string,
  scorePointId?: string,
  scoreItemId?: string,
): Promise<ExpertMemo[]> {
  const params = new URLSearchParams();
  if (supplierId) params.set('supplierId', supplierId);
  if (scorePointId) params.set('scorePointId', scorePointId);
  if (scoreItemId) params.set('scoreItemId', scoreItemId);
  const qs = params.toString();
  return api.get<ExpertMemo[]>(
    `/expert/projects/${projectId}/memos${qs ? `?${qs}` : ''}`,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/expert-portal/src/lib/api.ts
git commit -m "feat(expert-portal): listMemos 新增 scoreItemId 过滤参数

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: PointChecklistScoring — remove inline textarea + add count badge

**Files:**
- Modify: `apps/expert-portal/src/components/evaluate/point-checklist-scoring.tsx`

**Interfaces:**
- Consumes: none new
- Produces: new optional prop `pointMemoCounts?: Record<string, number>` (pointId → count)
- Existing consumers unaffected: `requirement-compare-panel.tsx` passes `hideNotes` → icon area fully hidden
- `(app)/evaluate` and `(tablet)/tablet/evaluate` will be updated in later tasks to pass `pointMemoCounts`

- [ ] **Step 1: Add `pointMemoCounts` to Props interface**

In the `Props` interface (line ~9), add:

```typescript
/** 得分点批注计数（pointId → count），用于角标渲染 */
pointMemoCounts?: Record<string, number>;
```

- [ ] **Step 2: Destructure `pointMemoCounts` in function signature**

Change line 29:

```typescript
export function PointChecklistScoring({ points, value, onChange, readOnly, compact, hideNotes, selectedPointId, onPointClick, pointMemoCounts }: Props) {
```

- [ ] **Step 3: Remove inline note state and refs**

Remove these lines:
- `const [openIds, setOpenIds] = useState<Set<string>>(new Set());` (line 32)
- `const noteRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});` (line 33)
- Remove the `import { useRef, useState }` if no other usage remains (check: `useState` and `useRef` are only used for these — remove the import)

- [ ] **Step 4: Replace the note button + textarea with count badge**

Inside the `sorted.map(p => { ... })` loop, remove the variables:
- `const hasNote = Boolean((v.note ?? '').trim());`
- `const noteExpanded = ...`

Replace the entire `{!hideNotes && (!readOnly || hasNote) && ( ... button ... )}` block (lines 79-99) and the `{!hideNotes && noteExpanded && ( ... textarea ... )}` block (lines 102-121) with:

```tsx
              {/* 批注角标（只读状态指示） */}
              {!hideNotes && (() => {
                const count = pointMemoCounts?.[p.id] ?? 0;
                if (readOnly && count === 0) return null;
                return (
                  <span
                    className={`relative flex shrink-0 items-center justify-center rounded-md h-8 w-8 ${
                      count > 0
                        ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent-strong)]'
                        : 'text-[var(--muted-foreground)]'
                    }`}>
                    {count > 0
                      ? <MessageSquare size={compact ? 12 : 14} strokeWidth={1.5} />
                      : <MessageSquarePlus size={compact ? 12 : 14} strokeWidth={1.5} />}
                    {count > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-strong)] px-1 text-[9px] font-bold tabular-nums text-white">
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </span>
                );
              })()}
```

Remove the old textarea block entirely (the `{!hideNotes && noteExpanded && (...)}` block).

- [ ] **Step 5: Verify no TypeScript errors**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: no errors related to point-checklist-scoring.tsx

- [ ] **Step 6: Commit**

```bash
git add apps/expert-portal/src/components/evaluate/point-checklist-scoring.tsx
git commit -m "feat(expert): PointChecklistScoring 移除 inline textarea + 加批注角标

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: MemoPanel — requirePointSelection + remove upsert + fix scoreItemId + history recall + onMemoCountChange

**Files:**
- Modify: `apps/expert-portal/src/components/memo/memo-panel.tsx`

**Interfaces:**
- Consumes: `listMemos` with `scoreItemId` (from Task 2)
- Produces: new props `requirePointSelection?: boolean` and `onMemoCountChange?: (pointId: string, count: number) => void`

This is the largest task. Work through each sub-step carefully.

- [ ] **Step 1: Add new props to interface**

In `MemoPanelProps` (line ~17), add:

```typescript
  /** true=无 scorePointId 时禁用输入（平板）；false/省略=始终允许（桌面） */
  requirePointSelection?: boolean;
  /** memo 列表加载/增删后回调，供父组件更新角标 */
  onMemoCountChange?: (pointId: string, count: number) => void;
```

- [ ] **Step 2: Destructure new props + fix scoreItemId**

Change the function destructuring (line ~44) to include all new props:

```typescript
export function MemoPanel({
  projectId, supplierId, scoreItemId, scorePointId, scorePointName,
  compact, sourceDevice = 'tablet', defaultMode,
  requirePointSelection = false, onMemoCountChange,
}: MemoPanelProps) {
```

Note: `scoreItemId` was already in the interface (line 20) but not destructured. Now it is.

- [ ] **Step 3: Pass scoreItemId to load() and createMemo**

In the `load` callback (line ~78), add `scoreItemId` to `listMemos`:

```typescript
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMemos(projectId, supplierId, scorePointId, scoreItemId);
      setMemos(list);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message || '加载备忘失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, supplierId, scorePointId, scoreItemId]);
```

- [ ] **Step 4: Add onMemoCountChange callback after load**

After the `useEffect(() => { load(); }, [load]);` line (~91), add:

```typescript
  // 批注计数回调
  useEffect(() => {
    if (scorePointId && onMemoCountChange) {
      onMemoCountChange(scorePointId, memos.length);
    }
  }, [scorePointId, memos.length, onMemoCountChange]);
```

- [ ] **Step 5: Simplify switch effect — remove capture + auto-save**

Replace the entire switch effect (lines ~96-180) with a simplified version that only clears + restores:

```typescript
  // 切换（供应商, 得分点）→ 清屏 + 恢复新得分点墨迹
  const prevRef = useRef({ supplierId, scorePointId });
  const switchToken = useRef(0);
  useEffect(() => {
    const prev = prevRef.current;
    const cur = { supplierId, scorePointId };
    prevRef.current = cur;
    const prevKey = `${prev.supplierId}:${prev.scorePointId}`;
    const curKey = `${cur.supplierId}:${cur.scorePointId}`;
    if (prevKey === curKey) {
      // 首次渲染 → 尝试恢复缓存墨迹
      const c0 = activeCanvas();
      if (mode === 'handwriting' && c0 && c0.isEmpty() && scorePointId) {
        const cached = inkCache.current.get(curKey);
        if (cached?.strokes.length) c0.restoreStrokes(cached.strokes);
        else if (cached?.blob) c0.restoreBlob(cached.blob).catch(() => {});
      }
      return;
    }
    const token = ++switchToken.current;
    const c = activeCanvas();
    c?.clear();

    // 恢复新得分点墨迹
    (async () => {
      if (switchToken.current !== token) return;
      if (mode === 'handwriting' && scorePointId) {
        const cached = inkCache.current.get(curKey);
        if (cached?.strokes.length) {
          c?.restoreStrokes(cached.strokes);
        } else if (cached?.blob) {
          await c?.restoreBlob(cached.blob);
        } else {
          // API 兜底
          try {
            const list = await listMemos(projectId, supplierId, scorePointId, scoreItemId);
            const latestInk = list.find(m => m.inkFileId);
            if (latestInk?.inkFileId) {
              const { url } = await getMemoInkUrl(projectId, latestInk.id);
              const res = await fetch(url);
              if (res.ok) {
                const blob = await res.blob();
                inkCache.current.set(curKey, { strokes: [], blob });
                if (switchToken.current === token) await c?.restoreBlob(blob);
              }
            }
          } catch { /* restore silent */ }
        }
      }
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scorePointId, supplierId]);
```

- [ ] **Step 6: Remove upsert from doSave — delete old ink block**

In `doSave` (line ~239), find the block (lines ~253-258):

```typescript
        if (scorePointId) {
          const oldInk = memosRef.current.find(m => m.supplierId === supplierId && m.scorePointId === scorePointId && m.inkFileId);
          if (oldInk) {
            try { await deleteMemo(projectId, oldInk.id); } catch { /* del silent */ }
          }
        }
```

**Delete this entire block.** The `createMemo` call below it stays unchanged.

Also add `scoreItemId` to the `createMemo` calls in `doSave`. Find both `createMemo` calls and add `scoreItemId`:

For handwriting path (~line 260):
```typescript
        await createMemo(projectId, {
          inkBlob: blob,
          sourceDevice: `${sourceDevice}_handwriting`,
          supplierId, scoreItemId, scorePointId,
        });
```

For keyboard path (~line 271):
```typescript
        await createMemo(projectId, {
          contentText: trimmed,
          sourceDevice: `${sourceDevice}_keyboard`,
          supplierId, scoreItemId, scorePointId,
        });
```

- [ ] **Step 7: Add history recall — click memo to load into editor**

Add a new function after `openInkUrl` (~line 301):

```typescript
  // 点击历史备忘 → 载入编辑区
  const recallMemo = async (memo: ExpertMemo) => {
    if (memo.inkFileId) {
      try {
        const { url } = await getMemoInkUrl(projectId, memo.id);
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          if (scorePointId) inkCache.current.set(`${supplierId}:${scorePointId}`, { strokes: [], blob });
          await activeCanvas()?.restoreBlob(blob);
        }
      } catch { toast.error('载入墨迹失败'); }
    } else if (memo.contentText) {
      setText(memo.contentText);
      setMode('keyboard');
    }
  };
```

- [ ] **Step 8: Wire recallMemo into the memo list items**

In the memo list rendering (~line 527), add `onClick` to the memo item div and a cursor style. Change:

```tsx
            <div key={m.id} className="neu-attachment-item items-start">
```

to:

```tsx
            <div key={m.id} className="neu-attachment-item cursor-pointer items-start" onClick={() => recallMemo(m)}>
```

- [ ] **Step 9: Add requirePointSelection gate — disable input when no scorePointId**

Compute the disabled state near the top of the render section (after `const fullscreenOverlay = ...`):

```typescript
  const inputDisabled = requirePointSelection && !scorePointId;
```

In the handwriting section (~line 485), wrap the toolbar + canvas + save button with conditional. Add a disabled overlay when `inputDisabled`:

Before the `{renderToolbar({ zoom: false })}` line, add:

```tsx
            {inputDisabled && (
              <div className="flex items-center justify-center rounded-xl bg-[oklch(0.97_0.01_258/0.6)] py-8 text-sm font-semibold text-[var(--muted-foreground)]">
                ← 请先选择左侧得分点
              </div>
            )}
```

Then wrap the toolbar + canvas + save in `{!inputDisabled && (...)}`:

```tsx
            {!inputDisabled && (
              <>
                {renderToolbar({ zoom: false })}
                <div className="relative select-none [-webkit-touch-callout:none]" onContextMenu={e => e.preventDefault()}>
                  <AtramentCanvas ref={inlineCanvasRef} height={compact ? 260 : 420} onNonPenHint={() => toast.info('手写模式请使用触控笔')} />
                  <button type="button" onClick={enterFullscreen}
                    className="neu-btn-xs is-square absolute right-2 top-2 !h-10 !w-10"
                    title="全屏手写">
                    <Maximize2 size={15} strokeWidth={1.6} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={doSave} disabled={saving}
                    className="neu-btn-primary !h-11 flex-1">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} strokeWidth={1.6} />}
                    {saving ? '保存中…' : '保存手写'}
                  </button>
                </div>
              </>
            )}
```

For the keyboard section (~line 504), add `disabled={inputDisabled || undefined}` to the textarea and save button:

```tsx
            <textarea
              value={text} onChange={e => setText(e.target.value)}
              rows={compact ? 5 : 7} placeholder={inputDisabled ? '请先选择得分点' : '键入备忘内容…'}
              disabled={inputDisabled}
              className="neu-input resize-none text-sm disabled:opacity-60"
            />
            <button type="button" onClick={doSave} disabled={saving || inputDisabled}
              className="neu-btn-primary !h-11 disabled:opacity-40">
```

- [ ] **Step 10: Update history bar title**

Change the history bar header (~line 462). Replace:

```tsx
          <span className="truncate">专家备忘</span>
```

with:

```tsx
          <span className="truncate">{scorePointName ? `${scorePointName} · 批注记录` : '专家备忘'}</span>
```

- [ ] **Step 11: Verify TypeScript compiles**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 12: Commit**

```bash
git add apps/expert-portal/src/components/memo/memo-panel.tsx
git commit -m "feat(expert): MemoPanel 统一批注——requirePointSelection + 移除 upsert + scoreItemId + 历史调出 + 计数回调

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Tablet evaluate page — wire pointMemoCounts + scoreItemId + requirePointSelection

**Files:**
- Modify: `apps/expert-portal/src/app/(tablet)/tablet/evaluate/[id]/page.tsx`

**Interfaces:**
- Consumes: `pointMemoCounts` prop for `PointChecklistScoring`, `requirePointSelection`/`scoreItemId`/`onMemoCountChange` for `MemoPanel`

- [ ] **Step 1: Add pointMemoCounts state**

After the existing `activePointName` state (~line 55), add:

```typescript
  const [pointMemoCounts, setPointMemoCounts] = useState<Record<string, number>>({});
  const [activeScoreItemId, setActiveScoreItemId] = useState<string | null>(null);
```

- [ ] **Step 2: Enhance handlePointClick to also set scoreItemId**

Replace the existing `handlePointClick` (~line 397):

```typescript
  const handlePointClick = useCallback(
    (pointId: string, pointName: string) => {
      // toggle selection
      const newId = activePointId === pointId ? null : pointId;
      setActivePointId(newId);
      setActivePointName(newId ? pointName : '');
      // find the scoreItemId containing this point
      if (newId && project) {
        const item = project.scoreItems.find(si => (si.points ?? []).some(p => p.id === newId));
        setActiveScoreItemId(item?.id ?? null);
      } else {
        setActiveScoreItemId(null);
      }
    },
    [activePointId, project],
  );
```

- [ ] **Step 3: Load memo counts on supplier change**

After the default supplier selection effect (~line 241), add:

```typescript
  // 批量加载当前供应商的 memo 计数（按 scorePointId reduce）
  useEffect(() => {
    if (!activeSupplier) return;
    listMemos(projectId, activeSupplier)
      .then(list => {
        const counts: Record<string, number> = {};
        for (const m of list) {
          if (m.scorePointId) counts[m.scorePointId] = (counts[m.scorePointId] ?? 0) + 1;
        }
        setPointMemoCounts(counts);
      })
      .catch(() => { /* silent */ });
  }, [activeSupplier, projectId]);
```

Add import for `listMemos` at the top if not already imported:

```typescript
import { listMemos } from '@/lib/api';
```

Actually, check — `listMemos` is imported from `@/lib/api`. Verify the import exists.

- [ ] **Step 4: Pass pointMemoCounts to both PointChecklistScoring instances**

Find both `<PointChecklistScoring>` instances (pass-fail ~line 585 and scoring ~line 639). Add `pointMemoCounts={pointMemoCounts}` to each.

- [ ] **Step 5: Update MemoPanel props**

Find the `<MemoPanel>` usage (~line 724). Change to:

```tsx
          <MemoPanel
            projectId={projectId}
            supplierId={activeSupplier || undefined}
            scorePointId={activePointId ?? undefined}
            scorePointName={activePointName || undefined}
            scoreItemId={activeScoreItemId ?? undefined}
            compact
            sourceDevice="tablet"
            requirePointSelection
            onMemoCountChange={(pid, count) => setPointMemoCounts(prev => ({ ...prev, [pid]: count }))}
          />
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add apps/expert-portal/src/app/\(tablet\)/tablet/evaluate/\[id\]/page.tsx
git commit -m "feat(expert): 平板打分页接入得分点批注——pointMemoCounts + scoreItemId + requirePointSelection

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Desktop evaluate page — wire activePointId + pointMemoCounts + MemoPanel binding

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`

**Interfaces:**
- Consumes: same as Task 5 for PCS and MemoPanel props

- [ ] **Step 1: Add point selection state**

After the `memoOpen` state (~line 82), add:

```typescript
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [activePointName, setActivePointName] = useState<string>('');
  const [activeScoreItemId, setActiveScoreItemId] = useState<string | null>(null);
  const [pointMemoCounts, setPointMemoCounts] = useState<Record<string, number>>({});
```

- [ ] **Step 2: Add handlePointClick**

After the existing `handlePointNote` callback (~line 417), add:

```typescript
  // 得分点选中（联动备忘抽屉）
  const handlePointClickDesk = useCallback(
    (pointId: string, pointName: string) => {
      const newId = activePointId === pointId ? null : pointId;
      setActivePointId(newId);
      setActivePointName(newId ? pointName : '');
      if (newId && project) {
        const item = project.scoreItems.find(si => (si.points ?? []).some(p => p.id === newId));
        setActiveScoreItemId(item?.id ?? null);
      } else {
        setActiveScoreItemId(null);
      }
    },
    [activePointId, project],
  );
```

- [ ] **Step 3: Load memo counts on supplier change**

Find where `activeSupplier` is used for data loading (near the load logic). Add a new effect after the loadProject effect:

```typescript
  // 批量加载当前供应商的 memo 计数
  useEffect(() => {
    if (!activeSupplier) return;
    listMemos(projectId, activeSupplier)
      .then(list => {
        const counts: Record<string, number> = {};
        for (const m of list) {
          if (m.scorePointId) counts[m.scorePointId] = (counts[m.scorePointId] ?? 0) + 1;
        }
        setPointMemoCounts(counts);
      })
      .catch(() => { /* silent */ });
  }, [activeSupplier, projectId]);
```

Add import at top:

```typescript
import { listMemos } from '@/lib/api';
```

(Check if `listMemos` is already imported — it's in the same `@/lib/api` module as other functions.)

- [ ] **Step 4: Pass new props to both PointChecklistScoring instances**

Find both instances (pass-fail ~line 1629, scoring ~line 1686). Add to each:

```tsx
          selectedPointId={activePointId}
          onPointClick={handlePointClickDesk}
          pointMemoCounts={pointMemoCounts}
```

- [ ] **Step 5: Update MemoPanel in the drawer**

Find the `<MemoPanel>` in the drawer (~line 1873). Change to:

```tsx
                  <MemoPanel
                    projectId={projectId}
                    supplierId={activeSupplier}
                    scorePointId={activePointId ?? undefined}
                    scorePointName={activePointName || undefined}
                    scoreItemId={activeScoreItemId ?? undefined}
                    sourceDevice="desktop"
                    onMemoCountChange={(pid, count) => setPointMemoCounts(prev => ({ ...prev, [pid]: count }))}
                  />
```

Note: `requirePointSelection` is NOT passed (defaults to false) — desktop allows unbound memos.

- [ ] **Step 6: Update drawer header to show selected point**

In the drawer header (~line 1854), after the supplier pill, add point indicator:

```tsx
                  {activePointName && (
                    <span className="exp-pill ml-1 max-w-[120px] truncate" style={{ '--c': 'var(--accent-strong)' } as React.CSSProperties}>
                      {activePointName}
                    </span>
                  )}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 8: Commit**

```bash
git add apps/expert-portal/src/app/\(app\)/evaluate/\[id\]/page.tsx
git commit -m "feat(expert): 桌面打分页接入得分点批注——activePointId + pointMemoCounts + MemoPanel 绑定

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: :3005 EvaluationBlock — admin annotation badges + popover

**Files:**
- Modify: `apps/web/src/lib/api/bid.ts` (add API client functions)
- Modify: `apps/web/src/components/projects/bid-confirm/evaluation-block.tsx` (add badges + popover)

**Interfaces:**
- Consumes: `GET /expert-admin/projects/:projectId/memos` and `GET .../memos/:memoId/ink` (from Task 1)
- Consumes: `BidProjectExpertInfo.id` (expertId), `BidProjectExpertInfo.scoreRecords[].scoreItemId`

- [ ] **Step 1: Add API client functions to `apps/web/src/lib/api/bid.ts`**

Append at end of file:

```typescript
/* ── 专家批注/备忘（管理端只读）── */

export interface ExpertMemoForAdmin {
  id: string;
  expertId: string;
  projectId: string;
  supplierId?: string | null;
  scoreItemId?: string | null;
  scorePointId?: string | null;
  contentText?: string | null;
  inkFileId?: string | null;
  sourceDevice?: string | null;
  createdAt: string;
}

export function listExpertMemosForAdmin(
  projectId: string,
  params?: { expertId?: string; supplierId?: string; scoreItemId?: string },
): Promise<ExpertMemoForAdmin[]> {
  const qs = new URLSearchParams();
  if (params?.expertId) qs.set('expertId', params.expertId);
  if (params?.supplierId) qs.set('supplierId', params.supplierId);
  if (params?.scoreItemId) qs.set('scoreItemId', params.scoreItemId);
  return api.get(`/expert-admin/projects/${projectId}/memos${qs.size ? `?${qs}` : ''}`);
}

export function getExpertMemoInkUrlForAdmin(
  projectId: string,
  memoId: string,
): Promise<{ url: string }> {
  return api.get(`/expert-admin/projects/${projectId}/memos/${memoId}/ink`);
}
```

- [ ] **Step 2: Add state to EvaluationBlock for annotation viewing**

In `evaluation-block.tsx`, add imports at top:

```typescript
import { MessageSquare, ExternalLink } from 'lucide-react';
import {
  listExpertMemosForAdmin,
  getExpertMemoInkUrlForAdmin,
  type ExpertMemoForAdmin,
} from '@/lib/api/bid';
```

In the component (after existing state ~line 125), add:

```typescript
  const [annotationCell, setAnnotationCell] = useState<string | null>(null); // `${expertId}:${supplierId}:${scoreItemId}`
  const [annotationMemos, setAnnotationMemos] = useState<ExpertMemoForAdmin[]>([]);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [inkUrls, setInkUrls] = useState<Record<string, string>>({}); // memoId → presigned URL
```

- [ ] **Step 3: Add annotation loading function**

```typescript
  const loadAnnotations = async (expertId: string, supplierId: string, scoreItemId: string) => {
    const key = `${expertId}:${supplierId}:${scoreItemId}`;
    setAnnotationCell(key);
    setAnnotationLoading(true);
    setAnnotationMemos([]);
    setInkUrls({});
    try {
      const memos = await listExpertMemosForAdmin(bidProjectId, { expertId, supplierId, scoreItemId });
      setAnnotationMemos(memos);
      // lazy-load ink URLs
      for (const m of memos) {
        if (m.inkFileId) {
          getExpertMemoInkUrlForAdmin(bidProjectId, m.id)
            .then(({ url }) => setInkUrls(prev => ({ ...prev, [m.id]: url })))
            .catch(() => {});
        }
      }
    } catch { /* silent */ }
    finally { setAnnotationLoading(false); }
  };
```

- [ ] **Step 3b: Add `scoreItemId` to `ExpertSupplierCell.items` type + `buildExpertSupplierMatrix`**

The expanded cell detail (`cell.items`) currently lacks `scoreItemId`, which the annotation badge needs. Fix the type and builder:

In `evaluation-block.tsx`, change the `ExpertSupplierCell` interface (~line 44):

```typescript
interface ExpertSupplierCell {
  totalScore: number;
  maxScore: number;
  scoredCount: number;
  items: { scoreItemId: string; name: string; category: ScoreCategory; score: number; maxScore: number; passed?: boolean | null; reason?: string | null }[];
}
```

In `buildExpertSupplierMatrix` (~line 65), add `scoreItemId` to the push:

```typescript
        cell.items.push({
          scoreItemId: record.scoreItemId,
          name: item.name, category: item.category, score, maxScore: Number(item.maxScore),
          passed: record.passed, reason: record.reason,
        });
```

- [ ] **Step 4: Add annotation badge to expanded cell items**

In the expanded cell detail rendering (~line 514-523, the `cell.items.map(...)` block), modify each item span to include a badge. Use `it.scoreItemId` directly (added in Step 3b):

```tsx
                              {cell.items.map((it: ExpertSupplierCell['items'][number]) => {
                                const memoCount = annotationCell === `${expert.id}:${spId}:${it.scoreItemId}`
                                  ? annotationMemos.filter(m => m.scoreItemId === it.scoreItemId).length
                                  : 0;
                                return (
                                  <span key={`${it.scoreItemId}`} className="text-[10px] text-[var(--muted-foreground)]" title={it.reason ?? undefined}>
                                    {it.name}{' '}
                                    <b style={{ color: it.passed === false ? 'var(--danger)' : 'var(--foreground)' }}>
                                      {PASS_FAIL_CATEGORIES.includes(it.category) ? (it.passed === false ? '不通过' : '通过') : `${it.score}/${it.maxScore}`}
                                    </b>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); loadAnnotations(expert.id, spId, it.scoreItemId); }}
                                      className={`ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold transition-colors ${
                                        memoCount > 0
                                          ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent-strong)]'
                                          : 'text-[var(--muted-foreground)] hover:bg-[oklch(0.94_0.01_258/0.7)]'
                                      }`}
                                      title={memoCount > 0 ? `${memoCount} 条批注` : '查看批注'}
                                    >
                                      <MessageSquare size={9} strokeWidth={1.5} />
                                      {memoCount > 0 && <span className="tabular-nums">{memoCount}</span>}
                                    </button>
                                  </span>
                                );
                              })}
```

- [ ] **Step 5: Add annotation popover**

At the end of the component's JSX (before the closing `</section>`), add:

```tsx
      {/* 批注查看弹窗 */}
      {annotationCell && (() => {
        const [exId, spId] = annotationCell.split(':');
        const expertName = experts.find(e => e.id === exId)?.expertName ?? '';
        const supplierName = suppliers.find(s => s.id === spId)?.supplierName ?? '';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-6"
            style={{ background: 'oklch(0.2 0.02 258 / 0.4)', backdropFilter: 'blur(2px)' }}
            onClick={() => setAnnotationCell(null)}>
            <div className="w-full max-w-[480px] rounded-[20px] bg-white p-5"
              style={{ boxShadow: '3px 4px 16px oklch(0.46 0.07 258 / 0.18)' }}
              onClick={e => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--foreground)]">
                  批注 · {expertName} → {supplierName}
                </h3>
                <button type="button" onClick={() => setAnnotationCell(null)}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <X size={16} />
                </button>
              </div>
              {annotationLoading ? (
                <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
              ) : annotationMemos.length === 0 ? (
                <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无批注</p>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {annotationMemos.map(m => (
                    <div key={m.id} className="rounded-[10px] border border-[oklch(0.6_0.04_258/0.1)] bg-[oklch(0.975_0.012_258/0.3)] px-3 py-2">
                      {m.contentText && (
                        <p className="break-words text-xs text-[var(--foreground)]">{m.contentText}</p>
                      )}
                      {m.inkFileId && inkUrls[m.id] && (
                        <img src={inkUrls[m.id]} alt="手写批注" className="mt-1 w-full rounded-lg" />
                      )}
                      {m.inkFileId && !inkUrls[m.id] && (
                        <p className="text-[10px] italic text-[var(--muted-foreground)]">墨迹加载中…</p>
                      )}
                      <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                        {new Date(m.createdAt).toLocaleString('zh-CN')}
                        {m.sourceDevice && ` · ${m.sourceDevice}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api/bid.ts apps/web/src/components/projects/bid-confirm/evaluation-block.tsx
git commit -m "feat(web): 评标矩阵新增专家批注只读查看——角标 + 弹窗（文本 + 笔迹）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Final verification — TypeScript + lint + visual check

**Files:** None modified

- [ ] **Step 1: Build shared packages (in case types changed)**

```bash
pnpm --filter @water-erp/shared build
```

- [ ] **Step 2: TypeScript check all affected apps**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -30
cd ../../apps/web && npx tsc --noEmit --pretty 2>&1 | head -30
cd ../../apps/api && npx tsc --noEmit --pretty 2>&1 | head -30
```

- [ ] **Step 3: Lint backend**

```bash
pnpm --filter api lint
```

- [ ] **Step 4: Verify requirement-compare-panel unaffected**

Read `apps/expert-portal/src/components/evaluate/assist/requirement-compare-panel.tsx` — confirm it still passes `hideNotes` to `PointChecklistScoring` and that no TypeScript errors arise from the removed inline textarea (the `hideNotes` path never rendered it).

- [ ] **Step 5: Commit verification result (if any fixes needed)**

If any fixes were needed during verification, commit them. Otherwise skip.

---

## Spec Coverage Checklist

| Spec Section | Task(s) |
|-------------|---------|
| §4.1 — Remove upsert + scoreItemId filter | Task 1 |
| §4.2 — Admin read endpoints | Task 1 |
| §5.1 — PointChecklistScoring remove textarea + badge | Task 3 |
| §5.2.1 — requirePointSelection prop | Task 4 |
| §5.2.2 — Remove upsert from MemoPanel | Task 4 |
| §5.2.3 — Fix scoreItemId dead code | Task 4 |
| §5.2.4 — History recall | Task 4 |
| §5.2.5 — onMemoCountChange callback | Task 4 |
| §5.3 — Tablet page wiring | Task 5 |
| §5.4 — Desktop page wiring | Task 6 |
| §5.5 — Admin EvaluationBlock badges + popover | Task 7 |
| §5.6 — Expert-portal API client scoreItemId | Task 2 |
| §7 — Edge cases (supplier switch, scoreLocked, etc.) | Handled by existing MemoPanel logic + Task 4 gates |
| §9 — "Not doing" items | N/A (explicitly excluded) |
