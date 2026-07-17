# 采购文件修改 · 前端拆分与保存链路解耦 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（inline）或 superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`).

**Goal:** 让前端用上新的定点补丁后端——保存时带 `originalHash`、保留 `data-pid`、保存判定与脆弱的追踪器解耦；并把 835 行单文件拆为单一职责的 hooks/组件；加 localStorage 草稿自动保存。

**Architecture:** 编辑器 DOM 为唯一真相；`handleSave` 序列化 innerHTML（含 `data-pid`）+ originalHash 发后端，后端 diff。追踪器（红标/历史）仅可视化，永不参与"存得对不对"。

**Tech Stack:** Next.js 16 (React 19) + Tailwind v4，**web 端无单测框架**——验证靠 `next build`/`tsc` + 运行时行为 + 视觉。

**配套：** spec §4；后端计划 `2026-07-17-tender-file-docx-patch-backend.md`（已完成）。

## Global Constraints

- 保持 `TenderFileEditorModal` 的 Props 契约不变（唯一调用方 `project-detail-panel.tsx:1434`）。
- 编辑体验零回退：红标、修改历史、AI 优化、双栏审阅、同步滚动、Ctrl+S 全部保留。
- web 无测试框架；每个任务结束跑 `pnpm --filter web build`（或至少 tsc）确认编译通过；行为变化用浏览器实测。
- `data-pid` 是后端 diff 的锚点——块级元素属性在编辑/序列化全程不得被剥离。
- 中文文案保持；遵循 [[web-3005-neumorphic-design]]（neu-* 类）。
- 不动 sidebar（[[sidebar-is-fixed]]）。

## 文件结构（目标）

```
apps/web/src/components/projects/tender-file-editor/
├─ index.tsx              编排器（~150 行）
├─ EditorPane.tsx · ReviewPane.tsx · HistoryPanel.tsx · AiToolbar.tsx · AiDialog.tsx
apps/web/src/hooks/projects/
├─ useAttachmentHtml.ts · useEditTracking.ts · useReviewImport.ts
├─ useSyncScroll.ts · useAiPolish.ts · useDraftAutosave.ts
```

原 `tender-file-editor-modal.tsx` 最终改为从 `tender-file-editor/index.tsx` re-export（保调用方不变）。

---

## Task 1: 保存链路解耦（功能核心）

**Files:** Modify `apps/web/src/components/projects/tender-file-editor-modal.tsx`

**目标：** 加载时存 `originalHash`；保存时带上、去掉 `isDirty`/`.tfe-modified` 依赖、改用 textContent 判"是否真的改了"；409 并发→提示刷新。

- [ ] **Step 1: 加载时捕获 originalHash + 原始 textContent**

在组件顶部加两个 ref：
```ts
const originalHashRef = useRef('');
const originalTextRef = useRef('');
```
把加载 `.then` 改为同时记录：
```ts
.then(d => {
  setRawHtml(d.html);
  originalHtmlRef.current = d.html;
  originalHashRef.current = d.originalHash ?? '';
  // 原始纯文本（去标签），用于"是否真的改了"判定，不依赖追踪器
  originalTextRef.current = d.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
})
```

- [ ] **Step 2: 重写 handleSave 的"是否改动"判定 + 发 originalHash**

把：
```ts
if (!isDirtyRef.current || editedHtml === originalHtmlRef.current) { toast.warning('没有检测到任何修改内容'); return; }
```
改为基于 textContent 的判定（与后端逐段文字 diff 语义一致）：
```ts
const currentText = (editorRef.current.textContent || '').replace(/\s+/g, ' ').trim();
if (currentText === originalTextRef.current) {
  toast.warning('没有检测到任何修改内容');
  return;
}
```
请求体加 `originalHash`：
```ts
body: JSON.stringify({ attachmentId, html: editedHtml, originalHash: originalHashRef.current }),
```

- [ ] **Step 3: 处理 409 并发冲突**

`handleSave` 的 fetch 错误处理里，409 → 提示并触发 onClose（让用户重开以加载最新）：
```ts
if (!r.ok) {
  let msg = `保存失败（${r.status}）`;
  try { msg = (await r.json() as any).message || msg; } catch {}
  if (r.status === 409) {
    toast.error(msg || '文件已被他人修改，请刷新重载');
    onClose(); // 关闭，强制重载
    return;
  }
  throw new Error(msg);
}
```

- [ ] **Step 4: 确认 data-pid 保留**

核对：MutationObserver 的 `markNodeModified`/`markElementModified` 只包裹内联 `<span class="tfe-modified">`，不修改块级元素属性；`handleSave` 序列化 `editorRef.current.innerHTML`，`data-pid` 随之发出。**无需改动**，仅需在代码注释里点明"勿动块级 data-pid"。

- [ ] **Step 5: 编译 + 浏览器实测**

