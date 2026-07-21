# 评分模板库前端 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 bid-portal 评分标准页补"保存模板"UI——存当前项目为命名模板、列表浏览（自己+公共）、应用模板、删除模板。

**Architecture:** 入口形态 A：`bid/standard/page.tsx` 工具栏新增 [存为模板][模板库] 两个按钮，各唤起一个 Dialog 组件（同 `score-points-editor.tsx` 模式）。后端四端点已就绪，仅需 `listScoreTemplates` 的 `select` 补 `createdById`，让前端用 `!!createdById` 区分"我的/公共"。

**Tech Stack:** Next.js 16 (App Router) + React 19 + Tailwind v4 + Lucide + sonner；后端 NestJS + Prisma + Jest。

## Global Constraints

- **设计系统**（`.impeccable.md`）：navy→ice 蓝调色板（主色 `#064ea2`、成功 `#11a874`、危险 `#e74c3c`）；按钮 `rounded-xl`、卡片 `rounded-2xl`；Lucide 图标 `strokeWidth={1.5}`；**禁止**渐变按钮、emoji 当图标、Material 阴影。复用现有 `workbench-input` / `workbench-table` class。
- **无 mock 回退**：只展示真实接口数据 / loading / empty 状态。
- **TS**：tsconfig 无 `esModuleInterop`（本计划不涉及 CJS fn 导出，无影响）。
- **commit**：信息末尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`；不主动 push。
- **错误处理**：所有动作 `try/catch` + `sonner` toast（`e?.message` 透出后端 error）。
- **锁定期语义**：`存为模板` 在 `items.length>0` 时可用（锁定后仍可，做快照）；`模板库 [应用]` 仅 `!locked` 可用。

---

## File Structure

| 文件 | 动作 | 职责 |
|------|------|------|
| `apps/api/src/bid/bid.service.ts:2213` | Modify | `listScoreTemplates` select 加 `createdById: true` |
| `apps/api/src/bid/bid.service.spec.ts` | Modify | 补 `scoreTemplate` mock + `listScoreTemplates` 用例 |
| `apps/bid-portal/src/lib/api/bid.ts` | Modify | 加 `ScoreTemplateSummary` 类型 + 4 个封装函数 |
| `apps/bid-portal/src/app/(dashboard)/bid/standard/save-template-dialog.tsx` | Create | 命名存模板弹窗 |
| `apps/bid-portal/src/app/(dashboard)/bid/standard/template-library-dialog.tsx` | Create | 模板库列表（应用/删除） |
| `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx` | Modify | 工具栏接线 + 渲染两弹窗 |

依赖顺序：Task 1（后端）→ Task 2（api 封装，组件依赖）→ Task 3/4（组件）→ Task 5（接线）→ Task 6（验收）。

---

### Task 1: 后端 `listScoreTemplates` 返回 `createdById`

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:2213`
- Test: `apps/api/src/bid/bid.service.spec.ts`（score items describe 块，line 1009-1116）

**Interfaces:**
- Produces: `listScoreTemplates(userId?)` 返回值每项含 `createdById: string | null`（null=公共模板，非空=当前用户的模板）。

- [ ] **Step 1: 写失败测试**

在 `apps/api/src/bid/bid.service.spec.ts` 的 score items `beforeEach`（约 line 1014-1020）的 prisma mock 对象里，`bidSupervisionLog: { create: jest.fn() },` 之后加一行：

```ts
      scoreTemplate: { findMany: jest.fn() },
```

再在该 describe 块末尾（line 1115 的 `it('applyScoreItemTemplate 在 EVALUATING 阶段锁定', ...)` 之后、line 1116 的 `});` 之前）加：

```ts
  it('listScoreTemplates select 含 createdById（前端区分我的/公共）', async () => {
    prisma.scoreTemplate.findMany.mockResolvedValue([
      { id: 't1', name: '水务通用', createdById: 'u1', createdByName: '张三', createdAt: new Date() },
      { id: 't2', name: '公共模板', createdById: null, createdByName: null, createdAt: new Date() },
    ]);
    const res = await service.listScoreTemplates('u1');
    expect(prisma.scoreTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ id: true, name: true, createdById: true, createdByName: true, createdAt: true }),
    }));
    expect(res).toHaveLength(2);
    expect(res[0].createdById).toBe('u1');
    expect(res[1].createdById).toBeNull();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter api test -- bid.service.spec -t "createdById"`
Expected: FAIL —— `select` 不含 `createdById`，`objectContaining` 断言不通过。

- [ ] **Step 3: 改实现**

