# 采购公告「公告制作与发布」两步向导

**日期**: 2026-07-17（修订版，替代 `2026-07-17-announcement-publish-modal-design.md`）
**范围**: `apps/web` (:3005) + `apps/api` (:4001)。项目管理详情面板 `PUBLIC_ANNOUNCEMENT` 阶段的「公告制作与发布」按钮。
**Phase**: 单次交付（向导组件 + AnnouncementDialog 嵌入化 + 采购文件字段解析 + 定时发布 + 发布通知）。

## 背景

v1 设计错误地把「公告制作与发布」当成单页表单——实际上它是两个步骤：① 先写公告文档（借用既有公告制作模板，从采购文件自动提取填写项）、② 再配置发布选项。本版纠正。

## 决策记录（用户已确认）

- **两步向导**：Step ① 公告制作（复用 `AnnouncementDialog` 编辑内核 + 从项目数据/采购文件 .docx 双路预填）→ Step ② 发布配置（范围/时间/通知/附件/采购文件）。
- **公告范围**：全部可见（`PUBLIC`）/ 部分供应商可见（`RESTRICTED`）。供应商来源 = 全部已入库已审批供应商（`GET /supplier?status=APPROVED`），搜索 + 多选。
- **发布时间**：立即发布（`status=PUBLISHED`）/ 定时发布（`status=SCHEDULED` + `metadata.scheduledPublishDate`，后端 `@Cron('0 * * * * *')` 每分钟到点设 PUBLISHED）。
- **发布后发送通知**：勾选后，按公告范围确定收件人（PUBLIC → 全体已审批供应商，RESTRICTED → 仅选中供应商），创建站内信群发；定时发布的等 cron 触发时补发通知。
- **不自动完成阶段**：发布后不调 `updateProjectStage`，阶段保持 IN_PROGRESS（与旧 spec 一致）。
- **开评标项目创建时机（关键修正）**：立项步骤已同步创建，此处**不再创建**。需要单独改立项流程（不在本期范围——但需确保本向导发布时不触发双重创建。验证：`AnnouncementService` 的 BID_NOTICE 发布逻辑是否会重复创建，如是则加判断跳过）。
- **复用策略**：给 `AnnouncementDialog` 加 `embedded?: boolean` 和 `mode?: 'project'` prop。嵌入模式下不渲染外层 `Modal`，渲染由向导接管。**不影响 `/tender-write` 既有行为**。
- **采购文件 .docx 字段提取**：后端 `POST /project-management/:id/parse-announcement-fields`，读 `TENDER_DOCUMENT` 阶段 .docx → mammoth 转文本 → AI 提取公告字段 → 返回 `Partial<AnnouncementDraft>`。前端在 Step 1 打开时调用，合并到 `applyAutoFill` 预填。

## §1 两步向导组件

新建 `apps/web/src/components/projects/announcement-publish-wizard.tsx`（**替代**旧的 `announcement-publish-modal.tsx`）。

```
Props: { isOpen, onClose, project: ProjectManagementItem, onPublished }
```

**外壳**：固定全屏（`fixed inset-0 z-[500]`），磨砂遮罩（同 `ExpertExtractModal`），ESC 关闭。

**步骤指示器**（顶部 header 下方）：
```
  ● 公告制作  ←→  ○ 发布配置
```
Step 1 完成（draft 非空）后 Step 2 才可进入。

**Step 1 内容**：嵌入 `AnnouncementDialog`（`embedded=true, mode='project'`），当 `isOpen` + project 已 load 时渲染。向导层负责：
1. `mapProcurementMethodToTenderType(project.procurementMethod)` → `tenderType` + `selectedMeta`。
2. `buildPrefillFromProject(project, tenderType)` → partial tenderDraft。
3. 调用 `parseAnnouncementFields(project.id)` → 从 .docx 额外提取字段值。
4. 构造 `ReadyTenderDraft` 传参。
5. 监听 `AnnouncementDialog` 回调（`onDraftChange` / `onExport`）保存当前 draft 状态。

**Step 2 内容**：发布配置表单：

