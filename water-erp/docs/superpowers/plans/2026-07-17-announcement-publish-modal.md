# 采购公告「公告制作与发布」弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在项目管理详情面板 `PUBLIC_ANNOUNCEMENT` 阶段的「公告制作与发布」按钮上，弹出一个锁定 `BID_NOTICE` 的采购公告制作弹窗（项目数据预填、可加附件、可引用项目已有采购文件），发布后公告在 3002 / :3005 `/notice` / :3004 可见。

**Architecture:** 前端新增自绘外壳弹窗组件 `announcement-publish-modal.tsx`（沿用 `ExpertExtractModal` 外壳约定），在 `project-detail-panel.tsx` 的 `onStageAction` 接线；后端在公告附件服务新增 `attachFromObject` 方法 + `POST /announcements/:id/attachments/from-object` 路由，读取项目本地采购文件（`uploads/<objectKey>`）复制到 MinIO 并建 `FileAsset` + `AnnouncementAttachment`，实现「用户无需手动重新上传」。

**Tech Stack:** NestJS 11 + Prisma（后端）、Next.js 16 + React 19 + Tailwind v4（前端）、MinIO（对象存储）、jest（后端单测）。

## Global Constraints

- 工作目录：后端在 `apps/api`、前端在 `apps/web`；workspace 命令在 `water-erp/` 根用 `pnpm --filter api` / `pnpm --filter web`。
- 公告类型**锁定** `BID_NOTICE`；不出现类型选择器；不处理供应商邀请（本期不做）。
- 发布**不**自动完成 `PUBLIC_ANNOUNCEMENT` 阶段；发布成功后调 `onPublished()` 刷新项目并关窗。
- 视觉走既有 `neu-btn-primary / neu-btn-soft / neu-btn-xs`、`RichTextEditor`、`wb-section-rule`，遵循 `ERP/water-erp/.claude/skills/neumorphic-design`；无新硬编码色，弹窗外壳与 `ExpertExtractModal` 完全同款（遮罩 `oklch(0.975 0.012 258 / 0.72)` + `blur(5px)`）。
- 无 mock 数据：全量真实 API；失败/空走真实 toast。
- 验证约定（仓库既有）：后端走单测 `pnpm --filter api test`；前端走 `pnpm --filter web lint` + 真机视觉截图（无 jsdom 组件测试基建，不新增）。
- 端到端不改动 schema、零 Prisma 迁移。

---

## File Structure

- **Create** `apps/api/src/announcement/announcement-attachment.service.spec.ts` — `attachFromObject` 单测。
- **Modify** `apps/api/src/announcement/announcement-attachment.service.ts` — 新增 `attachFromObject` 方法 + 顶部 import。
- **Modify** `apps/api/src/announcement/announcement.controller.ts` — 新增 `POST :id/attachments/from-object` 路由 + `CurrentUser`/`AuthenticatedUser` import。
- **Modify** `apps/web/src/lib/api/announcement.ts` — 新增 `attachFromObject` 客户端方法。
- **Create** `apps/web/src/components/projects/announcement-publish-modal.tsx` — 弹窗组件。
- **Modify** `apps/web/src/components/projects/project-detail-panel.tsx` — 接线（import + state + `onStageAction` 分支 + 底部渲染）。

---

## Task 1: 后端 `attachFromObject`（service + controller + 单测）

**Files:**
- Create: `apps/api/src/announcement/announcement-attachment.service.spec.ts`
- Modify: `apps/api/src/announcement/announcement-attachment.service.ts`（顶部 import + 新方法）
- Modify: `apps/api/src/announcement/announcement.controller.ts`（import + 新路由）

**Interfaces:**
- Produces: `AnnouncementAttachmentService.attachFromObject(announcementId, dto, userId?)`，`dto = { objectKey; fileName?; title?; mimeType?; size? }`，返回 `AnnouncementAttachment`（含 `fileAsset`）。
- Produces: HTTP `POST /api/announcements/:id/attachments/from-object`，body 同 dto，`@Roles('admin','bid_host','procurement_staff','leader','staff')`。

- [ ] **Step 1: 写失败的单测**

Create `apps/api/src/announcement/announcement-attachment.service.spec.ts`:

