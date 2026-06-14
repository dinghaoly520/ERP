# Bid-Portal Feature Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all missing bid-portal features to support the full DOWNLOAD→SUBMIT→OPENING→EVALUATING→ARCHIVED lifecycle, fix design system violations, establish shared infrastructure, and add real-time updates via WebSocket.

**Architecture:** Phase 1 extracts duplicated patterns into shared hooks and a bid API service module, then aligns all pages to use shared constants. Phase 2 adds the four blocking features (create project, open-submission, start-evaluation, clarifications). Phase 3 adds management features (dashboard stats, dispute dialog). Phase 4 polishes UX (search/filter, archive states). Phase 5 adds extended features (edit project, admin submit bid, workspace readiness, CSV exports). Phase 6 adds WebSocket real-time push. Each phase produces a working, testable state.

**Total tasks:** 30 | **Files created:** ~10 | **Files modified:** ~12

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind CSS v4, Lucide React icons, sonner toasts, native `fetch` (no axios), `@water-erp/shared` workspace package.

---

## Phase 1: Foundation — Hooks, API Layer, Constants, Design Fixes

### Task 1.1: Create `useBidProjects` hook

**Files:**
- Create: `water-erp/apps/bid-portal/src/hooks/use-bid-projects.ts`

- [ ] **Step 1: Create the hook file**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SlimProject {
  id: string;
}

/**
 * Fetches the full project list on mount.
 * Returns the first project ID for convenience (used by sub-pages).
 */
export function useBidProjects() {
  const [projectIds, setProjectIds] = useState<SlimProject[]>([]);
  const [firstId, setFirstId] = useState('');

  useEffect(() => {
    api.get<SlimProject[]>('/bid/projects')
      .then(ps => {
        setProjectIds(ps);
        if (ps.length) setFirstId(ps[0].id);
      })
      .catch(() => {});
  }, []);

  return { projectIds, firstId };
}
```

- [ ] **Step 2: Verify the hook compiles**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No new errors related to `use-bid-projects.ts`.

---

### Task 1.2: Create `useBidProject` hook

**Files:**
- Create: `water-erp/apps/bid-portal/src/hooks/use-bid-project.ts`

- [ ] **Step 1: Create the hook file**

```typescript
'use client';

import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api';

/**
 * Fetches a single project detail by ID.
 * Supports optional auto-refresh via polling.
 * Returns { project, loading, reload }.
 */
export function useBidProject<T>(projectId: string, opts?: { pollIntervalMs?: number; enabled?: boolean }) {
  const [project, setProject] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    if (!projectId) return;
    setLoading(true);
    api.get<T>(`/bid/projects/${projectId}`)
      .then(p => setProject(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [projectId]);

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    if (opts?.pollIntervalMs && opts?.enabled !== false) {
      intervalRef.current = setInterval(load, opts.pollIntervalMs);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [projectId, opts?.pollIntervalMs, opts?.enabled]);

  return { project, loading, reload: load };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No new errors.

---

### Task 1.3: Create bid API service module

**Files:**
- Create: `water-erp/apps/bid-portal/src/lib/api/bid.ts`

- [ ] **Step 1: Create the API service file**

```typescript
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

// ── Project CRUD ──

export function listProjects() {
  return api.get<{ id: string }[]>('/bid/projects');
}

export function listProjectsFull() {
  return api.get<import('@/lib/types').BidProject[]>('/bid/projects');
}

export function getProject<T = BidProjectDetail>(id: string) {
  return api.get<T>(`/bid/projects/${id}`);
}

export function createProject(data: {
  name: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  riskNote?: string;
}) {
  return api.post<BidProjectDetail>('/bid/projects', data);
}

export function updateProject(id: string, data: { stage?: string; riskNote?: string }) {
  return api.patch<BidProjectDetail>(`/bid/projects/${id}`, data);
}

export function getDashboardStats() {
  return api.get<{
    totalProjects: number;
    activeProjects: number;
    totalSuppliers: number;
    approvedSuppliers: number;
    totalExperts: number;
    totalAnnouncements: number;
    stageDistribution: Record<string, number>;
    recentLogs: import('@/lib/types').BidSupervisionLog[];
  }>('/bid/dashboard-stats');
}

// ── Stage transitions ──

export function openSubmission(projectId: string) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/open-submission`, {});
}

export function startOpening(projectId: string, body: {
  host: string;
  supervisor: string;
  decryptWindowStart: string;
  decryptWindowEnd: string;
}) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/open`, body);
}

export function startEvaluation(projectId: string) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/start-evaluation`, {});
}

// ── Decrypt & Opening ──

export function decryptSupplier(projectId: string, supplierId: string, body?: {
  amount?: string; period?: string; qualityTarget?: string;
  bondStatus?: string; simulateDanger?: boolean;
}) {
  return api.post(`/bid/projects/${projectId}/decrypt/${supplierId}`, body || {});
}

export function resolveOpeningDispute(projectId: string, recordId: string, body: {
  result: string; confirm: boolean;
}) {
  return api.post(`/bid/projects/${projectId}/opening-records/${recordId}/resolve-dispute`, body);
}

// ── Evaluation ──

export function submitScore(projectId: string, body: {
  expertId: string; scoreItemId: string; supplierId: string;
  score: number; reason?: string;
}) {
  return api.post(`/bid/projects/${projectId}/scores`, body);
}

export function listScores(projectId: string) {
  return api.get(`/bid/projects/${projectId}/scores`);
}

export function listEvaluationResults(projectId: string) {
  return api.get<import('@/lib/types').EvaluationReport[]>(`/bid/projects/${projectId}/evaluation-results`);
}

export function generateEvaluationResults(projectId: string) {
  return api.post<import('@/lib/types').EvaluationReport[]>(`/bid/projects/${projectId}/evaluation-results/generate`, {});
}

// ── Clarifications ──

export function listClarifications(projectId: string) {
  return api.get<import('@/lib/types').BidClarification[]>(`/bid/projects/${projectId}/clarifications`);
}

export function createClarification(projectId: string, body: {
  question: string; issuer: string; supplierName: string;
}) {
  return api.post(`/bid/projects/${projectId}/clarifications`, body);
}

// ── Archive ──

export function archiveAll(projectId: string) {
  return api.post<BidProjectDetail>(`/bid/projects/${projectId}/archive-all`, {});
}

// ── Misc ──

