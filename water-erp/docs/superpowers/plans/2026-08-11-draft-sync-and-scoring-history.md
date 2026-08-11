# 草稿实时同步 + 评分变更保护 + 评分历史 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make draft scores sync silently across tablet/desktop (new items auto-merge, modifications prompt via banner+modal), add tablet modification confirmation + undo toast, add scoring history drawer, and clean up tablet operation bar.

**Architecture:** Draft sync uses the existing per-device server draft storage + WS DRAFT_SAVED event. On WS receipt, client compares remote draft against local scores — new keys silently merge, changed keys go into a conflict banner+modal. Tablet modification protection uses parent-level onChange interception (React controlled checkbox auto-reverts if state isn't updated). Scoring history reads from the existing BidScoreRecordHistory table.

**Tech Stack:** NestJS 11 + Prisma (backend), Next.js 16 + React 19 + Tailwind v4 + sonner toast (expert-portal).

## Global Constraints

- No Prisma migration (no schema change). `BidScoreRecordHistory` already exists and is populated by `submitScores`.
- `PointChecklistScoring` component is NOT modified — all modification protection is in parent component onChange callbacks.
- ExpertController uses `@CurrentUser('sub')` + service-level `bidExpert.findFirst({ userId, projectId })` for auth — no `@Roles` decorator needed on new endpoints.
- Existing `useExpertWebSocket` hook already has `onDraftSaved` handler wired — no hook changes needed.
- `ConfirmDialog` component at `@/components/confirm-dialog` accepts `{ open, title, message, confirmText, cancelText, danger, onConfirm, onCancel }`.
- Commit after each task. End commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Do NOT push — user will push manually.

---

## File Map

### Backend (`apps/api/src/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `expert/expert.service.ts` | Modify | Add `getScoreHistory` method |
| `expert/expert.controller.ts` | Modify | Add `GET /expert/projects/:projectId/score-history` endpoint |

### Frontend — expert-portal (`apps/expert-portal/src/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/api.ts` | Modify | Add `getScoreHistory` function |
| `app/(tablet)/tablet/evaluate/[id]/page.tsx` | Modify | Modification confirmation + undo toast + remove save button + WS auto-merge + reset protection |
| `app/(app)/evaluate/[id]/page.tsx` | Modify | Undo toast + WS auto-merge + conflict banner + memo→history button + history drawer |
| `components/evaluate/sync-conflict-modal.tsx` | **Create** | Conflict resolution modal component |
| `components/evaluate/score-history-drawer.tsx` | **Create** | Scoring history drawer component |

---

## Task 1: Backend — scoring history endpoint

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts` (append method after `getScoreDraft`)
- Modify: `apps/api/src/expert/expert.controller.ts` (append endpoint after `getScoreDraft`)

**Interfaces:**
- Produces: `ExpertService.getScoreHistory(userId, projectId, supplierId)` → grouped history array
- Produces: `GET /expert/projects/:projectId/score-history?supplierId=X`

- [ ] **Step 1: Add `getScoreHistory` to `expert.service.ts`**

Append after the `getScoreDraft` method (around line 1740):

```typescript
  /** 评分历史：当前值 + 修改快照，按 scoreItemId 分组 */
  async getScoreHistory(userId: string, projectId: string, supplierId: string) {
    const expert = await this.prisma.bidExpert.findFirst({ where: { userId, projectId } });
    if (!expert) throw new ForbiddenException({ error: '您不是该项目的评审专家', code: 'NOT_PROJECT_EXPERT' });

    const [records, history] = await Promise.all([
      this.prisma.bidScoreRecord.findMany({
        where: { expertId: expert.id, supplierId },
        include: { scoreItem: { select: { id: true, name: true, category: true } } },
        orderBy: { scoreItem: { category: 'asc' } },
      }),
      this.prisma.bidScoreRecordHistory.findMany({
        where: { expertId: expert.id, supplierId },
        include: { scoreItem: { select: { id: true, name: true, category: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // 按 scoreItemId 分组
    const grouped: Array<{
      scoreItemId: string;
      scoreItemName: string;
      category: string;
      current: { score: number; passed: boolean | null; reason: string | null; updatedAt: string };
      history: Array<{ score: number; passed: boolean | null; reason: string | null; action: string; createdAt: string }>;
    }> = [];

    const byItemId = new Map<string, typeof grouped[number]>();

    // 先放历史快照
    for (const h of history) {
      const key = h.scoreItemId;
      if (!byItemId.has(key)) {
        byItemId.set(key, {
          scoreItemId: key,
          scoreItemName: h.scoreItem?.name ?? key,
          category: h.scoreItem?.category ?? '',
          current: { score: 0, passed: null, reason: null, updatedAt: '' },
          history: [],
        });
      }
      byItemId.get(key)!.history.push({
        score: Number(h.score),
        passed: h.passed,
        reason: h.reason,
        action: h.action,
        createdAt: h.createdAt.toISOString(),
      });
    }

    // 再放当前值
    for (const r of records) {
      const key = r.scoreItemId;
      if (!byItemId.has(key)) {
        byItemId.set(key, {
          scoreItemId: key,
          scoreItemName: r.scoreItem?.name ?? key,
          category: r.scoreItem?.category ?? '',
          current: { score: 0, passed: null, reason: null, updatedAt: '' },
          history: [],
        });
      }
      byItemId.get(key)!.current = {
        score: Number(r.score),
        passed: r.passed,
        reason: r.reason,
        updatedAt: r.updatedAt.toISOString(),
      };
    }

    return Array.from(byItemId.values());
  }
```

- [ ] **Step 2: Add endpoint to `expert.controller.ts`**

Append after `getScoreDraft` endpoint (around line 395):

```typescript
  @Get('projects/:projectId/score-history')
  @ApiOperation({ summary: '评分历史（当前值 + 修改快照，按评分项分组）' })
  getScoreHistory(
    @CurrentUser('sub') userId: string,
    @Param('projectId') projectId: string,
    @Query('supplierId') supplierId: string,
  ) {
    return this.expertService.getScoreHistory(userId, projectId, supplierId);
  }
```

- [ ] **Step 3: Lint + tsc check**

```bash
pnpm --filter api lint
cd apps/api && npx tsc --noEmit --pretty 2>&1 | grep "error TS" | grep -v "supplier.service\|e2e" | head -5
```

Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.controller.ts
git commit -m "feat(api): 新增评分历史端点 GET /expert/projects/:projectId/score-history

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Frontend API client — getScoreHistory

**Files:**
- Modify: `apps/expert-portal/src/lib/api.ts` (append after `getMemoInkUrl`)

- [ ] **Step 1: Add `getScoreHistory` function**

Append after `getMemoInkUrl` (around line 170):

```typescript
// ── 评分历史 ──

export interface ScoreHistoryItem {
  scoreItemId: string;
  scoreItemName: string;
  category: string;
  current: { score: number; passed: boolean | null; reason: string | null; updatedAt: string };
  history: Array<{ score: number; passed: boolean | null; reason: string | null; action: string; createdAt: string }>;
}

export async function getScoreHistory(
  projectId: string,
  supplierId: string,
): Promise<ScoreHistoryItem[]> {
  return api.get<ScoreHistoryItem[]>(
    `/expert/projects/${projectId}/score-history?supplierId=${supplierId}`,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/expert-portal/src/lib/api.ts
git commit -m "feat(expert-portal): 新增 getScoreHistory API client

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: SyncConflictModal component (new file)

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/sync-conflict-modal.tsx`

**Interfaces:**
- Produces: `<SyncConflictModal open items localDevice onConfirm onClose />`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

export interface SyncConflictItem {
  key: string;
  scoreItemName: string;
  localVal: { score?: number; passed?: boolean | null; reason?: string | null };
  remoteVal: { score?: number; passed?: boolean | null; reason?: string | null };
  remoteDevice: 'tablet' | 'desktop';
}

export interface SyncNewItem {
  key: string;
  scoreItemName: string;
  val: { score?: number; passed?: boolean | null; reason?: string | null };
  sourceDevice: 'tablet' | 'desktop';
}

interface Props {
  open: boolean;
  newItems: SyncNewItem[];
  conflictItems: SyncConflictItem[];
  localDevice: 'tablet' | 'desktop';
  onConfirm: (resolved: Record<string, 'local' | 'remote'>) => void;
  onClose: () => void;
}

function formatVal(v: { score?: number; passed?: boolean | null }): string {
  if (v.passed === true) return '通过';
  if (v.passed === false) return '不通过';
  return `${v.score ?? 0}分`;
}

export function SyncConflictModal({ open, newItems, conflictItems, localDevice, onConfirm, onClose }: Props) {
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({});
  if (!open) return null;

  const remoteLabel = localDevice === 'desktop' ? '平板端' : '桌面端';
  const localLabel = localDevice === 'desktop' ? '桌面' : '平板';

  const setAll = (choice: 'local' | 'remote') => {
    const next: Record<string, 'local' | 'remote'> = {};
    for (const c of conflictItems) next[c.key] = choice;
    setChoices(next);
  };

  const handleConfirm = () => {
    // 默认全部 local
    const resolved: Record<string, 'local' | 'remote'> = {};
    for (const c of conflictItems) resolved[c.key] = choices[c.key] ?? 'local';
    onConfirm(resolved);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: 'oklch(0.2 0.02 258 / 0.4)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}>
      <div className="w-full max-w-[520px] rounded-[20px] bg-white"
        style={{ boxShadow: '3px 4px 16px oklch(0.46 0.07 258 / 0.18)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
          <h3 className="text-sm font-bold text-[var(--foreground)]">
            同步草稿 — 来自{remoteLabel}
          </h3>
          <button type="button" onClick={onClose}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {/* 新增项 */}
          {newItems.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--success)]">
                <CheckCircle2 size={14} /> 新增（{newItems.length} 项）— 已自动合并
              </div>
              <div className="space-y-1">
                {newItems.map(n => (
                  <div key={n.key} className="rounded-[8px] bg-[oklch(0.975_0.012_258/0.4)] px-3 py-1.5 text-xs">
                    <span className="text-[var(--muted-foreground)]">{n.scoreItemName}</span>
                    <span className="ml-2 font-bold text-[var(--foreground)]">{formatVal(n.val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 冲突项 */}
          {conflictItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--warning)]">
                <AlertTriangle size={14} /> 变更（{conflictItems.length} 项）— 请确认
              </div>
              <div className="space-y-2">
                {conflictItems.map(c => (
                  <div key={c.key} className="rounded-[10px] border border-[oklch(0.6_0.04_258/0.1)] px-3 py-2">
                    <div className="mb-1.5 text-xs font-semibold text-[var(--foreground)]">{c.scoreItemName}</div>
                    <div className="flex items-center gap-4">
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <input type="radio" name={c.key}
                          checked={(choices[c.key] ?? 'local') === 'local'}
                          onChange={() => setChoices(prev => ({ ...prev, [c.key]: 'local' }))}
                          className="accent-[var(--accent-strong)]"
                        />
                        <span className="text-[var(--muted-foreground)]">{localLabel}</span>
                        <span className="font-bold text-[var(--foreground)]">{formatVal(c.localVal)}</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                        <input type="radio" name={c.key}
                          checked={choices[c.key] === 'remote'}
                          onChange={() => setChoices(prev => ({ ...prev, [c.key]: 'remote' }))}
                          className="accent-[var(--accent-strong)]"
                        />
                        <span className="text-[var(--muted-foreground)]">{remoteLabel}</span>
                        <span className="font-bold text-[var(--foreground)]">{formatVal(c.remoteVal)}</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
          <button type="button" onClick={() => setAll('local')}
            className="text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            全部采用{localLabel}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setAll('remote')}
              className="text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
              全部采用{remoteLabel}
            </button>
            <button type="button" onClick={handleConfirm}
              className="neu-btn-primary !h-9 !px-4 !text-xs">
              确认
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: tsc check**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/expert-portal/src/components/evaluate/sync-conflict-modal.tsx
git commit -m "feat(expert): 新建 SyncConflictModal 冲突裁决弹窗组件

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: ScoreHistoryDrawer component (new file)

**Files:**
- Create: `apps/expert-portal/src/components/evaluate/score-history-drawer.tsx`

**Interfaces:**
- Consumes: `getScoreHistory(projectId, supplierId)` from `@/lib/api` (Task 2)
- Produces: `<ScoreHistoryDrawer open projectId supplierId suppliers onClose />`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X, Loader2 } from 'lucide-react';
import { getScoreHistory, type ScoreHistoryItem } from '@/lib/api';
import { CATEGORY_LABEL } from '@water-erp/shared';

interface Props {
  open: boolean;
  projectId: string;
  supplierId: string | null;
  suppliers: Array<{ id: string; supplierName: string }>;
  onClose: () => void;
}

export function ScoreHistoryDrawer({ open, projectId, supplierId: initialSupplierId, suppliers, onClose }: Props) {
  const [selectedSupplier, setSelectedSupplier] = useState(initialSupplierId ?? suppliers[0]?.id ?? '');
  const [history, setHistory] = useState<ScoreHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedSupplier) setSelectedSupplier(initialSupplierId ?? selectedSupplier);
  }, [initialSupplierId]);

  useEffect(() => {
    if (!open || !selectedSupplier) return;
    setLoading(true);
    getScoreHistory(projectId, selectedSupplier)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [open, projectId, selectedSupplier]);

  if (!open) return null;

  // 按 category 分组
  const grouped: Record<string, ScoreHistoryItem[]> = {};
  for (const h of history) {
    if (!grouped[h.category]) grouped[h.category] = [];
    grouped[h.category].push(h);
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="wb-panel relative z-10 flex h-full w-[440px] max-w-[90vw] flex-col !rounded-r-none">
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
            <History size={14} strokeWidth={1.7} /> 评分历史
          </h2>
          <button type="button" onClick={onClose} className="neu-btn-xs is-square" aria-label="关闭">
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>
        <div className="px-4 pb-3">
          <select
            value={selectedSupplier}
            onChange={e => setSelectedSupplier(e.target.value)}
            className="neu-input !h-10 w-full text-sm"
          >
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.supplierName}</option>
            ))}
          </select>
        </div>
        <hr className="wb-section-rule shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[var(--muted-foreground)]">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="py-12 text-center text-xs text-[var(--muted-foreground)]">暂无评分历史</p>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="mb-5">
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
                  {CATEGORY_LABEL[category] || category}
                </div>
                <div className="space-y-2">
                  {items.map(h => (
                    <div key={h.scoreItemId} className="rounded-[10px] border border-[oklch(0.6_0.04_258/0.1)] bg-[oklch(0.975_0.012_258/0.3)] px-3 py-2">
                      <div className="mb-1 text-xs font-semibold text-[var(--foreground)]">{h.scoreItemName}</div>
                      <div className="space-y-0.5">
                        {h.history.map((snap, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                            <span>{snap.action === 'create' ? '✓' : '→'}</span>
                            <span className="font-medium">
                              {snap.passed === true ? '通过' : snap.passed === false ? '不通过' : `${snap.score}分`}
                            </span>
                            <span>{snap.action === 'create' ? '创建' : '修改'}</span>
                            <span>{new Date(snap.createdAt).toLocaleString('zh-CN')}</span>
                          </div>
                        ))}
                        {/* 当前值 */}
                        <div className="flex items-center gap-2 text-[10px] font-bold text-[var(--success)]">
                          <span>✓</span>
                          <span>
                            {h.current.passed === true ? '通过' : h.current.passed === false ? '不通过' : `${h.current.score}分`}
                          </span>
                          <span>当前</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: tsc check**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/expert-portal/src/components/evaluate/score-history-drawer.tsx
git commit -m "feat(expert): 新建 ScoreHistoryDrawer 评分历史抽屉组件

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Tablet page — modification confirmation + undo toast + remove save button + WS auto-merge + reset protection

**Files:**
- Modify: `apps/expert-portal/src/app/(tablet)/tablet/evaluate/[id]/page.tsx`

This is the most complex task. Work through each sub-step carefully.

- [ ] **Step 1: Add pendingModify state + skipAutoSaveRef**

After the existing `resetConfirmOpen` state (around line 359), add:

```typescript
  // 修改确认：拦截已有值的修改（平板防误触）
  const [pendingModify, setPendingModify] = useState<{
    scoreItemId: string;
    pointId: string;
    pointName: string;
    oldVal: PointDecisionValue;
    newVal: PointDecisionValue;
    applyFn: (val: PointDecisionValue) => void;
  } | null>(null);
  // 重置防误同步：跳过下一次 auto-save
  const skipAutoSaveRef = useRef(false);
  // WS 同步冲突
  const [draftConflicts, setDraftConflicts] = useState<Array<{
    key: string;
    scoreItemName: string;
    localVal: any;
    remoteVal: any;
  }>>([]);
```

- [ ] **Step 2: Add ConfirmDialog for pendingModify**

Find the existing `<ConfirmDialog open={resetConfirmOpen}...>` in the JSX (around line 749). After its closing `/>`, add:

```tsx
            <ConfirmDialog
              open={pendingModify !== null}
              title="确认修改评分"
              message={pendingModify ? `确定将「${pendingModify.pointName}」${
                pendingModify.oldVal.checked && !pendingModify.newVal.checked ? '取消勾选'
                : `从 ${pendingModify.oldVal.awardedScore} 分改为 ${pendingModify.newVal.awardedScore} 分`
              }？` : ''}
              confirmText="确认修改"
              cancelText="取消"
              danger
              onConfirm={() => {
                if (pendingModify) {
                  pendingModify.applyFn(pendingModify.newVal);
                  // undo toast
                  toast(`已将「${pendingModify.pointName}」修改`, {
                    action: {
                      label: '撤销',
                      onClick: () => pendingModify.applyFn(pendingModify.oldVal),
                    },
                    duration: 3000,
                  });
                }
                setPendingModify(null);
              }}
              onCancel={() => setPendingModify(null)}
            />
```

- [ ] **Step 3: Add tablet onChange interceptor**

Before the `if (loadError)` guard (around line 388), add a helper that wraps point changes with modification detection:

```typescript
  // 平板修改拦截器：检测已有值的修改 → 弹确认
  const makeTabletOnChange = (scoreItemId: string, itemPoints: any[], defaultApply: (pid: string, pv: PointDecisionValue) => void) => {
    return (pid: string, pv: PointDecisionValue) => {
      const k = scoreKey(activeSupplier, scoreItemId);
      const cur = scores[k];
      const oldPointVal = cur?.points?.[pid];
      const pointName = itemPoints.find(p => p.id === pid)?.name ?? pid;

      // 检测是否为修改（已有值 + 值不同）
      const isModify = oldPointVal && (
        oldPointVal.checked !== pv.checked ||
        oldPointVal.awardedScore !== pv.awardedScore
      );

      if (isModify) {
        setPendingModify({
          scoreItemId,
          pointId: pid,
          pointName,
          oldVal: oldPointVal,
          newVal: pv,
          applyFn: (val: PointDecisionValue) => defaultApply(pid, val),
        });
        return; // 不写入 scores — React 受控 checkbox 会自动回弹
      }
      defaultApply(pid, pv);
    };
  };
```

- [ ] **Step 4: Wire makeTabletOnChange into both PointChecklistScoring instances**

Replace the pass-fail `onChange` (around line 575):

Find:
```tsx
                                  onChange={(pid, pv) =>
                                    setScores(prev => {
```

Replace the entire `onChange` prop with:

```tsx
                                  onChange={makeTabletOnChange(item.id, pfPoints, (pid, pv) =>
                                    setScores(prev => {
                                      const cur = prev[k] ?? { score: 0, reason: '' };
                                      const points = { ...(cur.points ?? pfValueMap), [pid]: pv };
                                      const objectivePts = pfPoints.filter(p => p.objective);
                                      const allChecked = objectivePts.length > 0 && objectivePts.every(p => points[p.id]?.checked === true);
                                      return { ...prev, [k]: { ...cur, points, score: 0, reason: cur.reason ?? '', passed: allChecked } };
                                    })
                                  )}
```

Similarly replace the scoring `onChange` (around line 630):

```tsx
                              onChange={makeTabletOnChange(item.id, itemPoints, (pid, pv) =>
                                setScores(prev => {
                                  const cur = prev[k] ?? { score: 0, reason: '' };
                                  const points = { ...(cur.points ?? {}), [pid]: pv };
                                  const score = itemPoints.reduce(
                                    (s, p) => s + (points[p.id]?.awardedScore ?? 0),
                                    0,
                                  );
                                  return { ...prev, [k]: { ...cur, points, score } };
                                })
                              )}
```

- [ ] **Step 5: Add skipAutoSaveRef to auto-save effect**

In the auto-save effect (around line 183), add at the start of the setTimeout callback:

```typescript
    draftTimer.current = setTimeout(() => {
      if (skipAutoSaveRef.current) { skipAutoSaveRef.current = false; return; }
      // ... existing code ...
```

- [ ] **Step 6: Update resetCurrentSupplier to set skipAutoSaveRef**

Replace the existing `resetCurrentSupplier` (around line 250):

```typescript
  const resetCurrentSupplier = useCallback(() => {
    if (!activeSupplier) return;
    skipAutoSaveRef.current = true;
    setScores((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${activeSupplier}:`)) delete next[k];
      }
      return next;
    });
    toast.success('已重置当前供应商评分（不影响桌面端已同步的草稿）');
  }, [activeSupplier]);
```

- [ ] **Step 7: Replace onDraftSaved handler — auto-merge instead of banner**

Replace the existing `onDraftSaved` in the WS handler (around line 145):

```typescript
    onDraftSaved: (d) => {
      if (d.device === 'tablet') return;
      // 从服务端拉取合并后的草稿
      api.get<{ scores: Record<string, ScoreEntry>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft?device=tablet`)
        .then(draft => {
          if (!draft?.scores) return;
          const newItems: string[] = [];
          const conflicts: typeof draftConflicts = [];
          for (const [key, remoteVal] of Object.entries(draft.scores)) {
            if (!(key in scores)) {
              newItems.push(key);
            } else if (JSON.stringify(scores[key]) !== JSON.stringify(remoteVal)) {
              const itemName = project?.scoreItems.find(si => key.endsWith(`:${si.id}`))?.name ?? key;
              conflicts.push({ key, scoreItemName: itemName, localVal: scores[key], remoteVal });
            }
          }
          // 静默合并新增项
          if (newItems.length > 0) {
            setScores(prev => {
              const next = { ...prev };
              for (const k of newItems) next[k] = draft.scores![k];
              return next;
            });
          }
          // 冲突项存入 state → 显示横幅
          if (conflicts.length > 0) {
            setDraftConflicts(prev => [...prev, ...conflicts]);
          }
        })
        .catch(() => {});
    },
```

- [ ] **Step 8: Add conflict banner above the scoring area**

Before the `{/* 供应商选择条 */}` comment (around line 436), add:

```tsx
      {/* WS 同步冲突横幅 */}
      {draftConflicts.length > 0 && (
        <div className="flex flex-shrink-0 items-center gap-3 rounded-[10px] px-4 py-2"
          style={{ background: 'color-mix(in oklch, var(--warning) 10%, transparent)', borderLeft: '3px solid var(--warning)' }}>
          <AlertTriangle size={15} className="shrink-0 text-[var(--warning)]" />
          <span className="flex-1 text-xs font-semibold text-[var(--warning)]">
            检测到 {draftConflicts.length} 项评分变更（来自桌面端）
          </span>
          <button type="button"
            onClick={() => setConflictModalOpen(true)}
            className="neu-btn-xs !h-9 !px-3">处理</button>
        </div>
      )}
```

Add `AlertTriangle` to the lucide import at line 6.

Add state:
```typescript
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
```

Add `SyncConflictModal` import and render:
```typescript
import { SyncConflictModal } from '@/components/evaluate/sync-conflict-modal';
```

At the end of the return JSX (before closing `</div>`):
```tsx
      <SyncConflictModal
        open={conflictModalOpen}
        newItems={[]}
        conflictItems={draftConflicts.map(c => ({
          key: c.key,
          scoreItemName: c.scoreItemName,
          localVal: c.localVal,
          remoteVal: c.remoteVal,
          remoteDevice: 'desktop',
        }))}
        localDevice="tablet"
        onConfirm={(resolved) => {
          setScores(prev => {
            const next = { ...prev };
            for (const c of draftConflicts) {
              if (resolved[c.key] === 'remote') next[c.key] = c.remoteVal;
            }
            return next;
          });
          setDraftConflicts([]);
          setConflictModalOpen(false);
        }}
        onClose={() => setConflictModalOpen(false)}
      />
```

- [ ] **Step 9: Remove save button + saveDraft + draftSaving**

Remove the `saveDraft` function (around line 210), `draftSaving` state (around line 53), and the save button JSX (around line 740-748). Keep `draftAvailable`/`restoreDraft`/`discardDraft` for initial load recovery.

Update the operation bar to only show reset:

```tsx
      {/* 操作栏：重置（平板仅草稿，正式提交请在桌面端完成） */}
      <div className="flex flex-shrink-0 flex-col items-center gap-2">
        {!scoreLocked && (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              disabled={!canScoreActiveSupplier}
              className="neu-btn-soft is-danger !h-12 !px-6"
            >
              <RotateCcw size={16} strokeWidth={1.7} />
              重置
            </button>
            <ConfirmDialog
              open={resetConfirmOpen}
              title="重置当前供应商评分"
              message="将清空当前供应商已录入的全部评分（不影响桌面端已同步的草稿）。"
              confirmText="重置"
              cancelText="取消"
              danger
              onConfirm={() => { resetCurrentSupplier(); setResetConfirmOpen(false); }}
              onCancel={() => setResetConfirmOpen(false)}
            />
          </div>
        )}
        <p className="text-[10px] text-[var(--muted-foreground)]">
          评分实时同步至桌面端 · 请在桌面端审阅并提交
        </p>
      </div>
```

Remove unused `Save` from lucide import.

- [ ] **Step 10: tsc check**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 11: Commit**

```bash
git add apps/expert-portal/src/app/\(tablet\)/tablet/evaluate/\[id\]/page.tsx
git commit -m "feat(expert): 平板修改确认 + undo toast + 删暂存 + WS 自动合并 + 重置防误同步

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Desktop page — undo toast + WS auto-merge + conflict banner + memo→history button + history drawer

**Files:**
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`

- [ ] **Step 1: Add imports and state**

Add to imports at line 12:

```typescript
import { SyncConflictModal } from '@/components/evaluate/sync-conflict-modal';
import { ScoreHistoryDrawer } from '@/components/evaluate/score-history-drawer';
import { getScoreHistory as _getScoreHistory } from '@/lib/api';
```

Add `History` to the lucide import at line 12.

After the `pointMemoCounts` state (around line 87), add:

```typescript
  const [draftConflicts, setDraftConflicts] = useState<Array<{
    key: string;
    scoreItemName: string;
    localVal: any;
    remoteVal: any;
  }>>([]);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
```

- [ ] **Step 2: Add undo toast to handlePointChange**

In `handlePointChange` (around line 412), after `saveDraftNow(next)`, add undo toast for modifications:

```typescript
    // undo toast for modifications (not new items)
    const oldPointVal = cur.points?.[pointId];
    if (oldPointVal && (oldPointVal.checked !== value.checked || oldPointVal.awardedScore !== value.awardedScore)) {
      const pointName = si?.points?.find(p => p.id === pointId)?.name ?? pointId;
      toast(`已将「${pointName}」修改`, {
        action: {
          label: '撤销',
          onClick: () => {
            handlePointChange(scoreItemId, pointId, oldPointVal);
          },
        },
        duration: 3000,
      });
    }
```

- [ ] **Step 3: Replace onDraftSaved handler — auto-merge**

Replace the existing `onDraftSaved` in the WS handler (around line 164):

```typescript
    onDraftSaved: (d) => {
      if (d.device === 'desktop') return;
      api.get<{ scores: Record<string, { score: number; reason: string; passed?: boolean; points?: Record<string, { checked: boolean; awardedScore: number }> }>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft?device=desktop`)
        .then(draft => {
          if (!draft?.scores) return;
          const newItems: string[] = [];
          const conflicts: typeof draftConflicts = [];
          for (const [key, remoteVal] of Object.entries(draft.scores)) {
            if (!(key in scores)) {
              newItems.push(key);
            } else if (JSON.stringify(scores[key]) !== JSON.stringify(remoteVal)) {
              const itemName = project?.scoreItems.find(si => key.endsWith(`:${si.id}`))?.name ?? key;
              conflicts.push({ key, scoreItemName: itemName, localVal: scores[key], remoteVal });
            }
          }
          if (newItems.length > 0) {
            setScores(prev => {
              const next = { ...prev };
              for (const k of newItems) next[k] = draft.scores![k];
              return next;
            });
          }
          if (conflicts.length > 0) {
            setDraftConflicts(prev => [...prev, ...conflicts]);
          }
        })
        .catch(() => {});
    },
```

- [ ] **Step 4: Replace memo button with history button**

Find the memo button (around line 1527-1534) and replace:

```tsx
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="neu-btn-xs shrink-0"
                  aria-label="查看评分历史"
                >
                  <History size={14} strokeWidth={1.7} /> 评分历史
                </button>
```

- [ ] **Step 5: Add conflict banner + SyncConflictModal + ScoreHistoryDrawer**

Inside the scoring step's `<div className="p-6">` (around line 1520), at the very top before the header div, add the conflict banner:

```tsx
              {/* WS 同步冲突横幅 */}
              {draftConflicts.length > 0 && (
                <div className="mb-4 flex items-center gap-3 rounded-[10px] px-4 py-2"
                  style={{ background: 'color-mix(in oklch, var(--warning) 10%, transparent)', borderLeft: '3px solid var(--warning)' }}>
                  <AlertTriangle size={15} className="shrink-0 text-[var(--warning)]" />
                  <span className="flex-1 text-xs font-semibold text-[var(--warning)]">
                    检测到 {draftConflicts.length} 项评分变更（来自平板端）
                  </span>
                  <button type="button"
                    onClick={() => setConflictModalOpen(true)}
                    className="neu-btn-xs !h-9 !px-3">处理</button>
                </div>
              )}
```

At the end of the component (before the final `</div>`), add:

```tsx
        {/* 冲突裁决弹窗 */}
        <SyncConflictModal
          open={conflictModalOpen}
          newItems={[]}
          conflictItems={draftConflicts.map(c => ({
            key: c.key,
            scoreItemName: c.scoreItemName,
            localVal: c.localVal,
            remoteVal: c.remoteVal,
            remoteDevice: 'tablet',
          }))}
          localDevice="desktop"
          onConfirm={(resolved) => {
            setScores(prev => {
              const next = { ...prev };
              for (const c of draftConflicts) {
                if (resolved[c.key] === 'remote') next[c.key] = c.remoteVal;
              }
              return next;
            });
            setDraftConflicts([]);
            setConflictModalOpen(false);
          }}
          onClose={() => setConflictModalOpen(false)}
        />
        {/* 评分历史抽屉 */}
        <ScoreHistoryDrawer
          open={historyOpen}
          projectId={projectId}
          supplierId={activeSupplier}
          suppliers={project?.suppliers.map(s => ({ id: s.id, supplierName: s.supplierName })) ?? []}
          onClose={() => setHistoryOpen(false)}
        />
```

- [ ] **Step 6: tsc check**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add apps/expert-portal/src/app/\(app\)/evaluate/\[id\]/page.tsx
git commit -m "feat(expert): 桌面 undo toast + WS 自动合并 + 冲突横幅/弹窗 + 评分历史抽屉

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Final verification — tsc + lint

- [ ] **Step 1: Build shared packages**

```bash
pnpm --filter @water-erp/shared build
```

- [ ] **Step 2: TypeScript check all apps**

```bash
cd apps/expert-portal && npx tsc --noEmit --pretty 2>&1 | head -10
cd ../../apps/api && npx tsc --noEmit --pretty 2>&1 | grep "error TS" | grep -v "supplier.service\|e2e" | head -5
```

Expected: 0 new errors.

- [ ] **Step 3: Lint API**

```bash
pnpm --filter api lint
```

Expected: 0 errors (warnings OK).

- [ ] **Step 4: Verify PointChecklistScoring unchanged**

```bash
git diff HEAD~7 -- apps/expert-portal/src/components/evaluate/point-checklist-scoring.tsx
```

Expected: no changes to this file.

---

## Spec Coverage Checklist

| Spec Section | Task(s) |
|-------------|---------|
| §3 评分变更分级 | Task 5 (tablet), Task 6 (desktop) |
| §4 平板修改二次确认 | Task 5 Steps 1-4 |
| §4.3 Undo Toast | Task 5 Step 2, Task 6 Step 2 |
| §5.1 累积模型 WS auto-merge | Task 5 Step 7, Task 6 Step 3 |
| §5.3 顶部横幅 | Task 5 Step 8, Task 6 Step 5 |
| §5.4 冲突裁决弹窗 | Task 3 (component), Task 5 Step 8, Task 6 Step 5 |
| §5.5 冲突检测算法 (JSON.stringify) | Task 5 Step 7, Task 6 Step 3 |
| §6 平板操作栏调整 | Task 5 Steps 5-6, 9 |
| §7 评分历史后端 | Task 1 |
| §7 评分历史前端 | Task 2 (API), Task 4 (drawer), Task 6 Step 4-5 |