| 配置 | UI |
|------|----|
| 公告范围 | ○ 全部可见 ○ 部分供应商。选"部分"展开多选面板（搜索框 + 全选 + 勾选列表 + 已选 N 人 Badge） |
| 发布时间 | ○ 立即发布 ○ 定时发布。选"定时"展开 `<input type="datetime-local">` |
| ☐ 上传附件 | 开启下方附件上传区（`AttachmentSection`，同旧组件） |
| ☐ 引用采购文件 | 开启→一键引用 `TENDER_DOCUMENT` 全部附件（`attachFromObject`） |
| ☐ 发布后发送通知 | checkbox |

**底部操作栏**：

| Step | 按钮 |
|------|------|
| Step 1 | 取消 / — / 导出 Word / 下一步 |
| Step 2 | 取消 / 上一步 / 保存草稿 / 发布 |

"发布" → 组装 AnnouncementDraft + 配置 → `createAnnouncement` / `updateAnnouncement` + 附件/通知 → `onPublished()` → 关窗。`is_top=false`，`publishDate=now` 或 `scheduledPublishDate`。

**状态管理**（向导层）：`step: 1|2`、`draft: AnnouncementDraft | null`、`category: AnnouncementCategory | null`、`docxBlob: Blob | null`、`visibility: 'PUBLIC'|'RESTRICTED'`、`restrictedSupplierIds: string[]`、`publishTiming: 'now'|'scheduled'`、`scheduledDate: string`、`attachOn: boolean`、`tenderOn: boolean`、`notifyOnPublish: boolean`。

## §2 AnnouncementDialog 嵌入化改造

改 `apps/web/src/components/tender-write/announcement-dialog.tsx`：

- Props 新增 `embedded?: boolean` 和 `mode?: 'standalone' | 'project'`。
- 当 `embedded && mode === 'project'` 时：
  - 不渲染 `Modal` 包装，只渲染 `<div className="flex-1 min-h-0 flex flex-col">`（由向导面板承载）。
  - `isOpen` prop 在嵌入模式可忽略（始终渲染内容）。
  - `onClose` 替换为 `onDraftChange?: (draft, category)` 回调——每次 draft 更新或 category 变化时通知向导层。
  - 不导出 docx（导出由向导层的 Step 1 footer 按钮触发）——传 `onExport?: () => void` 回调。
- 嵌入模式下显示 tenderDraft 预览（从 `tenderDraft` 构造），供用户比对采购文件原文与公告字段。
- 零影响：`embedded` 默认 `false`，`/tender-write` 调用不传，行为完全不变。

## §3 采购文件 .docx 解析接口

新增 `POST /api/project-management/:id/parse-announcement-fields`

- **入参**：无（项目 ID）。
- **逻辑**：
  1. 找到项目 `TENDER_DOCUMENT` 阶段附件中的 `.docx` 文件（取第一个）。
  2. `resolve(process.cwd(), 'uploads', attachment.objectKey)` 读文件。
  3. mammoth → 提取纯文本。
  4. 调用 `LlmService`（用公告字段提取 prompt，限定输出 JSON `Record<AnnouncementFieldKey, string>`，只含提取到的字段）。
  5. 返回 `Partial<AnnouncementDraft>` + `extractedText`（原文本供展示）。
- **错误处理**：无 .docx → 返回 `null`（不报错）；AI 不可用 → 返回空对象。
- **Controller** `ProjectManagementController`：`@Post(':id/parse-announcement-fields')`。
- **前端客户端** `parseAnnouncementFields(projectId)` 加到 `lib/api/announcement.ts`。

## §4 定时发布 cron

`AnnouncementService`（`apps/api/src/announcement/announcement.service.ts`）新增：

```ts
@Cron('0 * * * * *') // 每分钟
async publishScheduled() {
  const due = await this.prisma.announcement.findMany({
    where: { status: 'SCHEDULED' },
  });
  for (const a of due) {
    const meta = (a.metadata as any) || {};
    if (meta.scheduledPublishDate && new Date(meta.scheduledPublishDate) <= new Date()) {
      await this.prisma.announcement.update({
        where: { id: a.id },
        data: { status: 'PUBLISHED', publishDate: new Date() },
      });
      // 若勾选了通知，此时触发
      if (meta.notifyOnPublish) {
        await this.sendPublishNotification(a.id, meta);
      }
    }
  }
}
```