export function getWorkspace(projectId: string) {
  return api.get(`/bid/projects/${projectId}/workspace`);
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No new errors.

---

### Task 1.4: Replace inline stage/status definitions with shared constants — Dashboard

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/page.tsx`

- [ ] **Step 1: Update imports and remove inline stageDefs**

Replace the import block (lines 1-7) and the inline `stageDefs` (lines 18-24) with:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { BidProject } from '@/lib/types';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import { Gavel, ArrowRight, Plus } from 'lucide-react';
```

Then remove lines 18-24 (the `stageDefs` object). Update the table rendering to use `STAGE_LABEL` and `STAGE_COLOR`:

In the table row (line 113), change:
```typescript
const stage = stageDefs[p.stage] || { label: p.stage, color: '#94a3b8' };
```
to:
```typescript
const label = STAGE_LABEL[p.stage] || p.stage;
const color = STAGE_COLOR[p.stage] || '#94a3b8';
```

And in the badge span (lines 124-125), change:
```typescript
style={{ color: stage.color, backgroundColor: `${stage.color}18` }}
>{stage.label}
```
to:
```typescript
style={{ color, backgroundColor: `${color}18` }}
>{label}
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 1.5: Replace inline decrypt/status definitions — Open page

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`

- [ ] **Step 1: Update imports and remove inline definitions**

Replace the import block (lines 1-9) and remove the inline `decryptDefs` (lines 11-16):

```typescript
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import { DECRYPT_LABEL, SEMANTIC } from '@water-erp/shared';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import StartOpeningDialog from '@/components/start-opening-dialog';
import { Unlock, Clock, Shield, Play, CheckCircle, XCircle, AlertTriangle, ChevronRight } from 'lucide-react';
```

Remove lines 11-16 (`decryptDefs` object). Then update the decrypt status rendering (line 150):
```typescript
const d = decryptDefs[s.decryptStatus] || decryptDefs.PENDING;
```
to:
```typescript
const decryptColors: Record<string, { color: string; bg: string }> = {
  PENDING: { color: SEMANTIC.warning, bg: '#fef6e8' },
  RUNNING: { color: '#064ea2', bg: '#eef4fc' },
  SUCCESS: { color: SEMANTIC.success, bg: '#f0faf6' },
  DANGER:  { color: SEMANTIC.danger, bg: '#fef2f2' },
};
const d = decryptColors[s.decryptStatus] || { color: '#6b7280', bg: '#f3f4f6' };
```

And the label (line 157):
```typescript
<span ...>{d.label}</span>
```
to:
```typescript
<span ...>{DECRYPT_LABEL[s.decryptStatus] || s.decryptStatus}</span>
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 1.6: Replace inline status definitions — Archive page

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/archive/page.tsx`

- [ ] **Step 1: Update imports and remove inline statusDefs**

Replace lines 1-8 (imports) and remove lines 11-16 (inline `statusDefs`):

```typescript
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import { STATUS_COLOR } from '@water-erp/shared';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import { Archive, CheckCircle, AlertTriangle, Package } from 'lucide-react';
```

Remove lines 11-16. Then update the status rendering (line 88):
```typescript
const s = statusDefs[a.status] || { label: a.status, color: '#94a3b8' };
```
to:
```typescript
const s = STATUS_COLOR[a.status] || { label: a.status, color: '#94a3b8', bg: '#94a3b818' };
```

And update the missing-items sidebar (line 109):
```typescript
{statusDefs[a.status]?.label}
```
to:
```typescript
{STATUS_COLOR[a.status]?.label || a.status}
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 1.7: Fix AppShell sidebar — replace purple with blue design tokens

**Files:**
- Modify: `water-erp/apps/bid-portal/src/components/app-shell.tsx`

- [ ] **Step 1: Replace hardcoded purple/hex values with OKLCH blue tokens**

The sidebar currently uses `#1e1b4b` (deep violet), `#7c3aed` (purple active), and `#c4b5fd` (lavender accent). Replace with the design system's blue palette from `globals.css` tokens.

Sidebar background (line 51):
```css
bg-[#1e1b4b]
```
→
```css
bg-[oklch(0.18_0.045_262)]
```
(This matches `--color-blue-950` from globals.css — deep navy blue.)

Active nav item (line 71):
```css
bg-[#7c3aed] text-white font-semibold shadow-[0_8px_20px_rgba(124,58,237,0.30)]
```
→
```css
bg-[oklch(0.42_0.14_260)] text-white font-semibold
```
(This removes the decorative shadow per Principle 4 and uses `--color-blue-700`.)

Active accent bar (line 76):
```css
bg-[#c4b5fd]
```
→
```css
bg-[oklch(0.75_0.08_260)]
```
(A lighter blue accent instead of lavender.)

Subtitle text (line 58):
```css
text-violet-300/60
```
→
```css
text-[oklch(0.75_0.06_262)]/60
```

- [ ] **Step 2: Verify the app builds**

Run: `cd water-erp && pnpm --filter bid-portal build 2>&1 | tail -5`
Expected: Build succeeds.

---

### Task 1.8: Re-export bid API from `@/lib/api`

**Files:**
- Modify: `water-erp/apps/bid-portal/src/lib/api.ts`

- [ ] **Step 1: Add bid API re-export**

After line 46 (`export * from './api/supplier';`), add:

```typescript
export * from './api/bid';
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

## Phase 2: Blocking Features — Complete the Bid Lifecycle

### Task 2.1: Create `CreateProjectDialog` component

**Files:**
- Create: `water-erp/apps/bid-portal/src/components/create-project-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

```typescript
'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const METHODS = ['公开招标', '邀请招标', '竞争性谈判', '询价', '单一来源'];

export default function CreateProjectDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [procurementMethod, setProcurementMethod] = useState('公开招标');
  const [openTime, setOpenTime] = useState('');
  const [deadline, setDeadline] = useState('');
  const [riskNote, setRiskNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) { setError('请输入项目名称'); return; }
    if (!openTime) { setError('请选择开标时间'); return; }
    if (!deadline) { setError('请选择截标时间'); return; }
    if (new Date(deadline) <= new Date(openTime)) { setError('截标时间必须晚于开标时间'); return; }

    setSubmitting(true);
    try {
      const { api } = await import('@/lib/api');
      await api.post('/bid/projects', {
        name: name.trim(),
        procurementMethod,
        openTime: new Date(openTime).toISOString(),
        deadline: new Date(deadline).toISOString(),
        riskNote: riskNote.trim() || undefined,
      });
      onCreated();
    } catch (e: any) {
      setError(e.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white w-full max-w-[480px] border border-[oklch(0.91_0.006_264)] shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            创建招标项目
          </h2>
          <button onClick={onClose} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              项目名称 <span className="text-[oklch(0.50_0.18_22)]">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例：2026年度水利工程材料采购"
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors
                placeholder:text-[oklch(0.72_0.008_264)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              采购方式
            </label>
            <select
              value={procurementMethod}
              onChange={e => setProcurementMethod(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors"
            >
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                开标时间 <span className="text-[oklch(0.50_0.18_22)]">*</span>
              </label>
              <input
                type="datetime-local"
                value={openTime}
                onChange={e => setOpenTime(e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                  focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                截标时间 <span className="text-[oklch(0.50_0.18_22)]">*</span>
              </label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                  focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              风险备注
            </label>
            <input
              value={riskNote}
              onChange={e => setRiskNote(e.target.value)}
              placeholder="选填"
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
                focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors
                placeholder:text-[oklch(0.72_0.008_264)]"
            />
          </div>

          {error && (
            <div className="bg-[oklch(0.96_0.03_22)] border border-[oklch(0.88_0.06_22)] p-3 text-[12px] text-[oklch(0.50_0.18_22)]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-between">
          <p className="text-[11px] text-[oklch(0.62_0.008_264)]">项目编号将自动生成（格式：BID-时间戳）</p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.55_0.01_264)] tracking-tight
                hover:text-[oklch(0.18_0.012_265)] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px]
                font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50"
            >
              <Plus size={13} strokeWidth={2} />
              {submitting ? '创建中…' : '确认创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 2.2: Add "Create Project" button to Dashboard

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/page.tsx`

- [ ] **Step 1: Add state and button**

After the existing `useState` lines, add:
```typescript
const [showCreate, setShowCreate] = useState(false);
```

After the import of `CreateProjectDialog`, add the import:
```typescript
import CreateProjectDialog from '@/components/create-project-dialog';
```

And update the Lucide import to include `Plus` (already done in Task 1.4).

- [ ] **Step 2: Add button next to the page title**

In the header section (after line 51, inside the `mb-10` div), add a button next to the title. Replace the header div with:

```typescript
<div className="mb-10">
  <div className="flex items-center justify-between">
    <div>
      <div className="flex items-center gap-2 text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-widest mb-2">
        <Gavel size={12} strokeWidth={1.5} />
        Bidding Management
      </div>
      <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
        开评标管理
      </h1>
      <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">统一入口 · 多端协同 · 限时开标 · 全程留痕</p>
    </div>
    <button
      onClick={() => setShowCreate(true)}
      className="flex items-center gap-1.5 px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors"
    >
      <Plus size={13} strokeWidth={2} /> 创建项目
    </button>
  </div>
</div>
```

- [ ] **Step 3: Add the dialog at the end of the return statement**

Before the final closing `</div>` of the component's return, add:
```typescript
<CreateProjectDialog
  open={showCreate}
  onClose={() => setShowCreate(false)}
  onCreated={() => {
    setShowCreate(false);
    api.get<BidProject[]>('/bid/projects').then(ps => { setProjects(ps); });
  }}
/>
```

- [ ] **Step 4: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 2.3: Add "Open Submission" button — stage transition DOWNLOAD→SUBMIT

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`

- [ ] **Step 1: Add open-submission button**

After the "启动开标" button (lines 130-135 in the current file), add a second button for the DOWNLOAD→SUBMIT transition. The button only appears when `project.stage === 'DOWNLOAD'`.

Add after the existing "启动开标" button block:

```typescript
{project.stage === 'DOWNLOAD' && (
  <button
    onClick={async () => {
      try {
        await api.post(`/bid/projects/${projectId}/open-submission`, {});
        const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
        setProject(updated);
      } catch (e: any) {
        alert(e.message || '开放投递失败');
      }
    }}
    className="flex items-center gap-1.5 px-4 py-2 bg-[oklch(0.54_0.16_158)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.14_150)] transition-colors"
  >
    <ChevronRight size={13} strokeWidth={2} /> 开放投递
  </button>
)}
```

- [ ] **Step 2: Add ChevronRight to imports**

Add `ChevronRight` to the lucide-react import (line 9). It should already be there from Task 1.5.

- [ ] **Step 3: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 2.4: Add "Start Evaluation" button — stage transition OPENING→EVALUATING

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/evaluate/page.tsx`

- [ ] **Step 1: Add start-evaluation button**

In the evaluate page, add a button that appears when `project.stage === 'OPENING'`. Place it next to the "生成评标结果" button area or in the page header.

After line 281 (the `ProjectSelector` line), add a stage transition button area. Insert between the header and Section 1:

```typescript
{project.stage === 'OPENING' && (
  <div className="bg-[oklch(0.96_0.04_260)] border border-[oklch(0.88_0.06_260)] p-4 mb-6 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <ChevronRight size={14} strokeWidth={1.5} className="text-[oklch(0.42_0.14_260)]" />
      <span className="text-[13px] text-[oklch(0.18_0.012_265)] tracking-tight">
        当前阶段：在线开标 — 所有供应商完成解密后，可启动专家评标
      </span>
    </div>
    <button
      onClick={async () => {
        try {
          await api.post(`/bid/projects/${projectId}/start-evaluation`, {});
          const updated = await api.get<BidProjectEvalDetail>(`/bid/projects/${projectId}`);
          setProject(updated);
          toast.success('已启动评标');
        } catch (e: any) {
          toast.error(e.message || '启动评标失败');
        }
      }}
      className="flex items-center gap-1.5 px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors"
    >
      <Play size={13} strokeWidth={2} /> 启动评标
    </button>
  </div>
)}
```

- [ ] **Step 2: Add missing icon imports**

Add `ChevronRight, Play` to the lucide-react import (line 13).

- [ ] **Step 3: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 2.5: Add "启动评标" icon import

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/evaluate/page.tsx`

- [ ] **Step 1: Verify the icon import**

Line 13 currently imports:
```typescript
import { UserCircle, CheckCircle, Clock, ShieldCheck, FileCheck, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
```

Add `Play`:
```typescript
import { UserCircle, CheckCircle, Clock, ShieldCheck, FileCheck, ChevronDown, ChevronRight, AlertTriangle, Play } from 'lucide-react';
```

(This is a small targeted edit to ensure the icon from Task 2.4 compiles.)

---

### Task 2.6: Create Clarifications page

**Files:**
- Create: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/clarifications/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail, BidClarification } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import { MessageSquare, Send, Plus, X } from 'lucide-react';

export default function BidClarificationsPage() {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [clarifications, setClarifications] = useState<BidClarification[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [issuer, setIssuer] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ id: string }[]>('/bid/projects').then(ps => {
      if (ps.length) setProjectId(ps[0].id);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`)
      .then(p => { setProject(p); setLoading(false); });
    api.get<BidClarification[]>(`/bid/projects/${projectId}/clarifications`)
      .then(setClarifications)
      .catch(() => setClarifications([]));
  }, [projectId]);

  const handleCreate = async () => {
    if (!question.trim()) { toast.error('请输入澄清问题'); return; }
    if (!issuer.trim()) { toast.error('请输入发起人'); return; }
    if (!supplierName.trim()) { toast.error('请输入供应商名称'); return; }
    setSubmitting(true);
    try {
      await api.post(`/bid/projects/${projectId}/clarifications`, {
        question: question.trim(),
        issuer: issuer.trim(),
        supplierName: supplierName.trim(),
      });
      toast.success('澄清已发起');
      setShowForm(false);
      setQuestion('');
      setIssuer('');
      setSupplierName('');
      const updated = await api.get<BidClarification[]>(`/bid/projects/${projectId}/clarifications`);
      setClarifications(updated);
    } catch (e: any) {
      toast.error(e.message || '发起失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <TableSkeleton rows={6} cols={4} />;
  if (!project) return (
    <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">
      暂无项目数据
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            澄清与答疑
          </h1>
          <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">
            发起澄清 · 供应商回复 · 全程留痕
          </p>
        </div>
        <ProjectSelector value={projectId} onChange={setProjectId} />
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 text-[12px] text-[oklch(0.55_0.01_264)]">
          <MessageSquare size={13} strokeWidth={1.5} />
          项目：{project.projectCode} — {project.name}
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors"
        >
          <Plus size={13} strokeWidth={2} /> 发起澄清
        </button>
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white w-full max-w-[520px] border border-[oklch(0.91_0.006_264)] shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
              <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
                style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
                发起澄清
              </h2>
              <button onClick={() => setShowForm(false)} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors">
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  发起人 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <input value={issuer} onChange={e => setIssuer(e.target.value)}
                  placeholder="例：评标委员会"
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors placeholder:text-[oklch(0.72_0.008_264)]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  供应商 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <select value={supplierName} onChange={e => setSupplierName(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors">
                  <option value="">选择供应商</option>
                  {project.suppliers.map(s => (
                    <option key={s.id} value={s.supplierName}>{s.supplierName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  澄清问题 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={4}
                  placeholder="请输入需要供应商澄清的问题…"
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors resize-none placeholder:text-[oklch(0.72_0.008_264)]" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-end gap-3">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.55_0.01_264)] tracking-tight hover:text-[oklch(0.18_0.012_265)] transition-colors">
                取消
              </button>
              <button onClick={handleCreate} disabled={submitting}
                className="flex items-center gap-1.5 px-5 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50">
                <Send size={13} strokeWidth={2} />
                {submitting ? '发送中…' : '发起澄清'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clarifications Table */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)]">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            澄清记录
          </h2>
        </div>
        {clarifications.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">
            暂无澄清记录
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">发起人</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">供应商</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">问题</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">回复</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">时间</th>
              </tr>
            </thead>
            <tbody>
              {clarifications.map(c => (
                <tr key={c.id} className="border-b border-[oklch(0.94_0.004_264)] align-top">
                  <td className="px-5 py-3 text-[oklch(0.42_0.14_260)] font-medium">{c.issuer}</td>
                  <td className="px-5 py-3 text-[oklch(0.18_0.012_265)]">{c.supplierName}</td>
                  <td className="px-5 py-3 text-[oklch(0.18_0.012_265)] max-w-[300px]">{c.question}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)] max-w-[300px]">
                    {c.reply || <span className="text-[oklch(0.72_0.008_264)]">待回复</span>}
                  </td>
                  <td className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)] font-mono whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors (may need to verify `BidClarification` type has `reply` and `createdAt` fields — adjust if schema differs).

---

### Task 2.7: Add Clarifications nav item to AppShell sidebar

**Files:**
- Modify: `water-erp/apps/bid-portal/src/components/app-shell.tsx`

- [ ] **Step 1: Add the nav item**

After the "归档端" entry (line 23), add:
```typescript
{ label: '澄清答疑', path: '/bid/clarifications', icon: MessageSquare },
```

Add `MessageSquare` to the Lucide import (line 8):
```typescript
import { LayoutDashboard, Unlock, Shield, ClipboardCheck, Archive, MessageSquare, LogOut, PanelLeftClose, PanelLeft } from 'lucide-react';
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

## Phase 3: Important Features — Management Efficiency

### Task 3.1: Use `GET /bid/dashboard-stats` on Dashboard

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/page.tsx`

- [ ] **Step 1: Fetch dashboard stats instead of computing from projects**

Replace the `useEffect` that fetches projects with a combined fetch:

```typescript
const [stats, setStats] = useState<{
  totalProjects: number; activeProjects: number;
  totalSuppliers: number; approvedSuppliers: number;
  totalExperts: number; totalAnnouncements: number;
  stageDistribution: Record<string, number>;
} | null>(null);

useEffect(() => {
  Promise.all([
    api.get<BidProject[]>('/bid/projects'),
    api.get<any>('/bid/dashboard-stats'),
  ]).then(([ps, ds]) => {
    setProjects(ps);
    setStats(ds);
  }).catch(() => {}).finally(() => setLoading(false));
}, []);
```

- [ ] **Step 2: Update stat cards to use backend data**

Replace the four stat cards (lines 54-72) to use backend-derived values when available:

```typescript
const openingCount = stats?.stageDistribution?.OPENING ?? projects.filter(p => p.stage === 'OPENING').length;
const evaluatingCount = stats?.stageDistribution?.EVALUATING ?? projects.filter(p => p.stage === 'EVALUATING').length;
const archivedCount = stats?.stageDistribution?.ARCHIVED ?? projects.filter(p => p.stage === 'ARCHIVED').length;
```

Then update the stat cards array to use these values:

```typescript
{[
  { label: '项目总数', value: stats?.totalProjects ?? projects.length, color: '#064ea2' },
  { label: '在线开标', value: openingCount, color: '#f5a623' },
  { label: '专家评标', value: evaluatingCount, color: '#7c3aed' },
  { label: '已归档',   value: archivedCount, color: '#11a874' },
].map(...)}
```

- [ ] **Step 3: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 3.2: Create `DisputeDialog` component (replace browser prompts)

**Files:**
- Create: `water-erp/apps/bid-portal/src/components/dispute-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

```typescript
'use client';

import { useState } from 'react';
import { X, Shield } from 'lucide-react';

interface Props {
  open: boolean;
  recordId: string;
  supplierName: string;
  objectionReason?: string;
  onClose: () => void;
  onResolved: (result: string, confirm: boolean) => Promise<void>;
}

export default function DisputeDialog({ open, recordId, supplierName, objectionReason, onClose, onResolved }: Props) {
  const [result, setResult] = useState('经核实，开标信息无误。');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleAction = async (confirm: boolean) => {
    setError('');
    setSubmitting(true);
    try {
      await onResolved(result, confirm);
      onClose();
    } catch (e: any) {
      setError(e.message || '处理失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white w-full max-w-[460px] border border-[oklch(0.91_0.006_264)] shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            处理开标异议
          </h2>
          <button onClick={onClose} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-2 text-[12px]">
            <Shield size={13} strokeWidth={1.5} className="text-[oklch(0.50_0.18_22)]" />
            <span className="text-[oklch(0.55_0.01_264)]">供应商：</span>
            <span className="font-semibold text-[oklch(0.18_0.012_265)]">{supplierName}</span>
          </div>
          {objectionReason && (
            <div className="bg-[oklch(0.96_0.04_85)] border border-[oklch(0.88_0.06_82)] p-3">
              <div className="text-[11px] font-semibold text-[oklch(0.50_0.18_22)] uppercase tracking-wider mb-1">异议内容</div>
              <div className="text-[13px] text-[oklch(0.18_0.012_265)]">{objectionReason}</div>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              处理结果说明
            </label>
            <textarea
              value={result}
              onChange={e => setResult(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors resize-none"
            />
          </div>
          {error && (
            <div className="bg-[oklch(0.96_0.03_22)] border border-[oklch(0.88_0.06_22)] p-3 text-[12px] text-[oklch(0.50_0.18_22)]">
              {error}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-between">
          <span className="text-[11px] text-[oklch(0.62_0.008_264)]">
            选择处理方式：
          </span>
          <div className="flex items-center gap-3">
            <button onClick={() => handleAction(false)} disabled={submitting}
              className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.50_0.18_22)] tracking-tight border border-[oklch(0.88_0.06_22)] hover:bg-[oklch(0.96_0.03_22)] transition-colors disabled:opacity-50">
              异议成立，退回
            </button>
            <button onClick={() => handleAction(true)} disabled={submitting}
              className="px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50">
              确认无误，维持
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 3.3: Wire DisputeDialog into Open page

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`

- [ ] **Step 1: Replace the prompt-based dispute handling**

Replace the `handleResolveDispute` function and the button that triggers it:

```typescript
const [dispute, setDispute] = useState<{
  recordId: string;
  supplierName: string;
  objectionReason?: string;
} | null>(null);
```

Replace the old `handleResolveDispute` function with:
```typescript
const handleResolveDispute = async (result: string, confirm: boolean) => {
  if (!dispute) return;
  await api.post(`/bid/projects/${projectId}/opening-records/${dispute.recordId}/resolve-dispute`, { result, confirm });
  const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
  setProject(updated);
};
```

Update the "处理异议" button to set dispute state instead of calling the prompt:
```typescript
<button
  onClick={() => setDispute({
    recordId: r.id,
    supplierName: r.supplierName,
    objectionReason: r.objectionReason || undefined,
  })}
  ...
>
```

Add the dialog at the end of the return:
```typescript
<DisputeDialog
  open={!!dispute}
  recordId={dispute?.recordId || ''}
  supplierName={dispute?.supplierName || ''}
  objectionReason={dispute?.objectionReason}
  onClose={() => setDispute(null)}
  onResolved={handleResolveDispute}
/>
```

- [ ] **Step 2: Add import**

```typescript
import DisputeDialog from '@/components/dispute-dialog';
```

- [ ] **Step 3: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

## Phase 4: UX Polish

### Task 4.1: Add project search/filter to Dashboard table

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/page.tsx`

- [ ] **Step 1: Add search state and filter**

Add after the existing `useState` lines:
```typescript
const [search, setSearch] = useState('');
const [stageFilter, setStageFilter] = useState('');
```

- [ ] **Step 2: Add filter bar above the table**

Before the project table (line 88), add:

```typescript
<div className="flex items-center gap-3 mb-4">
  <div className="relative flex-1 max-w-[320px]">
    <input
      value={search}
      onChange={e => setSearch(e.target.value)}
      placeholder="搜索项目名称或编号…"
      className="w-full pl-9 pr-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
        focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors
        placeholder:text-[oklch(0.72_0.008_264)]"
    />
    <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-[oklch(0.62_0.008_264)]" />
  </div>
  <select
    value={stageFilter}
    onChange={e => setStageFilter(e.target.value)}
    className="px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white
      focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors"
  >
    <option value="">全部阶段</option>
    <option value="DOWNLOAD">文件下载</option>
    <option value="SUBMIT">加密投递</option>
    <option value="OPENING">在线开标</option>
    <option value="EVALUATING">专家评标</option>
    <option value="ARCHIVED">已归档</option>
  </select>
</div>
```

- [ ] **Step 3: Filter projects before rendering**

After the `projects` state and before the JSX, add a filtered derivation:

```typescript
const filtered = projects.filter(p => {
  if (stageFilter && p.stage !== stageFilter) return false;
  if (search) {
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.projectCode.toLowerCase().includes(q);
  }
  return true;
});
```

- [ ] **Step 4: Use `filtered` instead of `projects` in the table**

Replace `projects.map(...)` with `filtered.map(...)` in the table body.

- [ ] **Step 5: Add `Search` icon import**

Add `Search` to the lucide-react imports.

- [ ] **Step 6: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 4.2: Add loading/disabled states for archive button

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/archive/page.tsx`

- [ ] **Step 1: Add archiving state**

Add after existing `useState` lines:
```typescript
const [archiving, setArchiving] = useState(false);
```

- [ ] **Step 2: Update the archive button**

Replace the archive button (lines 63-66) with:
```typescript
<button
  onClick={async () => {
    setArchiving(true);
    try {
      await api.post(`/bid/projects/${projectId}/archive-all`, {});
      toast.success('归档完成');
      load();
    } catch (e: any) {
      toast.error(e.message || '归档失败');
    } finally {
      setArchiving(false);
    }
  }}
  disabled={archiving || project.stage === 'ARCHIVED'}
  className="flex items-center gap-2 px-5 py-2.5 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50"
>
  <Package size={14} strokeWidth={1.5} />
  {archiving ? '归档中…' : project.stage === 'ARCHIVED' ? '已归档' : '一键归档'}
</button>
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 4.3: Final verification — full build

**Files:** (none — this is a verification task)

- [ ] **Step 1: Build the shared packages**

Run:
```bash
cd water-erp && pnpm --filter @water-erp/shared build && pnpm --filter @water-erp/config build
```
Expected: Both build successfully.

- [ ] **Step 2: Build the bid-portal**

Run:
```bash
cd water-erp && pnpm --filter bid-portal build
```
Expected: Build succeeds with no TypeScript errors and no ESLint errors.

- [ ] **Step 3: Type-check the full workspace**

Run:
```bash
cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json
```
Expected: No errors.

---

---

## Phase 5: Extended Features — Edit, Admin Submit, Workspace, Export

### Task 5.1: Create `EditProjectDialog` component

**Files:**
- Create: `water-erp/apps/bid-portal/src/components/edit-project-dialog.tsx`

- [ ] **Step 1: Create the edit dialog**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import type { BidProjectDetail } from '@/lib/types';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import { getNextStages } from '@water-erp/shared';

interface Props {
  open: boolean;
  project: BidProjectDetail | null;
  onClose: () => void;
  onUpdated: () => void;
}

const METHODS = ['公开招标', '邀请招标', '竞争性谈判', '询价', '单一来源'];

export default function EditProjectDialog({ open, project, onClose, onUpdated }: Props) {
  const [name, setName] = useState('');
  const [procurementMethod, setProcurementMethod] = useState('公开招标');
  const [openTime, setOpenTime] = useState('');
  const [deadline, setDeadline] = useState('');
  const [riskNote, setRiskNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (project) {
      setName(project.name);
      setProcurementMethod(project.procurementMethod);
      setOpenTime(new Date(project.openTime).toISOString().slice(0, 16));
      setDeadline(new Date(project.deadline).toISOString().slice(0, 16));
      setRiskNote(project.riskNote || '');
    }
  }, [project]);

  if (!open || !project) return null;

  const nextStages = getNextStages(project.stage);

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) { setError('请输入项目名称'); return; }

    setSubmitting(true);
    try {
      const { api } = await import('@/lib/api');
      await api.patch(`/bid/projects/${project.id}`, {
        name: name.trim(),
        procurementMethod,
        openTime: new Date(openTime).toISOString(),
        deadline: new Date(deadline).toISOString(),
        riskNote: riskNote.trim() || undefined,
      });
      onUpdated();
    } catch (e: any) {
      setError(e.message || '更新失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white w-full max-w-[500px] border border-[oklch(0.91_0.006_264)] shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <div>
            <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
              style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
              编辑项目
            </h2>
            <p className="text-[11px] text-[oklch(0.55_0.01_264)] mt-0.5">
              {project.projectCode} — 当前阶段：{STAGE_LABEL[project.stage] || project.stage}
            </p>
          </div>
          <button onClick={onClose} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              项目名称 <span className="text-[oklch(0.50_0.18_22)]">*</span>
            </label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              采购方式
            </label>
            <select value={procurementMethod} onChange={e => setProcurementMethod(e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors">
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                开标时间
              </label>
              <input type="datetime-local" value={openTime} onChange={e => setOpenTime(e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                截标时间
              </label>
              <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
              风险备注
            </label>
            <input value={riskNote} onChange={e => setRiskNote(e.target.value)} placeholder="选填"
              className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors placeholder:text-[oklch(0.72_0.008_264)]" />
          </div>

          {nextStages.length > 0 && (
            <div className="bg-[oklch(0.97_0.004_264)] border border-[oklch(0.91_0.006_264)] p-3">
              <span className="text-[11px] text-[oklch(0.55_0.01_264)]">
                合法下一阶段：{nextStages.map(s => STAGE_LABEL[s] || s).join('、')}
              </span>
            </div>
          )}

          {error && (
            <div className="bg-[oklch(0.96_0.03_22)] border border-[oklch(0.88_0.06_22)] p-3 text-[12px] text-[oklch(0.50_0.18_22)]">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-end gap-3">
          <button onClick={onClose}
            className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.55_0.01_264)] tracking-tight hover:text-[oklch(0.18_0.012_265)] transition-colors">
            取消
          </button>
          <button onClick={handleSubmit} disabled={submitting}
            className="flex items-center gap-1.5 px-5 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50">
            <Save size={13} strokeWidth={2} />
            {submitting ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: May show error about `getNextStages` not exported from `@water-erp/shared`. If so, update `packages/shared/src/constants.ts` to export `STAGE_LABEL` with the `getNextStages` helper, or define it locally. For now, define it locally in the dialog:

```typescript
// Replace the import with a local definition
const NEXT_STAGES: Record<string, string[]> = {
  DOWNLOAD: ['SUBMIT'],
  SUBMIT: ['OPENING'],
  OPENING: ['EVALUATING'],
  EVALUATING: ['ARCHIVED'],
  ARCHIVED: [],
};
const nextStages = NEXT_STAGES[project.stage] || [];
```

---

### Task 5.2: Wire EditProjectDialog into Dashboard table

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/page.tsx`

- [ ] **Step 1: Add state and import**

Add state:
```typescript
const [editProject, setEditProject] = useState<BidProject | null>(null);
```

Add import:
```typescript
import EditProjectDialog from '@/components/edit-project-dialog';
```

- [ ] **Step 2: Add edit button to each table row**

In the project table, add an "操作" column header and an edit button per row. After the `<td>` for risk (line 128), add:

```typescript
<td className="px-5 py-3" onClick={e => e.stopPropagation()}>
  <button
    onClick={() => setEditProject(p)}
    className="flex items-center gap-1 text-[11px] font-semibold text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.42_0.14_260)] transition-colors"
  >
    <Pencil size={12} strokeWidth={1.5} /> 编辑
  </button>
</td>
```

Add a corresponding `<th>` in the thead:
```typescript
<th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">操作</th>
```

- [ ] **Step 3: Add the dialog**

Before the final closing `</div>`:
```typescript
<EditProjectDialog
  open={!!editProject}
  project={editProject as BidProjectDetail | null}
  onClose={() => setEditProject(null)}
  onUpdated={() => {
    setEditProject(null);
    api.get<BidProject[]>('/bid/projects').then(ps => setProjects(ps));
  }}
/>
```

Add `Pencil` to the lucide-react imports.

- [ ] **Step 4: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors (may need to cast `BidProject` to `BidProjectDetail` — adjust the `EditProjectDialog` props to accept `Pick<BidProject, 'id' | 'name' | 'projectCode' | 'procurementMethod' | 'openTime' | 'deadline' | 'riskNote' | 'stage'>` instead of full `BidProjectDetail`).

---

### Task 5.3: Add "Admin Submit Bid" dialog to Open page

**Files:**
- Create: `water-erp/apps/bid-portal/src/components/admin-submit-bid-dialog.tsx`
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`

- [ ] **Step 1: Create the dialog**

```typescript
'use client';

import { useState } from 'react';
import { X, UserPlus } from 'lucide-react';

interface Props {
  open: boolean;
  projectId: string;
  projectStage: string;
  onClose: () => void;
  onSubmit: (supplierName: string) => Promise<void>;
}

export default function AdminSubmitBidDialog({ open, projectId, projectStage, onClose, onSubmit }: Props) {
  const [supplierName, setSupplierName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const isAllowed = projectStage === 'DOWNLOAD' || projectStage === 'SUBMIT';

  const handleSubmit = async () => {
    setError('');
    if (!supplierName.trim()) { setError('请输入供应商名称'); return; }
    setSubmitting(true);
    try {
      await onSubmit(supplierName.trim());
      setSupplierName('');
      onClose();
    } catch (e: any) {
      setError(e.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white w-full max-w-[420px] border border-[oklch(0.91_0.006_264)] shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
            代供应商提交投标
          </h2>
          <button onClick={onClose} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {!isAllowed ? (
          <div className="px-6 py-8 text-center">
            <p className="text-[13px] text-[oklch(0.55_0.01_264)]">
              当前阶段不支持提交投标。仅「文件下载」和「加密投递」阶段可操作。
            </p>
            <button onClick={onClose}
              className="mt-4 px-4 py-2 text-[12px] font-semibold text-[oklch(0.55_0.01_264)] tracking-tight hover:text-[oklch(0.18_0.012_265)] transition-colors">
              关闭
            </button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  供应商名称 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <input value={supplierName} onChange={e => setSupplierName(e.target.value)}
                  placeholder="请输入已在系统注册的供应商名称"
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors placeholder:text-[oklch(0.72_0.008_264)]" />
                <p className="text-[11px] text-[oklch(0.62_0.008_264)] mt-1.5">
                  提交后将自动生成回执编号（格式：TB-YYYYMMDD-NNN），状态设为「密文已校验 · 待解密」。
                </p>
              </div>
              {error && (
                <div className="bg-[oklch(0.96_0.03_22)] border border-[oklch(0.88_0.06_22)] p-3 text-[12px] text-[oklch(0.50_0.18_22)]">{error}</div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-end gap-3">
              <button onClick={onClose}
                className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.55_0.01_264)] tracking-tight hover:text-[oklch(0.18_0.012_265)] transition-colors">
                取消
              </button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex items-center gap-1.5 px-5 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50">
                <UserPlus size={13} strokeWidth={2} />
                {submitting ? '提交中…' : '确认提交'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into Open page**

In `open/page.tsx`, add state:
```typescript
const [showAdminSubmit, setShowAdminSubmit] = useState(false);
```

Add the button in the supplier table header area, next to the existing stage transition buttons:
```typescript
<button
  onClick={() => setShowAdminSubmit(true)}
  className="flex items-center gap-1.5 px-4 py-2 border border-[oklch(0.42_0.14_260)] text-[12px] font-semibold text-[oklch(0.42_0.14_260)] tracking-tight hover:bg-[oklch(0.98_0.005_264)] transition-colors"
>
  <UserPlus size={13} strokeWidth={1.5} /> 代供应商提交
</button>
```

Add the dialog at the end:
```typescript
<AdminSubmitBidDialog
  open={showAdminSubmit}
  projectId={projectId}
  projectStage={project.stage}
  onClose={() => setShowAdminSubmit(false)}
  onSubmit={async (supplierName) => {
    await api.post(`/bid/projects/${projectId}/suppliers`, { supplierName });
    const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
    setProject(updated);
  }}
/>
```

Add imports:
```typescript
import AdminSubmitBidDialog from '@/components/admin-submit-bid-dialog';
import { UserPlus } from 'lucide-react';
```

- [ ] **Step 3: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 5.4: Add Workspace readiness view to Dashboard

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/page.tsx`

- [ ] **Step 1: Add workspace state and expandable panel**

Add state:
```typescript
const [workspaceId, setWorkspaceId] = useState<string | null>(null);
const [workspaceData, setWorkspaceData] = useState<any>(null);
const [workspaceLoading, setWorkspaceLoading] = useState(false);
```

- [ ] **Step 2: Modify row click to load workspace**

Change row click behavior. Instead of `onClick={() => router.push(...)}`, add a different interaction. The row click still navigates to `/bid/open`, but add a small expand toggle that loads the workspace panel below the clicked row.

Alternative approach — add a "就绪检查" column button:

Add a new column in the thead:
```typescript
<th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">就绪</th>
```

Add to each row:
```typescript
<td className="px-5 py-3" onClick={e => e.stopPropagation()}>
  <button
    onClick={async () => {
      if (workspaceId === p.id) { setWorkspaceId(null); return; }
      setWorkspaceId(p.id);
      setWorkspaceLoading(true);
      try {
        const data = await api.get<any>(`/bid/projects/${p.id}/workspace`);
        setWorkspaceData(data);
      } catch { setWorkspaceData(null); }
      finally { setWorkspaceLoading(false); }
    }}
    className="flex items-center gap-1 text-[11px] font-semibold text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] transition-colors"
  >
    {workspaceId === p.id ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />}
    检查
  </button>
</td>
```

- [ ] **Step 3: Add the workspace panel below the table**

After the table closing `</div>`, add:

```typescript
{workspaceId && (
  <div className="border-t border-[oklch(0.91_0.006_264)] bg-[oklch(0.982_0.003_264)]">
    {workspaceLoading ? (
      <div className="p-5 text-[13px] text-[oklch(0.62_0.008_264)]">加载中…</div>
    ) : workspaceData ? (
      <div className="p-5">
        <h3 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight mb-4"
          style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
          开标就绪检查
        </h3>
        <div className="grid grid-cols-3 gap-6">
          {/* 供应商 */}
          <div>
            <div className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-2">
              供应商投递
            </div>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-1 h-1.5 bg-[oklch(0.94_0.004_264)]">
                <div className="h-full bg-[oklch(0.42_0.14_260)] transition-all"
                  style={{ width: `${workspaceData.stats.supplierTotal > 0 ? (workspaceData.stats.submitted / workspaceData.stats.supplierTotal * 100) : 0}%` }} />
              </div>
              <span className="text-[12px] font-mono text-[oklch(0.55_0.01_264)]">
                {workspaceData.stats.submitted}/{workspaceData.stats.supplierTotal}
              </span>
            </div>
            <div className="text-[11px] text-[oklch(0.62_0.008_264)]">
              撤回：{workspaceData.stats.withdrawn}
            </div>
            <div className={`mt-2 text-[12px] font-semibold ${workspaceData.stats.submitted >= 3 ? 'text-[oklch(0.54_0.16_158)]' : 'text-[oklch(0.50_0.18_22)]'}`}>
              {workspaceData.stats.submitted >= 3 ? '🟢 满足开标条件' : '🔴 供应商不足（需≥3家）'}
            </div>
          </div>

          {/* 专家 */}
          <div>
            <div className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-2">
              专家签到
            </div>
            <div className="text-[12px] text-[oklch(0.55_0.01_264)]">
              已签到：<span className="font-mono font-bold text-[oklch(0.18_0.012_265)]">{workspaceData.stats.expertSignedIn}</span>
              {' '}/{' '}{workspaceData.stats.expertCount}
            </div>
            <div className={`mt-2 text-[12px] font-semibold ${workspaceData.stats.expertSignedIn >= workspaceData.stats.expertCount && workspaceData.stats.expertCount >= 3 ? 'text-[oklch(0.54_0.16_158)]' : 'text-[oklch(0.64_0.16_82)]'}`}>
              {workspaceData.stats.expertSignedIn >= workspaceData.stats.expertCount && workspaceData.stats.expertCount >= 3
                ? '🟢 专家全部就位'
                : `🟡 等待 ${workspaceData.stats.expertCount - workspaceData.stats.expertSignedIn} 位专家签到`}
            </div>
          </div>

          {/* 就绪判断 */}
          <div className="border-l border-[oklch(0.91_0.006_264)] pl-5">
            <div className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-2">
              整体就绪
            </div>
            {(() => {
              const ok = workspaceData.stats.submitted >= 3
                && workspaceData.stats.expertSignedIn >= workspaceData.stats.expertCount
                && workspaceData.stats.expertCount >= 3;
              return (
                <div className={`text-[18px] font-bold tracking-tight ${ok ? 'text-[oklch(0.54_0.16_158)]' : 'text-[oklch(0.64_0.16_82)]'}`}
                  style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
                  {ok ? '可开标' : '待准备'}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    ) : (
      <div className="p-5 text-[13px] text-[oklch(0.62_0.008_264)]">加载失败</div>
    )}
  </div>
)}
```

Add `ChevronDown, ChevronRight` to the lucide-react imports (if not already present).

- [ ] **Step 4: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 5.5: Add supervision log CSV export

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/supervise/page.tsx`

- [ ] **Step 1: Add export button and function**

Add the export function and a button in the supervision log table header. After line 91 (the log table header `h2`), add:

```typescript
const exportCSV = () => {
  const headers = ['时间', '角色', '对象', '操作', '结果', '风险标识'];
  const rows = project.supervisionLogs.map(log => [
    new Date(log.time).toLocaleString('zh-CN'),
    log.role,
    log.target,
    log.action,
    log.result,
    log.riskFlag,
  ]);
  const bom = '﻿';
  const csv = bom + [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `监督日志-${project.projectCode}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('导出成功');
};
```

Update the log table header div (lines 90-92) to include the export button:

```typescript
<div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)] flex items-center justify-between">
  <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
    style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
    监督日志
  </h2>
  {project.supervisionLogs.length > 0 && (
    <button onClick={exportCSV}
      className="flex items-center gap-1.5 px-3 py-1.5 border border-[oklch(0.91_0.006_264)] text-[11px] font-semibold text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.18_0.012_265)] hover:border-[oklch(0.62_0.008_264)] transition-colors tracking-tight">
      <Download size={12} strokeWidth={1.5} /> 导出 CSV
    </button>
  )}
</div>
```

Add `Download` and `toast` imports:
```typescript
import { toast } from 'sonner';
```
(Add `Download` to the lucide-react imports.)

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 5.6: Add archive export download button

**Files:**
- Create: `water-erp/apps/bid-portal/src/app/api/bid/projects/[id]/archive-export/route.ts` (Note: this is a Next.js API route that proxies to the backend)
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/archive/page.tsx`

- [ ] **Step 1: Create frontend download handler**

Since the backend doesn't have an archive-export endpoint yet, use a pure frontend approach — generate an Excel-like CSV with multiple sections from the already-loaded project data.

In `archive/page.tsx`, add the download handler:

```typescript
const [downloading, setDownloading] = useState(false);

const handleDownload = () => {
  if (!project) return;
  setDownloading(true);
  try {
    const sections: { title: string; headers: string[]; rows: string[][] }[] = [];

    // Section 1: 项目基本信息
    sections.push({
      title: '招标项目基础信息',
      headers: ['项目编号', '项目名称', '采购方式', '开标时间', '截标时间', '阶段'],
      rows: [[
        project.projectCode, project.name, project.procurementMethod,
        new Date(project.openTime).toLocaleString('zh-CN'),
        new Date(project.deadline).toLocaleString('zh-CN'),
        project.stage,
      ]],
    });

    // Section 2: 供应商名单
    sections.push({
      title: '投标供应商名单',
      headers: ['供应商名称', '回执编号', '密文状态', '解密状态', '确认状态'],
      rows: project.suppliers.map(s => [
        s.supplierName, s.receiptNo || '—', s.encryptStatus, s.decryptStatus, s.confirmStatus,
      ]),
    });

    // Section 3: 开标记录
    sections.push({
      title: '开标记录表',
      headers: ['供应商', '报价', '工期', '质量目标', '保证金', '确认状态'],
      rows: project.openingRecords.map(r => [
        r.supplierName, r.amount || '—', r.period || '—', r.qualityTarget || '—', r.bondStatus || '—', r.confirmStatus,
      ]),
    });

    // Build CSV with BOM
    const bom = '﻿';
    const csvParts = sections.map(s =>
      `=== ${s.title} ===\n` +
      [s.headers, ...s.rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    );
    const csv = bom + csvParts.join('\n\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ARCH-${project.projectCode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('导出完成');
  } catch {
    toast.error('导出失败');
  } finally {
    setDownloading(false);
  }
};
```

- [ ] **Step 2: Add download button in archive header**

In the archive status header (after the "一键归档" button), add:

```typescript
<button onClick={handleDownload} disabled={downloading}
  className="flex items-center gap-2 px-4 py-2.5 border border-[oklch(0.42_0.14_260)] text-[oklch(0.42_0.14_260)] text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.98_0.005_264)] transition-colors disabled:opacity-50">
  <Download size={14} strokeWidth={1.5} />
  {downloading ? '导出中…' : '导出归档包'}
</button>
```

Add `Download` to the lucide-react imports.

- [ ] **Step 3: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

## Phase 6: WebSocket Real-time Push

### Task 6.1: Add Socket.IO dependencies

**Files:**
- Modify: `water-erp/apps/api/package.json`
- Modify: `water-erp/apps/bid-portal/package.json`

- [ ] **Step 1: Install backend Socket.IO**

Run:
```bash
cd water-erp/apps/api && pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io
```
Expected: Packages installed successfully.

- [ ] **Step 2: Install frontend socket.io-client**

Run:
```bash
cd water-erp/apps/bid-portal && pnpm add socket.io-client
```
Expected: Package installed successfully.

- [ ] **Step 3: Install from workspace root**

Run:
```bash
cd water-erp && pnpm install
```
Expected: Lock file updated.

---

### Task 6.2: Create BidGateway on backend

**Files:**
- Create: `water-erp/apps/api/src/bid/bid.gateway.ts`
- Modify: `water-erp/apps/api/src/bid/bid.module.ts`

- [ ] **Step 1: Create the WebSocket gateway**

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: 'bid',
  cors: { origin: '*', credentials: true },
})
export class BidGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    // client.handshake.headers.cookie contains the auth cookie
  }

  handleDisconnect(client: Socket) {
    // cleanup
  }

  @SubscribeMessage('join:project')
  handleJoinProject(client: Socket, projectId: string) {
    client.join(`project:${projectId}`);
  }

  @SubscribeMessage('leave:project')
  handleLeaveProject(client: Socket, projectId: string) {
    client.leave(`project:${projectId}`);
  }

  // Called by BidService when decrypt status changes
  notifyDecryptStatus(projectId: string, data: {
    supplierId: string;
    decryptStatus: string;
    supplierName: string;
  }) {
    this.server.to(`project:${projectId}`).emit('decrypt:update', data);
  }

  // Called by BidService when supervision log is created
  notifySupervisionLog(projectId: string, log: any) {
    this.server.to(`project:${projectId}`).emit('supervision:log', log);
  }

  // Called by BidService when stage changes
  notifyStageChange(projectId: string, stage: string) {
    this.server.to(`project:${projectId}`).emit('stage:change', { stage });
  }
}
```

- [ ] **Step 2: Register Gateway in BidModule**

In `bid.module.ts`, add `BidGateway` to the providers array:

```typescript
import { BidGateway } from './bid.gateway';

@Module({
  imports: [AuthModule, PrismaModule, NotificationModule],
  controllers: [BidController],
  providers: [BidService, BidGateway],
})
export class BidModule {}
```

- [ ] **Step 3: Wire Gateway calls into BidService**

In `bid.service.ts`, inject `BidGateway` (optional, to avoid breaking tests):

```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly notification: NotificationService,
  @Optional() private readonly gateway?: BidGateway,
) {}
```

In `decryptSupplier()`, after updating the decrypt status, add:
```typescript
this.gateway?.notifyDecryptStatus(projectId, {
  supplierId,
  decryptStatus: simulateDanger ? 'DANGER' : 'SUCCESS',
  supplierName: supplier.supplierName,
});
```

In `startOpening()`, `startEvaluation()`, `openSubmission()`, `archiveAll()`, after the stage transition:
```typescript
this.gateway?.notifyStageChange(id, newStage);
```

In the supervision log helper, after creating any log:
```typescript
this.gateway?.notifySupervisionLog(projectId, logEntry);
```

- [ ] **Step 4: Verify backend compiles**

Run:
```bash
cd water-erp && pnpm --filter api build 2>&1 | tail -10
```
Expected: Build succeeds.

---

### Task 6.3: Create frontend WebSocket hook

**Files:**
- Create: `water-erp/apps/bid-portal/src/hooks/use-bid-websocket.ts`

- [ ] **Step 1: Create the hook**

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface WsHandlers {
  onDecrypt?: (data: { supplierId: string; decryptStatus: string; supplierName: string }) => void;
  onSupervisionLog?: (data: any) => void;
  onStageChange?: (data: { stage: string }) => void;
}

export function useBidWebSocket(projectId: string | undefined, handlers: WsHandlers) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const socket = io('http://localhost:4001/bid', { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join:project', projectId);
    });

    if (handlers.onDecrypt) socket.on('decrypt:update', handlers.onDecrypt);
    if (handlers.onSupervisionLog) socket.on('supervision:log', handlers.onSupervisionLog);
    if (handlers.onStageChange) socket.on('stage:change', handlers.onStageChange);

    return () => {
      socket.emit('leave:project', projectId);
      socket.disconnect();
    };
  }, [projectId]);

  return socketRef;
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 6.4: Wire WebSocket into Open page (replace 5s polling)

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/open/page.tsx`

- [ ] **Step 1: Add WebSocket hook, remove polling**

Add the hook call after the existing `useEffect` blocks:

```typescript
useBidWebSocket(project?.stage === 'OPENING' ? projectId : undefined, {
  onDecrypt: (data) => {
    setProject(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        suppliers: prev.suppliers.map(s =>
          s.id === data.supplierId ? { ...s, decryptStatus: data.decryptStatus as any } : s
        ),
      };
    });
  },
  onStageChange: (data) => {
    // Reload full project data when stage changes
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
  },
});
```

- [ ] **Step 2: Remove the old polling useEffect**

Remove or comment out the 5-second polling block (lines 67-71):
```typescript
// REMOVED: polling useEffect — replaced by WebSocket
// useEffect(() => {
//   if (!projectId || !project || project.stage !== 'OPENING') return;
//   const t = setInterval(() => api.get<BidProjectDetail>(...), 5000);
//   return () => clearInterval(t);
// }, [projectId, project?.stage]);
```

- [ ] **Step 3: Add import**

```typescript
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
```

- [ ] **Step 4: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

### Task 6.5: Wire WebSocket into Supervise page (real-time logs)

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/supervise/page.tsx`

- [ ] **Step 1: Add WebSocket hook for real-time log updates**

```typescript
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import type { BidSupervisionLog } from '@/lib/types';

// Inside the component, after the data-loading useEffect:
useBidWebSocket(projectId, {
  onSupervisionLog: (log: BidSupervisionLog) => {
    setProject(prev => {
      if (!prev) return prev;
      return { ...prev, supervisionLogs: [log, ...prev.supervisionLogs] };
    });
  },
  onStageChange: () => {
    // Reload full project data when stage changes
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
  },
});
```

- [ ] **Step 2: Verify compilation**

Run: `cd water-erp && npx tsc --noEmit --project apps/bid-portal/tsconfig.json 2>&1 | head -20`
Expected: No errors.

---

## Updated Verification Checklist

After all tasks are complete, manually verify:

1. **Full lifecycle flow:** Create project → Edit project → Open Submission → Admin submit bid → Start Opening → Decrypt suppliers (with WebSocket real-time) → Dispute resolution (via dialog) → Start Evaluation → Generate Results → Archive All → Export archive CSV
2. **Clarifications:** Create a clarification, verify it appears in the table
3. **Dispute resolution:** Open dispute dialog, enter resolution text, confirm/reject (no browser prompts)
4. **Search/Filter:** Filter projects by name, code, and stage on dashboard
5. **Workspace readiness:** Click "检查" on a project row, verify supplier/expert counts and readiness status
6. **Edit project:** Click "编辑" on a project row, modify fields, save, verify changes
7. **Admin submit bid:** Click "代供应商提交", enter supplier name, verify new entry in supplier table
8. **Supervision CSV export:** Click "导出 CSV", verify downloaded file contains all log entries with correct encoding
9. **Archive export:** Click "导出归档包", verify downloaded CSV contains 3 sections (基本信息, 供应商, 开标记录)
10. **WebSocket:** Open two browser tabs — decrypt a supplier in tab A, verify instant update in tab B (no page refresh)
11. **Design:** Sidebar uses navy blue (oklch tokens, not purple), no decorative shadows, Lucide icons with 1.5px stroke
12. **Shared constants:** No inline `stageDefs`/`decryptDefs`/`statusDefs` in any page
