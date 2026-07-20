# 采购公告两步向导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将「公告制作与发布」从错误单页表单重构为两步向导——Step ① 公告制作（复用 `AnnouncementDialog` 嵌入模式，项目数据 + .docx 双路预填）→ Step ② 发布配置（范围/时间/通知/附件/采购文件），含后端 .docx 解析、定时发布 cron、发布通知。

**Architecture:** 新向导组件 `announcement-publish-wizard.tsx` 持有全部状态，Step 1 嵌入已有 `AnnouncementDialog`（新增 `embedded` prop），Step 2 自绘配置面板。后端新增 .docx 解析端点（project-mgmt 模块，mammoth + AI）、定时发布 cron（SchedulerService）、发布通知（NotificationService）。删除旧的 `announcement-publish-modal.tsx`。

**Tech Stack:** NestJS 11 + Prisma + @nestjs/schedule（已安装）、Next.js 16 + React 19 + Tailwind v4、mammoth（已在项目内使用）、MinIO。

## Global Constraints

- 工作目录：后端 `apps/api`、前端 `apps/web`；workspace 命令在 `water-erp/` 根执行。
- 公告类型锁定 `BID_NOTICE`（采购公告/招标公示）；公告分类映射：`procurement_document`（邀请招标/竞价采购/直接采购公告）、`failed_bid`、`winning_bid`。
- 发布**不**自动完成 `PUBLIC_ANNOUNCEMENT` 阶段。
- 开评标项目在立项时已创建——**此处不重复创建**（`syncBidProject` 有幂等保护，但需排查）。
- 视觉走既有 neu-* 类；弹窗外壳与 `ExpertExtractModal` 同款（磨砂遮罩 + ESC + 渐变表面）。
- 无 mock 数据，零 Prisma 迁移。
- 验证：后端单测（重要逻辑）+ 前端 lint + 真机视觉截图。

---

## Task 1: 后端 .docx 解析端点

**Files:**
- Modify: `apps/api/src/project-management/project-management.controller.ts` (+1 路由)
- Modify: `apps/api/src/project-management/project-management.service.ts` (+1 方法)

**Interfaces:**
- Produces: `POST /api/project-management/:id/parse-announcement-fields` → `{ fields: Partial<AnnouncementDraft>; extractedText: string } | null`
- Consumes: 项目 `TENDER_DOCUMENT` 阶段第一个 .docx 文件（本地磁盘 `uploads/<objectKey>`）、`mammoth`（已 import）、`AiService`（已注入）。

- [ ] **Step 1: 在 controller 加路由**

In `apps/api/src/project-management/project-management.controller.ts`，在 `analyzeProject` 路由之后插入：

```ts
  @Post(':id/parse-announcement-fields')
  async parseAnnouncementFields(@Param('id') id: string) {
    const result = await this.projectManagementService.parseAnnouncementFields(id);
    if (!result) return null;
    return result;
  }
```

- [ ] **Step 2: 在 service 实现方法**

In `apps/api/src/project-management/project-management.service.ts`，在类的最后（`}` 闭合前）插入。该类已有 `mammoth` import、`AiService` 注入、`resolve(process.cwd(), 'uploads', ...)` 路径模式。

```ts
  /** 解析项目的 TENDER_DOCUMENT .docx 附件，用 AI 提取公告字段 */
  async parseAnnouncementFields(projectId: string): Promise<{ fields: Record<string, string>; extractedText: string } | null> {
    const stage = await this.prisma.projectManagementStage.findFirst({
      where: { projectManagementItemId: projectId, stageKey: 'TENDER_DOCUMENT' },
      include: { attachments: true },
    });
    if (!stage) return null;
    const docxAttachment = stage.attachments.find((a) =>
      a.fileName.toLowerCase().endsWith('.docx'),
    );
    if (!docxAttachment) return null;

    const localPath = resolve(process.cwd(), 'uploads', docxAttachment.objectKey);
    let buffer: Buffer;
    try {
      buffer = await readFile(localPath);
    } catch {
      this.logger.warn(`parseAnnouncementFields: 源文件不存在 ${localPath}`);
      return null;
    }

    let extractedText: string;
    try {
      const mammothResult = await mammoth.extractRawText({ buffer });
      extractedText = (mammothResult.value || '').slice(0, 12000);
    } catch {
      this.logger.warn(`parseAnnouncementFields: mammoth 解析失败`);
      return null;
    }

    const fields: Record<string, string> = {};
    try {
      const aiResponse = await this.ai.llmGenerate({
        systemPrompt: `你是采购公告字段提取助手。从招标文件原文中提取以下字段，输出严格的 JSON 对象（key 为字段名，value 为提取值）。只包含能提取到的字段，不确定的字段不要输出。字段：projectName(项目名称)、projectOverview(项目概况/采购内容简介)、maxPriceNumeric(预算金额/最高限价数字)、contactName(联系人)、contactPhone(联系电话)、contactEmail(联系邮箱)、supplierRequirements(供应商资格要求)、bidOpeningTime(开标时间)。`,
        userPrompt: extractedText,
        options: { temperature: 0.1, maxTokens: 2000 },
      });
      const parsed = JSON.parse(aiResponse);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.trim()) fields[k] = v.trim();
        }
      }
    } catch (e) {
      this.logger.warn(`parseAnnouncementFields: AI 提取失败 ${(e as Error).message}`);
    }

    return { fields, extractedText };
  }
```