需要 `SchedulerModule` 注册 `ScheduleModule`。若尚未注册（`announcement.module.ts` 的 imports 已有或需加 `ScheduleModule.forRoot()`），确保 `@Cron` 生效。*注意：`ScheduleModule.forRoot()` 可能在 `AppModule` 已注册，只需在 `AnnouncementModule` 引入 `@nestjs/schedule` 的 `Cron` decorator 即可。*

## §5 发布通知

`AnnouncementService` 新增私有方法：
```ts
private async sendPublishNotification(announcementId: string, meta: Record<string, any>) {
  const announcement = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!announcement) return;
  const visibility = meta.visibility || 'PUBLIC';
  let supplierIds: string[] = [];
  if (visibility === 'PUBLIC') {
    const suppliers = await this.prisma.supplier.findMany({ where: { status: 'APPROVED' }, select: { id: true } });
    supplierIds = suppliers.map(s => s.id);
  } else {
    supplierIds = meta.restrictedSupplierIds || [];
  }
  // 创建通知记录（Notification 表）
  for (const sid of supplierIds) {
    await this.prisma.notification.create({
      data: {
        recipientId: sid,
        recipientType: 'SUPPLIER',
        title: `新采购公告：${announcement.title}`,
        content: `采购公告「${announcement.title}」已发布，请前往供应商门户查看详情。`,
        category: 'ANNOUNCEMENT',
        relatedId: announcementId,
      },
    });
  }
}
```

需要确认 `Notification` 模型结构是否匹配。如 `Notification` 模型字段不同则按实际调整。

## §6 检查项：发布时不重复创建开评标项目

`AnnouncementService` 或 `BidDocumentService` 的既有逻辑中，`BID_NOTICE` 发布时会自动创建 BidProject。入口需排查并加判断：若该公告已有 `relatedProjectCode`（且该 bid project 已存在），跳过创建。**实现时具体排查**。

## §7 影响面

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/projects/announcement-publish-wizard.tsx` | **新建**（替代 `announcement-publish-modal.tsx`） |
| `apps/web/src/components/projects/announcement-publish-modal.tsx` | **删除** |
| `apps/web/src/components/tender-write/announcement-dialog.tsx` | **改**（+embedded prop） |
| `apps/web/src/components/projects/project-detail-panel.tsx` | **改**（import 名改） |
| `apps/web/src/lib/api/announcement.ts` | **改**（+parseAnnouncementFields，保留 attachFromObject） |
| `apps/api/src/project-management/project-management.controller.ts` | **改**（+1 路由） |
| `apps/api/src/project-management/project-management.service.ts` | **改**（+1 解析方法） |
| `apps/api/src/announcement/announcement.service.ts` | **改**（+cron + 通知） |
| `apps/api/src/announcement/announcement.controller.ts` | 不改（上次的 attachFromObject 路由保留） |
| `apps/api/src/announcement/announcement-attachment.service.ts` | 不改（上次的 attachFromObject 方法保留） |

**零 Prisma 迁移、零 schema 改动。**

## 验收（视觉截图为准）

1. 项目管理→PUBLIC_ANNOUNCEMENT 阶段→「公告制作与发布」→弹窗出现（磨砂遮罩，ESC/点遮罩可关）。
2. Step 1 出现公告制作面板（有分类选择 + 结构化字段，字段从项目数据预填；若有 .docx 采购文件则额外提取字段填充）；可 AI 逐字段/批量生成；可预览。
3. 填写完毕后「下一步」→ Step 2 发布配置（范围/时间/通知/附件/采购文件）。
4. 「发布」→ toast → 关窗→阶段保持「进行中」。
5. 定时发布公告到期后 cron 自动上线 + 通知发送。
6. /notice 列表、3002 首页、供应商端可见。