`apps/api/src/bid/bid.service.ts:2213`，把：

```ts
      select: { id: true, name: true, createdByName: true, createdAt: true },
```

改为：

```ts
      select: { id: true, name: true, createdById: true, createdByName: true, createdAt: true },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter api test -- bid.service.spec -t "createdById"`
Expected: PASS。再跑整块确保无回归：`pnpm --filter api test -- bid.service.spec`（全绿）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(bid): listScoreTemplates 返回 createdById 供前端区分我的/公共

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 前端 api 封装 + 类型

**Files:**
- Modify: `apps/bid-portal/src/lib/api/bid.ts`（在 `batchCreateScorePoints` 函数之后、`listEvaluationResults` 之前插入，约 line 242）

**Interfaces:**
- Produces（供 Task 3/4/5 使用）：

```ts
export interface ScoreTemplateSummary {
  id: string;
  name: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
}
export function listScoreTemplates(): Promise<ScoreTemplateSummary[]>
export function saveScoreTemplate(projectId: string, name: string): Promise<ScoreTemplateSummary>
export function deleteScoreTemplate(templateId: string): Promise<void>
export function applyScoreTemplateById(projectId: string, templateId: string): Promise<ScoreItem[]>
```

- [ ] **Step 1: 加封装代码**

在 `apps/bid-portal/src/lib/api/bid.ts` 的 `batchCreateScorePoints` 函数之后插入：

```ts
// ── 评分模板（用户保存的可复用整套评分标准）──

export interface ScoreTemplateSummary {
  id: string;
  name: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
}

export function listScoreTemplates() {
  return api.get<ScoreTemplateSummary[]>('/bid/score-templates');
}

export function saveScoreTemplate(projectId: string, name: string) {
  return api.post<ScoreTemplateSummary>('/bid/score-templates', { projectId, name });
}

export function deleteScoreTemplate(templateId: string) {
  return api.delete<void>(`/bid/score-templates/${templateId}`);
}

export function applyScoreTemplateById(projectId: string, templateId: string) {
  return api.post<ScoreItem[]>(`/bid/projects/${projectId}/apply-score-template/${templateId}`, {});
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter bid-portal build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 3: Commit**

```bash
git add apps/bid-portal/src/lib/api/bid.ts
git commit -m "feat(bid-portal): 评分模板 api 封装 + ScoreTemplateSummary 类型

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: `SaveTemplateDialog` 组件

**Files:**
- Create: `apps/bid-portal/src/app/(dashboard)/bid/standard/save-template-dialog.tsx`

**Interfaces:**
- Consumes: `saveScoreTemplate(projectId, name)` from Task 2；`Dialog` from `@/components/dialog`；`toast` from `sonner`。
- Produces: `SaveTemplateDialog` 组件，props `{ open: boolean; onClose: () => void; projectId: string }`。

- [ ] **Step 1: 写组件**

创建 `apps/bid-portal/src/app/(dashboard)/bid/standard/save-template-dialog.tsx`：

```tsx
'use client';

import { useState } from 'react';
import { saveScoreTemplate } from '@/lib/api/bid';
import Dialog from '@/components/dialog';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export function SaveTemplateDialog({ open, onClose, projectId }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const handleClose = () => {
    setName('');
    onClose();
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('请填写模板名称');
      return;
    }
    setBusy(true);
    try {
      await saveScoreTemplate(projectId, name.trim());
      toast.success('已保存为模板');
      setName('');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="存为评分模板"
      width="max-w-sm"
      footer={
        <>
          <button
            onClick={handleClose}
            className="rounded-xl border border-[#dce6f3] px-4 py-2 text-xs font-bold text-[#5a6d8a] transition hover:bg-[#f8fafc]"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#054280] disabled:opacity-50"
          >
            确认保存
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[#5a6d8a]">将当前项目的评分项与得分点保存为可复用模板。</p>
      <input
        type="text"
        autoFocus
        placeholder="模板名称（如：水务工程通用评分模板）"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="workbench-input w-full"
      />
    </Dialog>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter bid-portal build`
Expected: 构建成功（组件未接线，导出即可，不影响构建）。

- [ ] **Step 3: Commit**