```ts
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnnouncementAttachmentService } from './announcement-attachment.service';

jest.mock('../upload/minio.client', () => ({
  minioClient: { putObject: jest.fn(), removeObject: jest.fn(), getObject: jest.fn() },
  MINIO_BUCKET: 'test-bucket',
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { minioClient } = require('../upload/minio.client');

describe('AnnouncementAttachmentService.attachFromObject', () => {
  const uploadsSubdir = resolve(process.cwd(), 'uploads', 'project-management');
  let tmpKey: string;
  let tmpPath: string;
  let service: AnnouncementAttachmentService;
  let prisma: any;
  const fileBuffer = Buffer.from('hello-procurement');

  beforeEach(async () => {
    jest.clearAllMocks();
    await mkdir(uploadsSubdir, { recursive: true });
    tmpKey = `project-management/spec-${Date.now()}.docx`;
    tmpPath = resolve(process.cwd(), 'uploads', tmpKey);
    await writeFile(tmpPath, fileBuffer);

    prisma = {
      announcement: { findUnique: jest.fn() },
      fileAsset: { create: jest.fn() },
      announcementAttachment: { create: jest.fn() },
    };
    service = new AnnouncementAttachmentService(prisma as PrismaService);
  });

  afterEach(async () => {
    await rm(tmpPath, { force: true });
  });

  it('公告不存在时抛出 NotFoundException', async () => {
    prisma.announcement.findUnique.mockResolvedValue(null);
    await expect(
      service.attachFromObject('ann-1', { objectKey: tmpKey, fileName: 'f.docx' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('源文件不存在时抛出 NotFoundException', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'ann-1' });
    await expect(
      service.attachFromObject('ann-1', {
        objectKey: 'project-management/never-exists.bin',
        fileName: 'x.bin',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('成功：读文件、算 sha256、传 MinIO、建 FileAsset 与附件', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'ann-1' });
    (minioClient.putObject as jest.Mock).mockResolvedValue(undefined);
    prisma.fileAsset.create.mockResolvedValue({ id: 'fa-1' });
    prisma.announcementAttachment.create.mockResolvedValue({ id: 'att-1', fileAssetId: 'fa-1' });

    const result = await service.attachFromObject(
      'ann-1',
      {
        objectKey: tmpKey,
        fileName: '采购文件.docx',
        mimeType: 'application/vnd.openxmlformats',
        size: 123,
        title: '采购文件',
      },
      'user-9',
    );

    const expectedSha = createHash('sha256').update(fileBuffer).digest('hex');
    expect(minioClient.putObject).toHaveBeenCalledWith(
      'test-bucket',
      expect.stringMatching(/^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.docx$/),
      fileBuffer,
      fileBuffer.length,
      { 'Content-Type': 'application/vnd.openxmlformats' },
    );
    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: {
        key: expect.stringMatching(/^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.docx$/),
        originalName: '采购文件.docx',
        mimeType: 'application/vnd.openxmlformats',
        size: 123,
        sha256: expectedSha,
        category: 'announcement',
        uploaderId: 'user-9',
      },
    });
    expect(prisma.announcementAttachment.create).toHaveBeenCalledWith({
      data: { announcementId: 'ann-1', fileAssetId: 'fa-1', title: '采购文件' },
      include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } },
    });
    expect(result).toEqual({ id: 'att-1', fileAssetId: 'fa-1' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter api test -- announcement-attachment.service.spec.ts`
Expected: FAIL（`attachFromObject is not a function` 或编译错误）。

- [ ] **Step 3: 在 service 顶部加 import**

Modify `apps/api/src/announcement/announcement-attachment.service.ts` — 在第 1-3 行的 import 块后追加：

```ts
import { resolve } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
```

- [ ] **Step 4: 在 service 中实现 `attachFromObject`**

在 `announcement-attachment.service.ts` 的 `add` 方法之后（`remove` 之前）插入：