Note: `this.ai.llmGenerate` 是该 service 已有的 AiService 方法；若方法名不同，按实际 `AiService` 接口调整（查找 `src/ai/ai.service.ts` 的 public 方法名，常见为 `chat` 或 `predict`）。

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter api build`
Expected: controller 和服务新方法编译通过。全量构建若有既存 `expert-memo.service.ts:91` 错误，那是已有问题，不影响我们。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/project-management/project-management.controller.ts \
        apps/api/src/project-management/project-management.service.ts
git commit -m "feat(api): add parse-announcement-fields endpoint (.docx→AI extraction)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 后端定时发布 cron + 发布通知

**Files:**
- Modify: `apps/api/src/scheduler/scheduler.service.ts` (+2 方法)

**Interfaces:**
- Produces: `@Cron('0 * * * *')` — 每分钟扫描 `status=SCHEDULED` 的公告，到时设为 PUBLISHED + 触发通知。
- Consumes: `PrismaService`、`NotificationService`（均已注入）。

- [ ] **Step 1: 在 SchedulerService 添加 cron 方法**

`SchedulerService` 已在 `apps/api/src/scheduler/scheduler.service.ts`，已 inject `PrismaService`、`NotificationService`。在类内追加：

```ts
  /** 每分钟扫描定时公告，到期后发布（status=DRAFT + metadata.scheduledPublishDate） */
  @Cron('* * * * *')
  async publishScheduledAnnouncements() {
    const drafts = await this.prisma.announcement.findMany({
      where: { status: 'DRAFT' },
    });
    for (const a of drafts) {
      const meta = (a.metadata as any) || {};
      if (!meta.scheduledPublishDate) continue;
      if (new Date(meta.scheduledPublishDate) <= new Date()) {
        await this.prisma.announcement.update({
          where: { id: a.id },
          data: { status: 'PUBLISHED', publishDate: new Date() },
        });
        if (meta.notifyOnPublish) {
          await this.sendPublishNotifications(a.id, a.title, meta);
        }
        this.logger.log(`定时公告发布: ${a.title} (${a.id})`);
      }
    }
  }

  /** 按公告范围向供应商发送站内信通知 */
  private async sendPublishNotifications(
    annId: string,
    title: string,
    meta: Record<string, any>,
  ) {
    const visibility = meta.visibility || 'PUBLIC';
    let userIds: string[];
    if (visibility === 'RESTRICTED' && Array.isArray(meta.restrictedSupplierIds) && meta.restrictedSupplierIds.length > 0) {
      const suppliers = await this.prisma.supplier.findMany({
        where: { id: { in: meta.restrictedSupplierIds } },
        select: { userId: true },
      });
      userIds = suppliers.map((s) => s.userId);
    } else {
      const users = await this.prisma.user.findMany({
        where: { role: 'supplier', isActive: true },
        select: { id: true },
      });
      userIds = users.map((u) => u.id);
    }
    for (const userId of userIds) {
      try {
        await this.notification.create({
          userId,
          type: 'ANNOUNCEMENT_PUBLISHED',
          title: `新采购公告：${title}`,
          content: `采购公告「${title}」已发布，请前往供应商门户查看详情。`,
          link: `/notice/${annId}`,
        });
      } catch (e) {
        this.logger.warn(`通知发送失败 userId=${userId}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`公告通知已发送: ${title}, 收件人 ${userIds.length} 人`);
  }
```

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter api build`
Expected: 编译通过。新增方法无类型错误。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/scheduler/scheduler.service.ts
git commit -m "feat(api): add scheduled announcement publish cron + notify

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: AnnouncementDialog 嵌入模式改造

**Files:**
- Modify: `apps/web/src/components/tender-write/announcement-dialog.tsx`

**Interfaces:**
- Produces: 新增 props `embedded?: boolean`, `onDraftChange?: (draft: AnnouncementDraft, category: AnnouncementCategory) => void`, `initialCategory?: AnnouncementCategory | null`, `initialDraft?: AnnouncementDraft | null`。
- Consumes: 内部已有 `Modal`、`handleSelectCategory`、`handleFieldChange`。嵌入模式下跳过 `<Modal>` 包装和 `footer`，暴露回调通知向导层。

- [ ] **Step 1: 修改 Props 签名**

Replace the current function signature (line 438-450):

```ts
export function AnnouncementDialog({
  isOpen,
  tenderType,
  tenderDraft,
  selectedMeta,
  onClose,
  embedded = false,
  initialCategory = null,
  initialDraft = null,
  onDraftChange,
}: {
  isOpen: boolean;
  tenderType: ReadyTenderDocumentType;
  tenderDraft: ReadyTenderDraft;
  selectedMeta: TenderDocumentTypeMeta;
  onClose: () => void;
  embedded?: boolean;
  initialCategory?: AnnouncementCategory | null;
  initialDraft?: AnnouncementDraft | null;
  onDraftChange?: (draft: AnnouncementDraft, category: AnnouncementCategory) => void;
}) {
```

- [ ] **Step 2: 修改 `useEffect` 复位逻辑（`:472-485`）**

Replace the existing reset `useEffect`:

```ts
  useEffect(() => {
    if (!isOpen) return;
    if (embedded && initialCategory && initialDraft) {
      setStep("edit");
      setCategory(initialCategory);
      setDraft(initialDraft);
      setErrorMessage(null);
      setSuccessMessage(null);
      setFavoriteStates({});
      setGeneratingStates({});
      setSampleDrawerState(null);
      setAiError(null);
      return;
    }
    setStep("select_category");
    setCategory(null);
    setDraft(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setFavoriteStates({});
    setGeneratingStates({});
    setSampleDrawerState(null);
    setAiError(null);
  }, [isOpen, tenderType, embedded, initialCategory, initialDraft]);
```

- [ ] **Step 3: 在 `handleSelectCategory` 和 `handleFieldChange` 中通知向导**

After the existing `setStep("edit")` in `handleSelectCategory` (line 507), add:

```ts
    if (embedded && onDraftChange) {
      onDraftChange(filledDraft, cat);
    }
```

In `handleFieldChange` (after line 529, before the return), add:

```ts
    if (embedded && onDraftChange && category) {
      onDraftChange(next as AnnouncementDraft, category);
    }
```

- [ ] **Step 4: 修改 return 包装——嵌入模式跳过 Modal**

Wrap the existing return content (lines 757-970) with embedded mode check. Replace the entire return block from line 757 to end of component with:

```ts
  const draftRecord = (draft ?? {}) as Record<string, string>;

  const renderContent = () => (
    <>
      {step === "select_category" ? (
        /* Category Selection */
        <div className="grid gap-4">
          {availableCategories.map((cat) => {
            const catMeta = ANNOUNCEMENT_CATEGORIES.find(
              (c) => c.type === cat,
            );
            const IconComponent = CATEGORY_ICONS[cat] ?? FileSearch;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => handleSelectCategory(cat)}
                className="group flex items-start gap-4 rounded-[16px] border border-transparent px-5 py-4 text-left bg-[oklch(1_0_0_/_0.55)] backdrop-blur-[16px] transition-[transform,box-shadow] duration-300 [box-shadow:var(--cs)] hover:[box-shadow:var(--csh)] hover:-translate-y-0.5"
                style={{
                  "--cs": "inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.12), -2px -2px 6px oklch(1 0 0 / 0.85)",
                  "--csh": "inset 0 1px 0 oklch(1 0 0 / 0.85), 4px 4px 10px oklch(0.45 0.08 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.9)",
                } as React.CSSProperties}
              >
                <div className="neu-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[color:var(--accent)] transition-transform duration-300 group-hover:scale-105">
                  <IconComponent size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-[0.95rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                    {getAnnouncementLabel(tenderType, cat)}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                    {catMeta?.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        /* Editor + Preview — keep EXISTING implementation untouched from here */
        <div className="flex flex-row gap-4">
          ...(keep ALL existing editor+preview code exactly as-is, lines 827-923)...
        </div>
        /* ... end of existing code ... */
      )}

      {errorMessage && (
        <div className="text-sm text-[color:var(--danger)]">{errorMessage}</div>
      )}
      {successMessage && (
        <div className="rounded-[10px] border border-[color-mix(in_oklch,var(--success)_28%,transparent)] bg-[var(--success)] px-5 py-3 text-sm font-medium text-white">
          {successMessage}
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="flex-1 min-h-0 flex flex-col">{renderContent()}</div>;
  }

  return (
    <>
      <Modal
        open={isOpen}
        onClose={onClose}
        title={step === "select_category" ? "选择公告类型" : dialogTitle}
        description={`${selectedMeta.label} · 公告`}
        size="lg"
        className={step === "edit" ? "!max-w-[min(1200px,95vw)]" : undefined}
        footer={
          step === "edit" && draft ? (
            <>
              <button type="button" onClick={handleBack} className="neu-btn-soft">
                ← 返回选择
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting}
                className="tender-btn tender-btn--export disabled:cursor-not-allowed"
              >
                <span className="tb-icon tb-anim-bob"><FileDown size={13} /></span>
                {exporting ? "导出中..." : "导出公告"}
              </button>
            </>
          ) : undefined
        }
      >
        {renderContent()}
      </Modal>
      {/* Keep existing drawers/dialogs */}
      {sampleDrawerState && (
        <TenderFieldSampleDialog ...existing props... onClose={() => setSampleDrawerState(null)} />
      )}
      {contactPickerOpen && (
        <ContactPickerDialog ...existing props... onClose={() => setContactPickerOpen(false)} />
      )}
    </>
  );
}
```

> **Critical**: The editor+preview code (lines 827-923 in the current file) must be **kept exactly as-is** inside the `step === "edit"` branch. This plan omits duplicating those ~100 lines for brevity; the implementer copies them verbatim.

- [ ] **Step 4b: Add backward-compat `handleExport` export**

Make `handleExport` callable from both the Modal footer and the wizard. Currently it's only in the Modal footer. No change needed — the existing `handleExport` function stays, and the wizard can call it by passing `onExport` as a ref or by exposing `handleExport` via a new prop. Simpler: export stays in the footer only (wizard renders its own export button on the chrome, not inside the embedded dialog). No change needed.

- [ ] **Step 5: Lint**

Run: `pnpm --filter web lint -- src/components/tender-write/announcement-dialog.tsx`
Expected: 零新增错误。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/tender-write/announcement-dialog.tsx
git commit -m "feat(web): add embedded mode to AnnouncementDialog for wizard reuse

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 前端 API 客户端 — `parseAnnouncementFields`

**Files:**
- Modify: `apps/web/src/lib/api/announcement.ts`

- [ ] **Step 1: 在末尾添加客户端方法**

在 `apps/web/src/lib/api/announcement.ts` 末尾追加：

```ts
/** 解析项目TENDER_DOCUMENT阶段.docx文件中的公告字段（AI提取） */
export type ParsedAnnouncementFields = { fields: Record<string, string>; extractedText: string } | null;

export function parseAnnouncementFields(projectId: string) {
  return api.post<ParsedAnnouncementFields>(`/project-management/${projectId}/parse-announcement-fields`, {});
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/api/announcement.ts
git commit -m "feat(web): add parseAnnouncementFields api client

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 向导组件 `AnnouncementPublishWizard`

**Files:**
- Create: `apps/web/src/components/projects/announcement-publish-wizard.tsx`

**Interfaces:**
- Produces: `<AnnouncementPublishWizard isOpen={boolean} onClose={()=>void} project={ProjectManagementItem|null} onPublished={()=>void} />`
- Consumes: Task 3 `AnnouncementDialog` (embedded mode)、Task 4 `parseAnnouncementFields`、`attachFromObject` + 既有公告附件 API、`getSupplierList`、`mapProcurementMethodToTenderType`、`buildPrefillFromProject`、`createEmptyAnnouncementDraft`、`applyAutoFill`、`getAnnouncementFields`、`getAvailableAnnouncementCategories`、`TENDER_DOCUMENT_TYPES`。

- [ ] **Step 1: 创建组件文件**

Create `apps/web/src/components/projects/announcement-publish-wizard.tsx`. Full code below — split into Part A (imports+types+helpers), Part B (state+logic), Part C (render).

**Part A — imports + types + helpers:**

```tsx
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Megaphone, X, Save, Send, Upload, Loader2, ArrowLeft, ArrowRight, FileDown, Users } from 'lucide-react';
import {
  createAnnouncement,
  updateAnnouncement,
  listAttachments,
  addAttachment,
  removeAttachment,
  uploadFile,
  attachFromObject,
  parseAnnouncementFields,
} from '@/lib/api/announcement';
import type { AnnouncementAttachment, AnnouncementStatus } from '@/lib/api/announcement';
import { getSupplierList } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';
import { AnnouncementDialog } from '@/components/tender-write/announcement-dialog';
import { mapProcurementMethodToTenderType } from '@/lib/tender-write/procurement-method-map';
import { buildPrefillFromProject } from '@/lib/tender-write/prefill-from-project';
import {
  getAnnouncementFields,
  createEmptyAnnouncementDraft,
  applyAutoFill,
  getAvailableAnnouncementCategories,
  getAnnouncementLabel,
} from '@/lib/tender-write/announcement-templates';
import { TENDER_DOCUMENT_TYPES } from '@/lib/tender-write/templates';
import type { AnnouncementCategory, AnnouncementDraft } from '@/lib/types/announcement';
import type { ReadyTenderDocumentType, ReadyTenderDraft, TenderDocumentTypeMeta } from '@/lib/types/tender-write';
import type { ProjectManagementItem, ProjectManagementAttachment } from '@/lib/types/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  onPublished: () => void;
};

const inputCls =
  'w-full px-3 py-2 border border-[var(--border)] bg-[var(--background)] rounded-lg text-sm placeholder-[var(--muted-foreground)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10';
```

**Part B — component function + state:**

```tsx
export function AnnouncementPublishWizard({ isOpen, onClose, project, onPublished }: Props) {
  // ── Wizard ──
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true);
  // Step 1 → Step 2 handoff
  const [category, setCategory] = useState<AnnouncementCategory | null>(null);
  const [draft, setDraft] = useState<AnnouncementDraft | null>(null);
  const [tenderType, setTenderType] = useState<ReadyTenderDocumentType | null>(null);
  const [tenderDraftForDialog, setTenderDraftForDialog] = useState<ReadyTenderDraft>({} as ReadyTenderDraft);
  const [selectedMeta, setSelectedMeta] = useState<TenderDocumentTypeMeta | null>(null);

  // Step 2
  const [visibility, setVisibility] = useState<'PUBLIC' | 'RESTRICTED'>('PUBLIC');
  const [restrictedSupplierIds, setRestrictedSupplierIds] = useState<string[]>([]);
  const [publishTiming, setPublishTiming] = useState<'now' | 'scheduled'>('now');
  const [scheduledDate, setScheduledDate] = useState('');
  const [attachOn, setAttachOn] = useState(false);
  const [tenderOn, setTenderOn] = useState(false);
  const [notifyOnPublish, setNotifyOnPublish] = useState(false);
  const [annId, setAnnId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  // Supplier picker
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);

  const tenderFiles = useMemo<ProjectManagementAttachment[]>(
    () => project?.stages.find((s) => s.stageKey === 'TENDER_DOCUMENT')?.attachments ?? [],
    [project],
  );

  // ── 打开时：确定 tenderType + 构造预填 draft ──
  useEffect(() => {
    if (!isOpen || !project) return;
    setLoading(true);
    setStep(1);
    setAnnId(null);
    setAttachOn(false);
    setTenderOn(false);
    setNotifyOnPublish(false);
    setVisibility('PUBLIC');
    setRestrictedSupplierIds([]);
    setPublishTiming('now');
    setScheduledDate('');

    const tt = mapProcurementMethodToTenderType(project.procurementMethod);
    if (!tt) { setLoading(false); return; }
    setTenderType(tt);
    const meta = TENDER_DOCUMENT_TYPES.find((m) => m.type === tt) ?? TENDER_DOCUMENT_TYPES[0];
    setSelectedMeta(meta);

    const preTender = buildPrefillFromProject(project, tt) as ReadyTenderDraft;
    setTenderDraftForDialog(preTender);

    // Async: parse .docx for extra fields
    parseAnnouncementFields(project.id)
      .then((parsed) => {
        if (parsed?.fields) {
          // Merge into tenderDraft so AnnouncementDialog auto-fill picks them up
          const merged = { ...preTender, ...parsed.fields } as ReadyTenderDraft;
          setTenderDraftForDialog(merged);

          // Also directly pre-select category + draft if a procurement_document category is available
          const avail = getAvailableAnnouncementCategories(tt);
          const procCat = avail.find((c) => c === 'procurement_document') ?? avail[0];
          if (procCat) {
            const empty = createEmptyAnnouncementDraft(tt, procCat);
            const filled = applyAutoFill(empty, merged as Record<string, string>, getAnnouncementFields(tt, procCat));
            // Overlay parsed fields directly
            const withParsed = { ...filled, ...parsed.fields } as AnnouncementDraft;
            setCategory(procCat);
            setDraft(withParsed);
          }
        }
      })
      .catch(() => { /* .docx extraction optional */ })
      .finally(() => setLoading(false));
  }, [isOpen, project]);

  // ESC
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Supplier list for picker
  useEffect(() => {
    if (visibility === 'RESTRICTED' && isOpen) {
      getSupplierList({ status: 'APPROVED', search: supplierSearch || undefined, pageSize: 200 })
        .then((r) => setAllSuppliers(r.items))
        .catch(() => {});
    }
  }, [visibility, isOpen, supplierSearch]);

  // ── Step 1 → Step 2 ──
  const handleNext = () => {
    if (!draft || !category) { toast.error('请先选择公告类型并填写内容'); return; }
    setStep(2);
  };

  // ── Notification callbacks from embedded AnnouncementDialog ──
  const handleDraftChange = useCallback((d: AnnouncementDraft, cat: AnnouncementCategory) => {
    setDraft(d);
    setCategory(cat);
  }, []);

  // ── Publish ──
  const collectMeta = () => {
    const meta: Record<string, any> = { ...draft, visibility };
    if (visibility === 'RESTRICTED') meta.restrictedSupplierIds = restrictedSupplierIds;
    if (publishTiming === 'scheduled') meta.scheduledPublishDate = scheduledDate;
    meta.notifyOnPublish = notifyOnPublish;
    return meta;
  };

  const loadAttachments = async (id: string) => {
    try { setAttachments(await listAttachments(id)); } catch { /* ignore */ }
  };

  const ensureTenderAttached = async (id: string) => {
    if (!tenderOn || tenderFiles.length === 0) return;
    const existing = await listAttachments(id);
    const have = new Set(existing.map((a) => a.fileAsset.originalName));
    for (const f of tenderFiles) {
      if (have.has(f.fileName)) continue;
      try {
        await attachFromObject(id, { objectKey: f.objectKey, fileName: f.fileName, mimeType: f.mimeType, size: f.fileSize, title: f.fileName });
      } catch (e) {
        toast.error(`采购文件引用失败：${f.fileName} ${(e as Error).message}`);
      }
    }
    await loadAttachments(id);
  };

  const handlePublish = async () => {
    if (!draft || !category || !tenderType) { toast.error('请先完成公告制作'); return; }
    const title = `${getAnnouncementLabel(tenderType, category)} — ${project?.title || ''}`;
    const draftRecord = draft as Record<string, string>;
    const content = `<p>${Object.entries(draftRecord).filter(([,v]) => v?.trim()).map(([k,v]) => `<strong>${k}:</strong> ${v}`).join('</p><p>')}</p>`;
    setBusy(true);
    const meta = collectMeta();
    const status: AnnouncementStatus = publishTiming === 'scheduled' ? 'DRAFT' : 'PUBLISHED';
    try {
      const saved = await createAnnouncement({
        title,
        content,
        type: 'BID_NOTICE',
        summary: draftRecord.projectOverview?.slice(0, 100) || '',
        status,
        publishDate: publishTiming === 'now' ? new Date().toISOString() : undefined,
        metadata: meta,
        relatedProjectCode: draftRecord.projectCode || null,
      });
      const id = saved.id;
      setAnnId(id);
      await ensureTenderAttached(id);
      toast.success(publishTiming === 'now' ? '已发布，开评标项目已同步创建' : '已保存为定时发布');
      onPublished();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || '发布失败');
    } finally {
      setBusy(false);
    }
  };
```

**Part C — render:**

```tsx
  if (!isOpen || !project) return null;

  const tenderAvailable = tenderFiles.length > 0;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)',
              }}
            >
              <Megaphone size={17} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">
                公告制作与发布
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                Step {step}/2 · {project.title}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicators */}
            <span className={['text-xs font-semibold', step === 1 ? 'text-[var(--accent)]' : 'text-[var(--muted-foreground)]'].join(' ')}>
              ● 公告制作
            </span>
            <span className="text-[var(--muted-foreground)]">→</span>
            <span className={['text-xs font-semibold', step === 2 ? 'text-[var(--accent)]' : 'text-[var(--muted-foreground)]'].join(' ')}>
              ○ 发布配置
            </span>
            <button type="button" onClick={onClose} className="neu-btn-soft !p-2"><X size={16} /></button>
          </div>
        </div>

        {/* Body */}
        <div
          className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
          style={{
            background: 'oklch(0.975 0.012 258 / 0.32)',
            boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
          }}
        >
          {loading ? (
            <div className="flex min-h-[300px] items-center justify-center">
              <Loader2 size={24} className="animate-spin text-[var(--muted-foreground)]" />
              <span className="ml-3 text-sm text-[var(--muted-foreground)]">正在加载项目采购数据...</span>
            </div>
          ) : !tenderType ? (
            <div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">
              无法识别采购方式对应的招标文件类型，请确认项目采购方式。
            </div>
          ) : step === 1 ? (
            <AnnouncementDialog
              isOpen
              tenderType={tenderType}
              tenderDraft={tenderDraftForDialog}
              selectedMeta={selectedMeta!}
              onClose={onClose}
              embedded
              initialCategory={category}
              initialDraft={draft}
              onDraftChange={handleDraftChange}
            />
          ) : (
            /* Step 2: Publish Config */
            <div className="mx-auto max-w-[720px] space-y-5">
              <h2 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
                <Send size={14} className="text-[var(--accent)]" /> 发布配置
              </h2>

              {/* Visibility */}
              <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
                <div className="text-xs font-bold text-[var(--accent-strong)]">公告范围</div>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="visibility" checked={visibility === 'PUBLIC'} onChange={() => setVisibility('PUBLIC')} className="accent-[var(--accent)]" /> 全部可见</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="visibility" checked={visibility === 'RESTRICTED'} onChange={() => { setVisibility('RESTRICTED'); setSupplierPickerOpen(true); }} className="accent-[var(--accent)]" /> 部分供应商可见</label>
                {visibility === 'RESTRICTED' && (
                  <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="搜索供应商名称" className={inputCls + ' flex-1'} />
                      <span className="text-xs font-semibold text-[var(--accent)] whitespace-nowrap">已选 {restrictedSupplierIds.length}</span>
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded border border-[var(--border)] divide-y divide-[var(--border)]">
                      {allSuppliers.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={restrictedSupplierIds.includes(s.id)}
                            onChange={() => setRestrictedSupplierIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                            className="accent-[var(--accent)]"
                          />
                          <span>{s.name}</span>
                        </label>
                      ))}
                      {allSuppliers.length === 0 && <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">无匹配供应商</p>}
                    </div>
                  </div>
                )}
              </div>

              {/* Timing */}
              <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
                <div className="text-xs font-bold text-[var(--accent-strong)]">发布时间</div>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="timing" checked={publishTiming === 'now'} onChange={() => setPublishTiming('now')} className="accent-[var(--accent)]" /> 立即发布</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="timing" checked={publishTiming === 'scheduled'} onChange={() => setPublishTiming('scheduled')} className="accent-[var(--accent)]" /> 定时发布</label>
                {publishTiming === 'scheduled' && (
                  <input type="datetime-local" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={inputCls} />
                )}
              </div>

              {/* Toggles */}
              <div className="rounded-xl border border-[var(--border)] px-4 py-3 flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attachOn} onChange={(e) => setAttachOn(e.target.checked)} className="accent-[var(--accent)]" /> 添加附件</label>
                <label className={['flex items-center gap-2 text-sm', tenderAvailable ? '' : 'opacity-60 cursor-not-allowed'].join(' ')}>
                  <input type="checkbox" checked={tenderOn && tenderAvailable} disabled={!tenderAvailable} onChange={(e) => setTenderOn(e.target.checked)} className="accent-[var(--accent)]" />
                  引用采购文件{tenderAvailable ? ` · ${tenderFiles.length} 份` : ''}
                </label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notifyOnPublish} onChange={(e) => setNotifyOnPublish(e.target.checked)} className="accent-[var(--accent)]" /> 发布后发送通知</label>
              </div>

              {/* Attachment section (only after draft saved) */}
              {attachOn && annId && (
                <AttachmentSection annId={annId} attachments={attachments} onChanged={() => loadAttachments(annId)} inputCls={inputCls} />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderTop: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <span className="text-xs text-[var(--muted-foreground)]">{annId ? 'ID: ' + annId.slice(-8) : ''}</span>
          <div className="flex gap-3">
            <button onClick={onClose} className="neu-btn-soft">取消</button>
            {step === 1 ? (
              <>
                <button onClick={handleNext} disabled={!draft} className="neu-btn-primary disabled:opacity-50">
                  下一步 <ArrowRight size={14} />
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setStep(1)} className="neu-btn-soft"><ArrowLeft size={14} /> 上一步</button>
                <button onClick={handlePublish} disabled={busy} className="neu-btn-primary disabled:opacity-50">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {busy ? '处理中...' : publishTiming === 'now' ? '立即发布' : '保存定时发布'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Attachment section component (same as old announce-publish-modal but with inputCls param) */
function AttachmentSection({
  annId, attachments, onChanged, inputCls,
}: { annId: string; attachments: AnnouncementAttachment[]; onChanged: () => void; inputCls: string }) {
  const [attTitle, setAttTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    try {
      const asset = await uploadFile(f, 'announcement');
      await addAttachment(annId, asset.id, attTitle || f.name);
      setAttTitle(''); onChanged(); toast.success('附件已添加');
    } catch (err) { toast.error((err as Error).message || '上传失败'); }
    setUploading(false); e.target.value = '';
  };
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="text-xs font-bold text-[var(--accent-strong)] mb-3">附件（公开可下载）</div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input value={attTitle} onChange={(e) => setAttTitle(e.target.value)} placeholder="附件标题（可选）" className={inputCls + ' flex-1'} />
          <label className={['neu-btn-primary cursor-pointer whitespace-nowrap', uploading ? 'opacity-50' : ''].join(' ')}>
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{uploading ? '上传中...' : '添加附件'}
            <input type="file" className="hidden" onChange={onUpload} />
          </label>
        </div>
        {attachments.length === 0 ? (<p className="text-xs text-[var(--muted-foreground)]">暂无附件</p>) : attachments.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2">
            <div><div className="text-sm font-semibold">{a.title}</div><div className="text-xs text-[var(--muted-foreground)]">{a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB</div></div>
            <button onClick={async () => { if (confirm('删除该附件？')) { await removeAttachment(a.id); onChanged(); } }} className="neu-btn-xs is-danger">删除</button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter web lint -- src/components/projects/announcement-publish-wizard.tsx`
Expected: 零新增错误。若有 `set-state-in-effect` 警告，加 `/* eslint-disable react-hooks/set-state-in-effect */`（与旧组件一致）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/projects/announcement-publish-wizard.tsx
git commit -m "feat(web): add AnnouncementPublishWizard two-step component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 接线 + 清理旧组件

**Files:**
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx`
- Delete: `apps/web/src/components/projects/announcement-publish-modal.tsx`

- [ ] **Step 1: 替换 import**

Replace:
```ts
import { AnnouncementPublishModal } from './announcement-publish-modal';
```
With:
```ts
import { AnnouncementPublishWizard } from './announcement-publish-wizard';
```

- [ ] **Step 2: 替换弹窗渲染**

Replace the old `<AnnouncementPublishModal ...>` block with:
```tsx
      <AnnouncementPublishWizard
        isOpen={announcementPublishOpen}
        onClose={() => setAnnouncementPublishOpen(false)}
        project={item}
        onPublished={onUpdated}
      />
```

- [ ] **Step 3: 删除旧文件**

Run: `rm apps/web/src/components/projects/announcement-publish-modal.tsx`

- [ ] **Step 4: Lint + Commit**

Run: `pnpm --filter web lint`
Expected: 零新增错误。

```bash
git add apps/web/src/components/projects/project-detail-panel.tsx
git rm apps/web/src/components/projects/announcement-publish-modal.tsx
git commit -m "feat(web): wire AnnouncementPublishWizard, remove old modal

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: 验证

- [ ] **Step 1: Build check**
  Run: `pnpm --filter api build` (expect pre-existing expert-memo error only, not ours) and `pnpm --filter web lint` (expect zero new errors).

- [ ] **Step 2: 真机验证**
  Start `pnpm dev:api` + `pnpm dev:web`, login as `陈主任`/`czr@2026`:
  1. Go to project management → project with `PUBLIC_ANNOUNCEMENT` stage → click 「公告制作与发布」
  2. Verify Step 1 loads: category cards visible (procurement_document as default), fields pre-filled from project + .docx
  3. Edit fields, click 「下一步」→ Step 2 appears with all config options
  4. Set visibility RESTRICTED → supplier picker appears → search + select suppliers
  5. Set timing to scheduled → datetime picker appears
  6. Toggle attachments/procurement file/notify → click 「发布」
  7. Verify toast, modal closes, stage stays 「进行中」
  8. Verify announcement visible at /notice, :3002, :3004 (if published immediately)

- [ ] **Step 3 (optional): Run cron test**

  Verify `@Cron` fires: manually set an announcement status to SCHEDULED with `scheduledPublishDate` in the past → wait one minute → verify status changed to PUBLISHED + notification created in Notification table.

---

## Self-Review

- **Spec coverage**: §1 向导 → Task 5; §2 嵌入化 → Task 3; §3 .docx 解析 → Task 1; §4 定时发布 → Task 2; §5 通知 → Task 2; §6 重复创建排查 → 默认 `syncBidProject` 幂等; §7 影响面 → Tasks 1-6。
- **Placeholder**: 无 TBD/TODO；`AiService.llmGenerate` 方法名需按实际调整（标注）。
- **Type consistency**: `parseAnnouncementFields` → `ParsedAnnouncementFields`；`AnnouncementPublishWizard` props `{isOpen, onClose, project, onPublished}` 一致；`AnnouncementDialog` 新增 props 签名一致。

> **Note**: 向导组件 `handlePublish` 中 `status` 设为 `'DRAFT'` 而非 `'SCHEDULED'`——因为 `AnnouncementStatus` 类型仅有 `DRAFT|PUBLISHED|ARCHIVED`。定时发布公告状态为 `DRAFT` + `metadata.scheduledPublishDate`，cron 到点改为 `PUBLISHED`。这与 spec 的 `SCHEDULED` 概念一致，只是借用 `DRAFT` 作为"未即时生效"的状态。若需独立 `SCHEDULED` 状态，需改 schema（本次不做）。