```bash
git add apps/bid-portal/src/app/\(dashboard\)/bid/standard/save-template-dialog.tsx
git commit -m "feat(bid-portal): SaveTemplateDialog 存模板弹窗

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: `TemplateLibraryDialog` 组件

**Files:**
- Create: `apps/bid-portal/src/app/(dashboard)/bid/standard/template-library-dialog.tsx`

**Interfaces:**
- Consumes: `listScoreTemplates` / `applyScoreTemplateById` / `deleteScoreTemplate` / `ScoreTemplateSummary` / `ScoreItem` from Task 2；`Dialog`；`toast`；Lucide `FileSpreadsheet`/`Trash2`。
- Produces: `TemplateLibraryDialog`，props `{ open; onClose; projectId: string; locked: boolean; onChanged: (items: ScoreItem[]) => void }`。

- [ ] **Step 1: 写组件**

创建 `apps/bid-portal/src/app/(dashboard)/bid/standard/template-library-dialog.tsx`：

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  listScoreTemplates,
  applyScoreTemplateById,
  deleteScoreTemplate,
  type ScoreTemplateSummary,
  type ScoreItem,
} from '@/lib/api/bid';
import Dialog from '@/components/dialog';
import { FileSpreadsheet, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  locked: boolean;
  onChanged: (items: ScoreItem[]) => void;
}

export function TemplateLibraryDialog({ open, onClose, projectId, locked, onChanged }: Props) {
  const [templates, setTemplates] = useState<ScoreTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScoreTemplateSummary | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setTemplates(await listScoreTemplates());
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleApply = async (t: ScoreTemplateSummary) => {
    setApplyingId(t.id);
    try {
      const updated = await applyScoreTemplateById(projectId, t.id);
      onChanged(updated);
      toast.success(`已应用模板「${t.name}」`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '应用失败');
    } finally {
      setApplyingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteScoreTemplate(target.id);
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      toast.success('已删除');
    } catch (e: any) {
      toast.error(e?.message || '删除失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} title="评分模板库" width="max-w-2xl">
        <p className="mb-3 rounded-lg bg-[#f3f7fc] px-3 py-2 text-xs text-[#5a6d8a]">
          应用按名称合并到当前项目（已存在的项不重复添加），不会覆盖或删除已有项。
        </p>

        {loading ? (
          <div className="py-10 text-center text-sm text-[#8a96aa]">加载中…</div>
        ) : templates.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#8a96aa]">
            尚无保存的模板。可在评分项页用「存为模板」创建。
          </div>
        ) : (
          <div className="space-y-1.5">
            {templates.map((t) => {
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
                      title="删除模板"
                      className="rounded-lg p-1.5 text-[#5a6d8a] transition hover:bg-[#fef2f2] hover:text-[#e74c3c]"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="确认删除"
        width="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setDeleteTarget(null)}
              className="rounded-xl border border-[#dce6f3] px-4 py-2 text-xs font-bold text-[#5a6d8a] transition hover:bg-[#f8fafc]"
            >
              取消
            </button>
            <button
              onClick={handleDelete}
              className="rounded-xl bg-[#e74c3c] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#c0392b]"
            >
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm text-[#5a6d8a]">
          确定要删除模板「{deleteTarget?.name}」吗？此操作不可撤销。
        </p>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter bid-portal build`
Expected: 构建成功。

- [ ] **Step 3: Commit**

```bash
git add apps/bid-portal/src/app/\(dashboard\)/bid/standard/template-library-dialog.tsx
git commit -m "feat(bid-portal): TemplateLibraryDialog 模板库列表(应用/删除)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: `page.tsx` 工具栏接线

**Files:**
- Modify: `apps/bid-portal/src/app/(dashboard)/bid/standard/page.tsx`

**Interfaces:**
- Consumes: `SaveTemplateDialog` / `TemplateLibraryDialog`（Task 3/4）；现有 `locked` / `items` / `setItems` / `projectId`。

- [ ] **Step 1: 加 import**

文件顶部 lucide import 行（line 15）：

```tsx
import { Plus, Pencil, Trash2, Check, X, FileSpreadsheet, Lock, ChevronRight, ChevronDown } from 'lucide-react';
```

改为（加 `Save`）：

```tsx
import { Plus, Pencil, Trash2, Check, X, FileSpreadsheet, Lock, ChevronRight, ChevronDown, Save } from 'lucide-react';
```

在 `import { ScorePointsEditor } from './score-points-editor';`（line 18）之后加两行：

```tsx
import { SaveTemplateDialog } from './save-template-dialog';
import { TemplateLibraryDialog } from './template-library-dialog';
```

- [ ] **Step 2: 加 state**

在 `const [expanded, setExpanded] = useState<Record<string, boolean>>({});`（line 34）之后加：

```tsx
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [showLib, setShowLib] = useState(false);
```

- [ ] **Step 3: 重构工具栏 `action`**

把 `<SectionCard ... action={!locked && (<div ...>...</div>)}>`（line 163-189）的 `action` 整段替换为：

```tsx
        action={
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                onClick={() => setShowSaveTpl(true)}
                className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
              >
                <Save size={14} strokeWidth={1.8} />
                存为模板
              </button>
            )}
            <button
              onClick={() => setShowLib(true)}
              className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
            >
              <FileSpreadsheet size={14} strokeWidth={1.8} />
              模板库
            </button>
            {!locked && (
              <>
                <button
                  onClick={handlePublish}
                  className="flex items-center gap-1.5 rounded-xl bg-[#11a874] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#0e8f61]"
                >
                  <Check size={14} strokeWidth={1.8} />
                  发布评分标准
                </button>
                <button
                  onClick={handleApplyTemplate}
                  className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] bg-white px-3 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f8fbff]"
                >
                  <FileSpreadsheet size={14} strokeWidth={1.8} />
                  应用标准模板
                </button>
                <button
                  onClick={() => { setShowAdd(true); setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 }); }}
                  className="flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-3 py-2 text-sm font-bold text-white transition hover:bg-[#054280]"
                >
                  <Plus size={14} strokeWidth={2} />
                  新增评分项
                </button>
              </>
            )}
          </div>
        }