```ts
  /**
   * 从已有本地对象挂载公告附件（用于「引用项目采购文件」）。
   * 读取 uploads/<objectKey> 本地文件 → 复制到 MinIO → 建 FileAsset + AnnouncementAttachment。
   */
  async attachFromObject(
    announcementId: string,
    dto: {
      objectKey: string;
      fileName?: string;
      title?: string;
      mimeType?: string;
      size?: number;
    },
    userId?: string,
  ) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!announcement) {
      throw new NotFoundException({ error: '公告不存在', code: 'NOT_FOUND' });
    }

    const localPath = resolve(process.cwd(), 'uploads', dto.objectKey);
    try {
      await access(localPath);
    } catch {
      throw new NotFoundException({ error: '源文件不存在', code: 'SOURCE_NOT_FOUND' });
    }
    const buffer = await readFile(localPath);
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    const baseName = dto.fileName || dto.objectKey;
    const ext = baseName.includes('.') ? baseName.split('.').pop()!.toLowerCase() : 'bin';
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const mimeType = dto.mimeType || 'application/octet-stream';

    await minioClient.putObject(MINIO_BUCKET, key, buffer, buffer.length, {
      'Content-Type': mimeType,
    });

    const fileAsset = await this.prisma.fileAsset.create({
      data: {
        key,
        originalName: baseName,
        mimeType,
        size: dto.size ?? buffer.length,
        sha256,
        category: 'announcement',
        uploaderId: userId,
      },
    });

    return this.prisma.announcementAttachment.create({
      data: {
        announcementId,
        fileAssetId: fileAsset.id,
        title: dto.title || baseName,
      },
      include: { fileAsset: { select: { id: true, originalName: true, size: true, mimeType: true } } },
    });
  }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter api test -- announcement-attachment.service.spec.ts`
Expected: PASS（3 个用例全绿）。

- [ ] **Step 6: 在 controller 加 import**

Modify `apps/api/src/announcement/announcement.controller.ts` — 在已有 import 块中追加（`Roles`/`Public` 那两行附近）：

```ts
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
```

- [ ] **Step 7: 在 controller 加路由**

在 `announcement.controller.ts` 的 `addAttachment`（`@Post(':id/attachments')`）之后插入：

```ts
  @Post(':id/attachments/from-object')
  @Roles('admin', 'bid_host', 'procurement_staff', 'leader', 'staff')
  @ApiOperation({ summary: '从已有对象挂载公告附件（引用项目采购文件）' })
  async attachFromObject(
    @Param('id') id: string,
    @Body() body: { objectKey: string; fileName?: string; title?: string; mimeType?: string; size?: number },
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.attachmentService.attachFromObject(id, body, user?.sub);
  }
```

- [ ] **Step 8: 构建后端确认编译通过**

Run: `pnpm --filter api build`
Expected: 编译成功，无 TS 错误。

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/announcement/announcement-attachment.service.ts \
        apps/api/src/announcement/announcement-attachment.service.spec.ts \
        apps/api/src/announcement/announcement.controller.ts
git commit -m "feat(announcement): add attachFromObject endpoint to mount project tender doc

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 前端 API 客户端方法

**Files:**
- Modify: `apps/web/src/lib/api/announcement.ts`

**Interfaces:**
- Consumes: Task 1 的 `POST /announcements/:id/attachments/from-object`。
- Produces: `attachFromObject(announcementId, data)` → `AnnouncementAttachment`。

- [ ] **Step 1: 在 `announcement.ts` 加客户端方法**

在 `apps/web/src/lib/api/announcement.ts` 的 `removeAttachment` 之后（`/* ── 普通附件 ── */` 区块内，`uploadFile` 之前）插入：

```ts
/** 从已有本地对象挂载公告附件（引用项目采购文件，后端复制到 MinIO） */
export function attachFromObject(
  announcementId: string,
  data: { objectKey: string; fileName?: string; title?: string; mimeType?: string; size?: number },
) {
  return api.post<AnnouncementAttachment>(
    `/announcements/${announcementId}/attachments/from-object`,
    data,
  );
}
```

- [ ] **Step 2: Lint 确认**

Run: `pnpm --filter web lint`
Expected: 无新增错误（`attachFromObject` 已导出，类型匹配）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/announcement.ts
git commit -m "feat(web): add attachFromObject announcement api client

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: 前端弹窗组件 `announcement-publish-modal.tsx`

**Files:**
- Create: `apps/web/src/components/projects/announcement-publish-modal.tsx`

**Interfaces:**
- Consumes: Task 2 的 `attachFromObject` + 既有 `createAnnouncement / updateAnnouncement / listAttachments / addAttachment / removeAttachment / uploadFile`；`RichTextEditor`；`ProjectManagementItem`（含 `stages[].attachments`，字段 `objectKey/fileName/mimeType/fileSize`）。
- Produces: `AnnouncementPublishModal({ isOpen, onClose, project, onPublished })`。

- [ ] **Step 1: 创建组件文件**