```bash
pnpm --filter web build 2>&1 | tail -5
```
Expected: 编译通过。浏览器：打开采购文件修改→改一处文字→保存→应成功（后端 patcher 路径）；不改任何内容点保存→提示"没有检测到修改"；并发（手动改库）→409 提示。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/projects/tender-file-editor-modal.tsx
git commit -m "feat(tender-editor): decouple save from tracker, send originalHash, 409 handling"
```

---

## Task 2: 草稿自动保存（useDraftAutosave）

**Files:**
- Create: `apps/web/src/hooks/projects/useDraftAutosave.ts`
- Modify: `apps/web/src/components/projects/tender-file-editor-modal.tsx`

- [ ] **Step 1: 写 hook**

```ts
// apps/web/src/hooks/projects/useDraftAutosave.ts
import { useEffect, useRef } from 'react';

const PREFIX = 'tender-draft:';

export interface DraftData { html: string; savedAt: number; }

export function loadDraft(attachmentId: string): DraftData | null {
  try {
    const raw = localStorage.getItem(PREFIX + attachmentId);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch { return null; }
}

export function clearDraft(attachmentId: string) {
  localStorage.removeItem(PREFIX + attachmentId);
}

/** 防抖把 editor html 写入 localStorage；打开时由调用方读 loadDraft 决定是否恢复。 */
export function useDraftAutosave(attachmentId: string, getHtml: () => string, opts: { enabled: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const getHtmlRef = useRef(getHtml);
  getHtmlRef.current = getHtml;

  useEffect(() => {
    if (!opts.enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const html = getHtmlRef.current();
        if (html) localStorage.setItem(PREFIX + attachmentId, JSON.stringify({ html, savedAt: Date.now() }));
      } catch { /* 配额满等：静默 */ }
    }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [attachmentId, opts.enabled]); // 每次 editor 内容变化时由调用方触发（见 Step 2）
}
```

> 注：因编辑器内容变化不产生新依赖项，调用方在 MutationObserver 的 debounce 回调里调用一个 `bumpDraft` state setter 来触发 autosave effect。简化实现见 Step 2。

- [ ] **Step 2: 接入模态框**

在模态框加载 effect 末尾检测草稿：
```ts
const draft = loadDraft(attachmentId);
if (draft && draft.html && draft.html !== d.html) {
  // 用 sonner 的 toast询问恢复（异步 action）
  toast('检测到未保存的草稿，是否恢复？', {
    duration: 12000,
    action: { label: '恢复', onClick: () => { setRawHtml(draft.html); originalHtmlRef.current = d.html; } },
    cancel: { label: '丢弃', onClick: () => clearDraft(attachmentId) },
  });
}
```
在 MutationObserver 的 500ms debounce 回调里 bump 一个 `draftTick` state 触发 autosave；保存成功后 `clearDraft(attachmentId)`。

- [ ] **Step 3: 编译 + 实测**

```bash
pnpm --filter web build 2>&1 | tail -5
```
实测：编辑→等 2s→刷新页面/重开模态框→应提示恢复草稿；正常保存成功后不再提示。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/hooks/projects/useDraftAutosave.ts apps/web/src/components/projects/tender-file-editor-modal.tsx
git commit -m "feat(tender-editor): localStorage draft autosave + restore prompt"
```

---

## Task 3–7: 增量拆分（每步一个 build 验证）

> 无单测，每步靠 `pnpm --filter web build` 守住"行为等价"。顺序按耦合度从低到高，先抽干净的、最后抽核心。每步：抽 → build → 实测关键路径（打开/编辑/保存/AI/双栏）→ 提交。

- [ ] **Task 3: 抽 `useSyncScroll`**（最干净：两个 ref + 两个 callback）
- [ ] **Task 4: 抽 `useReviewImport`**（projectId + fetch + state）
- [ ] **Task 5: 抽 `useDraftAutosave` 接入整理 + `useAttachmentHtml`**（加载/哈希/草稿检测合一）
- [ ] **Task 6: 抽 `useAiPolish`**（aiPhase/aiData/toolbar/range/diff 逻辑）
- [ ] **Task 7: 抽 `useEditTracking`**（MutationObserver/块快照/标红/撤销/历史——最耦合，最后抽）
- [ ] **Task 8: 子组件化**（EditorPane/ReviewPane/HistoryPanel/AiToolbar/AiDialog），编排器瘦身到 ~150 行
- [ ] **Task 9: 原 `tender-file-editor-modal.tsx` 改为 re-export** `./tender-file-editor`，调用方不动

每个 Task 的 step 模板：① 移动代码到新文件（签名固定）→ ② 模态框改为 import 调用 → ③ `pnpm --filter web build` → ④ 浏览器实测关键路径 → ⑤ 提交。

---

## Self-Review

- spec §4 覆盖：保存解耦（Task 1）✓；草稿（Task 2）✓；拆分（Task 3–9）✓；并发守卫前端侧（Task 1 Step 3）✓；data-pid 保留（Task 1 Step 4）✓。
- 类型一致：后端 `getAttachmentHtml` 返回 `{ fileName, html, originalHash }`，前端 `d.originalHash` 对齐；`saveAttachmentHtml` body 含 `originalHash?`，前端发送对齐。
- 风险：Task 3–9 无单测、纯手工重构。缓解：增量、每步 build + 关键路径实测；最耦合的 `useEditTracking` 放最后。

## 执行顺序与检查点

Task 1 → 2（**功能核心 + 草稿，最高价值**）→ 检查点 → Task 3–9（增量拆分）。