```

- [ ] **Step 4: 渲染两弹窗**

在删除确认 `<Dialog ...>...</Dialog>`（约 line 372-392）之后、组件最外层 `</div>`（line 393）之前加：

```tsx
      <SaveTemplateDialog open={showSaveTpl} onClose={() => setShowSaveTpl(false)} projectId={projectId} />
      <TemplateLibraryDialog
        open={showLib}
        onClose={() => setShowLib(false)}
        projectId={projectId}
        locked={locked}
        onChanged={setItems}
      />
```

- [ ] **Step 5: 类型检查 + 构建**

Run: `pnpm --filter bid-portal build`
Expected: 构建成功，无 TS / lint 报错。

- [ ] **Step 6: Commit**

```bash
git add apps/bid-portal/src/app/\(dashboard\)/bid/standard/page.tsx
git commit -m "feat(bid-portal): 评分标准页工具栏接入存模板/模板库

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 手动验收

**Files:** 无（运行时验证）

- [ ] **Step 1: 起服务**

Run（独立终端）：`pnpm dev:api` 与 `pnpm dev:bid`（若 bid-portal 未在 `pnpm dev` 内则单独起）。用 `陈源远`（bid_host）从专家门户 admin tab 登录 → 进 bid-portal。

- [ ] **Step 2: 走验收清单**

逐项核对（对应 spec 验收清单）：

- [ ] 选一个**未发布、有评分项**的项目 → 工具栏可见 [存为模板][模板库][发布][应用标准模板][新增]。
- [ ] 点「存为模板」→ 输入名称 → 保存 → toast 成功。
- [ ] 点「模板库」→ 列表出现刚存的模板，徽标「我的」。
- [ ] 新建空项目 → 模板库里点某模板「应用」→ 评分项 + 得分点被 bootstrap 出来。
- [ ] 模板库点「删除」→ 二次确认 → 模板从列表消失。
- [ ] 把某项目发布评分标准（或进入评标）→ 工具栏仍可见 [存为模板][模板库]；模板库里 [应用] 置灰 + tooltip「评分标准已锁定」。
- [ ] 公共模板（`createdById=null` 的种子数据，若有）显示「公共」徽标。

- [ ] **Step 3: 回归后端单测**

Run: `pnpm --filter api test -- bid.service.spec`
Expected: 全绿（含 Task 1 新增用例 + 原 score items 用例）。

- [ ] **Step 4: 收尾 commit（如有运行时微调）**

若验收中发现小问题并修改，单独 commit；无则跳过。

---

## Self-Review（已自检）

- **Spec 覆盖**：spec 的组件设计/api 封装/后端微调/锁定语义/错误处理/验收清单均有对应 Task。✓
- **占位符**：无 TBD/TODO；所有代码步骤含完整代码。✓
- **类型一致**：`ScoreTemplateSummary.createdById: string | null`（Task 2）↔ Task 4 `mine = !!t.createdById` ↔ Task 1 测试断言 `createdById` 三处一致；`onChanged: (items: ScoreItem[]) => void` ↔ Task 5 `onChanged={setItems}`（`setItems` 接受 `ScoreItem[]`）。✓
- **依赖顺序**：Task 2 的封装被 Task 3/4 import、Task 4/5 的组件被 Task 5 import、Task 1 的 `createdById` 被 Task 4 的 `mine` 判断依赖——顺序无环。✓