Create `apps/web/src/components/projects/announcement-publish-modal.tsx`：

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Megaphone, X, Save, Send, Upload, Loader2 } from 'lucide-react';
import {
  createAnnouncement,
  updateAnnouncement,
  listAttachments,
  addAttachment,
  removeAttachment,
  uploadFile,
  attachFromObject,
} from '@/lib/api/announcement';
import type {
  AnnouncementAttachment,
  AnnouncementStatus,
} from '@/lib/api/announcement';
import { RichTextEditor } from '@/components/rich-text-editor';
import type {
  ProjectManagementItem,
  ProjectManagementAttachment,
} from '@/lib/types/project-management';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  onPublished: () => void;
};

const META_FIELDS = [
  { key: 'projectCode', label: '项目编号' },
  { key: 'method', label: '招标方式' },
  { key: 'budget', label: '预算金额' },
  { key: 'scope', label: '采购内容/范围', area: true },
  { key: 'qualification', label: '投标人资格要求', area: true },
  { key: 'deadline', label: '报名/投标截止', date: true },
  { key: 'openTime', label: '开标时间', date: true },
  { key: 'contact', label: '联系方式' },
] as const;

const inputCls =
  'w-full px-3 py-2 border border-[var(--border)] bg-[var(--background)] rounded-lg text-sm placeholder-[var(--muted-foreground)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10';

function buildPrefill(project: ProjectManagementItem) {
  const code = project.departmentNumber || project.contractNumber || '';
  const budgetNum = Number(project.budgetAmount || 0);
  const budget = budgetNum > 0 ? `${budgetNum.toLocaleString('zh-CN')} 元` : '';
  const scope = [project.procurementCategory, project.projectOverview]
    .filter(Boolean)
    .join('；');
  const contactParts = [project.requesterName, project.requesterDepartment].filter(Boolean);
  const contact = contactParts.length === 2 ? `${contactParts[0]}（${contactParts[1]}）` : contactParts.join('');
  const metadata: Record<string, string> = {
    projectCode: code,
    method: project.procurementMethod || '',
    budget,
    scope,
    qualification: project.supplierRequirements || '',
    deadline: '',
    openTime: project.bidOpeningTime || '',
    contact,
  };
  const esc = (s: string) => (s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const title = `关于${project.title}的采购公告`;
  const content = [
    `<p><strong>项目名称：</strong>${esc(project.title)}</p>`,
    `<p><strong>采购方式：</strong>${esc(project.procurementMethod)}</p>`,
    `<p><strong>预算金额：</strong>${esc(budget)}</p>`,
    `<p><strong>采购内容/范围：</strong>${esc(scope)}</p>`,
    `<p><strong>投标人资格要求：</strong>${esc(project.supplierRequirements)}</p>`,
    `<p><strong>报名/投标截止：</strong></p>`,
    `<p><strong>开标时间：</strong>${esc(project.bidOpeningTime)}</p>`,
    `<p><strong>联系方式：</strong>${esc(contact)}</p>`,
  ].join('');
  return { metadata, title, content };
}

export function AnnouncementPublishModal({ isOpen, onClose, project, onPublished }: Props) {
  const [annId, setAnnId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [publishDate, setPublishDate] = useState(new Date().toISOString().slice(0, 10));
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [attachOn, setAttachOn] = useState(false);
  const [tenderOn, setTenderOn] = useState(false);
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [busy, setBusy] = useState(false);

  const tenderFiles = useMemo<ProjectManagementAttachment[]>(
    () => project?.stages.find((s) => s.stageKey === 'TENDER_DOCUMENT')?.attachments ?? [],
    [project],
  );

  // 打开/切换项目时预填
  useEffect(() => {
    if (!isOpen || !project) return;
    const pre = buildPrefill(project);
    setTitle(pre.title);
    setContent(pre.content);
    setMetadata(pre.metadata);
    setSummary('');
    setAnnId(null);
    setAttachOn(false);
    setTenderOn(false);
    setAttachments([]);
    setPublishDate(new Date().toISOString().slice(0, 10));
  }, [isOpen, project]);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const loadAttachments = async (id: string) => {
    try {
      setAttachments(await listAttachments(id));
    } catch {
      /* ignore */
    }
  };

  const collectMeta = () => {
    const meta: Record<string, string> = {};
    for (const f of META_FIELDS) {
      const v = metadata[f.key]?.trim();
      if (v) meta[f.key] = v;
    }
    return meta;
  };

  // 引用项目采购文件（去重：已挂过的跳过）
  const ensureTenderAttached = async (id: string) => {
    if (!tenderOn || tenderFiles.length === 0) return;
    const existing = await listAttachments(id);
    const have = new Set(existing.map((a) => a.fileAsset.originalName));
    for (const f of tenderFiles) {
      if (have.has(f.fileName)) continue;
      try {
        await attachFromObject(id, {
          objectKey: f.objectKey,
          fileName: f.fileName,
          mimeType: f.mimeType,
          size: f.fileSize,
          title: f.fileName,
        });
      } catch (e) {
        toast.error(`采购文件引用失败：${f.fileName} ${(e as Error).message}`);
      }
    }
    await loadAttachments(id);
  };

  const saveDraft = async () => {
    if (!title.trim()) {
      toast.error('请填写标题');
      return;
    }
    setBusy(true);
    const meta = collectMeta();
    const payload = {
      title,
      content,
      type: 'BID_NOTICE' as const,
      summary,
      status: 'DRAFT' as AnnouncementStatus,
      publishDate,
      metadata: meta,
      relatedProjectCode: meta.projectCode || null,
    };
    try {
      let id = annId;
      if (id) {
        await updateAnnouncement(id, payload);
      } else {
        const saved = await createAnnouncement(payload);
        id = saved.id;
        setAnnId(id);
      }
      await ensureTenderAttached(id);
      toast.success('草稿已保存');
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!title.trim()) {
      toast.error('请填写标题');
      return;
    }
    setBusy(true);
    const meta = collectMeta();
    const payload = {
      title,
      content,
      type: 'BID_NOTICE' as const,
      summary,
      status: 'PUBLISHED' as AnnouncementStatus,
      publishDate,
      metadata: meta,
      relatedProjectCode: meta.projectCode || null,
    };
    try {
      let id = annId;
      if (id) {
        await updateAnnouncement(id, payload);
      } else {
        const saved = await createAnnouncement(payload);
        id = saved.id;
        setAnnId(id);
      }
      await ensureTenderAttached(id);
      toast.success('已发布，开评标项目已同步创建');
      onPublished();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || '发布失败');
    } finally {
      setBusy(false);
    }
  };

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
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* 标题栏 */}
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
                采购公告（招标公示）· 项目数据已自动预填，可直接编辑后发布
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-soft !p-2">
            <X size={16} />
          </button>
        </div>

        {/* 滚动正文 */}
        <div
          className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
          style={{
            background: 'oklch(0.975 0.012 258 / 0.32)',
            boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
          }}
        >
          <div className="mx-auto max-w-[860px] space-y-5">
            {!annId && (
              <div className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent-soft)]/50 px-4 py-2.5 text-xs text-[var(--accent-strong)]">
                先填写基本信息并「保存草稿」后，才能上传附件与引用采购文件；全部配齐后再「发布」。
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">发布日期</label>
                <input type="date" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">类型</label>
                <input value="采购公告（招标公示）" disabled className={inputCls + ' text-[var(--muted-foreground)]'} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">标题</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="公告标题..." />
            </div>

            {/* 结构化元数据 */}
            <div className="rounded-xl border border-[var(--accent)]/15 bg-[var(--accent-soft)]/30 p-5">
              <div className="text-xs font-bold text-[var(--accent-strong)] mb-4">采购公告 — 结构化信息</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {META_FIELDS.map((f) => {
                  const val = metadata[f.key] || '';
                  return (
                    <div key={f.key} className={'area' in f && f.area ? 'sm:col-span-2' : ''}>
                      <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">{f.label}</label>
                      {'area' in f && f.area ? (
                        <textarea value={val} onChange={(e) => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls + ' h-20 resize-none'} />
                      ) : 'date' in f && f.date ? (
                        <input type="datetime-local" value={val} onChange={(e) => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls} />
                      ) : (
                        <input value={val} onChange={(e) => setMetadata({ ...metadata, [f.key]: e.target.value })} className={inputCls} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">正文内容</label>
              <RichTextEditor value={content} onChange={setContent} placeholder="开始输入正文内容..." />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] mb-1.5">摘要（可选）</label>
              <input value={summary} onChange={(e) => setSummary(e.target.value)} className={inputCls} placeholder="简要概述..." />
            </div>

            {/* 开关 */}
            <div className="flex flex-wrap items-center gap-6 rounded-xl border border-[var(--border)] px-4 py-3">
              <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                <input type="checkbox" checked={attachOn} onChange={(e) => setAttachOn(e.target.checked)} className="accent-[var(--accent)]" />
                添加附件
              </label>
              <label
                className={[
                  'flex items-center gap-2 text-sm',
                  tenderAvailable ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)] opacity-60 cursor-not-allowed',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  checked={tenderOn && tenderAvailable}
                  disabled={!tenderAvailable}
                  onChange={(e) => setTenderOn(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                添加采购文件（引用本项目已有文件{tenderAvailable ? ` · ${tenderFiles.length} 份` : ''}）
              </label>
              {!tenderAvailable && (
                <span className="text-xs text-[var(--muted-foreground)]">本项目暂无采购文件可引用</span>
              )}
            </div>

            {/* 附件区 */}
            {attachOn && annId && (
              <AttachmentSection annId={annId} attachments={attachments} onChanged={() => loadAttachments(annId)} />
            )}
            {attachOn && !annId && (
              <p className="text-xs text-[var(--muted-foreground)]">保存草稿后可上传附件。</p>
            )}
          </div>
        </div>

        {/* 操作栏 */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderTop: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <span className="text-xs text-[var(--muted-foreground)]">
            {annId ? 'ID: ' + annId.slice(-8) : '未保存'}
          </span>
          <div className="flex gap-3">
            <button onClick={onClose} className="neu-btn-soft">取消</button>
            <button onClick={saveDraft} disabled={busy} className="neu-btn-soft is-info disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {busy ? '保存中...' : '保存草稿'}
            </button>
            <button onClick={publish} disabled={busy} className="neu-btn-primary disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {busy ? '处理中...' : '发布'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentSection({
  annId,
  attachments,
  onChanged,
}: {
  annId: string;
  attachments: AnnouncementAttachment[];
  onChanged: () => void;
}) {
  const [attTitle, setAttTitle] = useState('');
  const [uploading, setUploading] = useState(false);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const asset = await uploadFile(f, 'announcement');
      await addAttachment(annId, asset.id, attTitle || f.name);
      setAttTitle('');
      onChanged();
      toast.success('附件已添加');
    } catch (err) {
      toast.error((err as Error).message || '上传失败');
    }
    setUploading(false);
    e.target.value = '';
  };

  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="text-xs font-bold text-[var(--accent-strong)] mb-3">附件（公开可下载）</div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={attTitle}
            onChange={(e) => setAttTitle(e.target.value)}
            placeholder="附件标题（可选）"
            className={inputCls + ' flex-1'}
          />
          <label
            className={['neu-btn-primary cursor-pointer whitespace-nowrap', uploading ? 'opacity-50' : ''].join(' ')}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? '上传中...' : '添加附件'}
            <input type="file" className="hidden" onChange={onUpload} />
          </label>
        </div>
        {attachments.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">暂无附件</p>
        ) : (
          attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <div>
                <div className="text-sm font-semibold text-[var(--foreground)]">{a.title}</div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {a.fileAsset.originalName} · {(a.fileAsset.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                onClick={async () => {
                  if (confirm('删除该附件？')) {
                    await removeAttachment(a.id);
                    onChanged();
                  }
                }}
                className="neu-btn-xs is-danger"
              >
                删除
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint 确认**

Run: `pnpm --filter web lint`
Expected: 无新增错误。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/projects/announcement-publish-modal.tsx
git commit -m "feat(web): add AnnouncementPublishModal component

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 在 `project-detail-panel.tsx` 接线

**Files:**
- Modify: `apps/web/src/components/projects/project-detail-panel.tsx`（import :29、state :371、`onStageAction` :793、底部渲染 :1448）

**Interfaces:**
- Consumes: Task 3 的 `AnnouncementPublishModal`。

- [ ] **Step 1: 加 import**

在 `project-detail-panel.tsx` 顶部 import 区（`ExpertExtractModal` import 行附近，约第 29 行）追加：

```ts
import { AnnouncementPublishModal } from './announcement-publish-modal';
```

- [ ] **Step 2: 加 state**

把 `const [expertExtractOpen, setExpertExtractOpen] = useState(false);`（第 371 行）替换为两行：

```ts
  const [expertExtractOpen, setExpertExtractOpen] = useState(false);
  const [announcementPublishOpen, setAnnouncementPublishOpen] = useState(false);
```

- [ ] **Step 3: `onStageAction` 加 `PUBLIC_ANNOUNCEMENT` 分支**

把现有 handler：

```ts
              onStageAction={(stageKey) => {
                if (stageKey === 'TENDER_DOCUMENT') {
                  setTenderWriteStageAction(stageKey);
                } else if (stageKey === 'EXPERT_SELECTION') {
                  setExpertExtractOpen(true);
                }
              }}
```

替换为：

```ts
              onStageAction={(stageKey) => {
                if (stageKey === 'TENDER_DOCUMENT') {
                  setTenderWriteStageAction(stageKey);
                } else if (stageKey === 'EXPERT_SELECTION') {
                  setExpertExtractOpen(true);
                } else if (stageKey === 'PUBLIC_ANNOUNCEMENT') {
                  setAnnouncementPublishOpen(true);
                }
              }}
```

- [ ] **Step 4: 底部渲染弹窗**

在文件末尾的 `ExpertExtractModal` 块之后（`</>` 闭合之前）追加：

```tsx
      {/* 公告制作与发布弹窗 */}
      <AnnouncementPublishModal
        isOpen={announcementPublishOpen}
        onClose={() => setAnnouncementPublishOpen(false)}
        project={item}
        onPublished={onUpdated}
      />
```

- [ ] **Step 5: Lint 确认**

Run: `pnpm --filter web lint`
Expected: 无新增错误；`AnnouncementPublishModal`、`announcementPublishOpen` 均被使用，无未用变量告警。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/projects/project-detail-panel.tsx
git commit -m "feat(web): wire AnnouncementPublishModal into PUBLIC_ANNOUNCEMENT stage

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: 真机视觉验证

**Files:** 无（验证性任务）

- [ ] **Step 1: 启动后端与 web**

Run（在 `water-erp/` 根，两个进程）:
```bash
pnpm --filter api build && pnpm dev:api   # :4001
pnpm dev:web                              # :3005
```
Expected: 两个服务正常启动，无编译错误。

- [ ] **Step 2: 登录并进入项目管理详情**

浏览器开 `http://localhost:3005`，用 `陈主任` / `czr@2026`（procurement_staff）登录 → 侧栏「项目管理」→ 选一个 `采购公告公示` 阶段已可见的项目（采购方式为 竞价/直接采购/邀请招标/询比 之一）。

- [ ] **Step 3: 截图验证弹窗与预填**

点击该阶段卡片「公告制作与发布」→ 截图。Expected：弹窗弹出（磨砂遮罩 + ESC/点遮罩可关）；标题、8 个元数据字段、正文均按项目数据预填。

- [ ] **Step 4: 截图验证「采购文件」开关**

- 对一个 `TENDER_DOCUMENT` 有文件的项目：开关可用、显示「· N 份」→ 勾选 → 「保存草稿」→ 列表出现引用的采购文件 → 截图。
- 对 `直接采购`（无 `TENDER_DOCUMENT`）项目：开关禁用、提示「本项目暂无采购文件可引用」→ 截图。

- [ ] **Step 5: 截图验证发布即可见**

「发布」→ toast「已发布，开评标项目已同步创建」→ 弹窗关闭、项目刷新；`PUBLIC_ANNOUNCEMENT` 阶段**仍为「进行中」**（未自动完成）→ 截图。再到 `http://localhost:3002`（3002 首页）、`http://localhost:3005/notice`（信息发布中心）确认该公告可见 → 截图。

- [ ] **Step 6:（可选）Commit 验证记录**

无需提交（验证任务）。

---

## Self-Review 记录

- **Spec coverage**：§1 接线 → Task 4；§2 弹窗内容/预填/两开关 → Task 3；§3 数据流（草稿→附件→发布）→ Task 3 `saveDraft/publish/ensureTenderAttached`；§4 后端接口 → Task 1；§5 边界（直接采购无文件、无编号）→ Task 3 `tenderAvailable`/`relatedProjectCode`；验收 1-6 → Task 5。全覆盖。
- **Placeholder scan**：无 TBD/TODO；所有代码块完整。
- **Type consistency**：`attachFromObject`（service/controller/client）签名一致 `(announcementId, { objectKey, fileName?, title?, mimeType?, size? }, userId?)`；`AnnouncementPublishModal` props `{ isOpen, onClose, project, onPublished }` 与 Task 4 接线一致；`ProjectManagementAttachment` 字段 `objectKey/fileName/mimeType/fileSize` 与 `project-management.ts` 类型一致。
