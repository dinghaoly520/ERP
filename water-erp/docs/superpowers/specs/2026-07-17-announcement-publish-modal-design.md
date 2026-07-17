# 项目管理 · 采购公告公示「公告制作与发布」弹窗

**日期**: 2026-07-17
**范围**: `apps/web` (:3005) 项目管理（`/projects`）详情面板中，阶段 `PUBLIC_ANNOUNCEMENT`（采购公告公示）的「公告制作与发布」快捷操作。新增一个弹窗组件 + 一个后端「挂载已有对象」接口。
**Phase**: 单次交付（前端弹窗 + 后端小接口）。

## 背景与问题

项目管理详情面板的阶段时间线（`project-stage-timeline.tsx`）为 `PUBLIC_ANNOUNCEMENT` 阶段渲染了「公告制作与发布」快捷按钮（`STAGE_ACTION_LABELS.PUBLIC_ANNOUNCEMENT`），点击触发 `onStageAction('PUBLIC_ANNOUNCEMENT')`。但 `project-detail-panel.tsx:793` 的 `onStageAction` 处理器目前**只**分支处理 `TENDER_DOCUMENT`（采购文件编写）与 `EXPERT_SELECTION`（专家抽取）——`PUBLIC_ANNOUNCEMENT` 点击后**无任何反应**。

需要：点击该按钮弹出窗口，让用户编写采购公告发布内容，并可**直接调用前面步骤已得到的项目数据**（项目名称、预算金额、采购方式、范围、资格要求、开标时间等）自动预填。表单设计参考信息发布中心的新建公告（`/notice/new`），但聚焦「采购公告（招标公示 / `BID_NOTICE`）」一种类型。

## 决策记录（用户已确认）

- **公告类型锁定 `BID_NOTICE`** —— 弹窗是专注的采购公告制作器，无类型下拉；只展示 BID_NOTICE 的结构化元数据字段，从当前项目预填、可编辑。
- **采购文件 = 直接引用本项目 `TENDER_DOCUMENT` 步骤已有的采购文件**，不重新上传。
- **邀请供应商不在本期范围** —— 弹窗只负责公告发布，不处理供应商邀请（独立工作项，后续再做）。
- **发布后不自动完成阶段** —— `PUBLIC_ANNOUNCEMENT` 阶段保持「进行中」，仍由用户在阶段卡片手动完成（既有 `完成阶段` 流程）。
- **发布即可见** —— 公告 `status=PUBLISHED` 后，3002 信息门户首页、:3005 信息发布中心（`/notice`）、:3004 供应商端均可查看。此为现有公告系统既有行为，**无需额外可见性工作**。
- **采购文件引用走后端新接口（路径①）** —— 项目采购文件存于**本地磁盘**（`uploads/<objectKey>`，`persist_uploaded_file` 写入），而公告 `FileAsset` 指向 **MinIO**——两者是不同存储后端，无法共享同一对象。新接口由后端读取项目本地文件、复制一份到 MinIO，再建 `FileAsset` + `AnnouncementAttachment`。用户**无需手动重新上传**（无前端字节搬运）；后端在服务端复制一次。会产生一个新的 MinIO 对象（与项目本地文件独立，删除公告附件不会影响项目原文件）。
- **`FileAsset.sha256` 必填处理** —— 后端读取本地 buffer 后 `createHash('sha256')` 计算（与 `UploadService.computeSha256` 同口径）；**不改 schema、不改可空**。
- **保留「发布 `BID_NOTICE` 自动创建开评标项目」既有行为** —— 与 `/notice/new` 一致。

## §1 架构与接线

- **新组件** `apps/web/src/components/projects/announcement-publish-modal.tsx`，自绘外壳，沿用项目阶段大弹窗约定（同 `ExpertExtractModal` / `TenderWriteModal`）：
  - 根容器 `<div className="fixed inset-0 z-[500] flex flex-col">`；遮罩 `background: oklch(0.975 0.012 258 / 0.72)` + `backdropFilter: blur(5px)`，点击关闭；ESC 关闭；右上角 `neu-btn-soft !p-2` 关闭按钮。
  - `if (!isOpen) return null;`，`isOpen` 变化时挂/卸 ESC 监听（同 `ExpertExtractModal`）。
- **接线** `apps/web/src/components/projects/project-detail-panel.tsx`：
  - `onStageAction` 处理器（`:793`）追加 `else if (stageKey === 'PUBLIC_ANNOUNCEMENT') setAnnouncementPublishOpen(true);`。
  - 新增 state `const [announcementPublishOpen, setAnnouncementPublishOpen] = useState(false);`。
  - 面板底部（与 `TenderWriteModal` / `ExpertExtractModal` 同区，`:1421` 附近）条件渲染：
    ```tsx
    <AnnouncementPublishModal
      isOpen={announcementPublishOpen}
      onClose={() => setAnnouncementPublishOpen(false)}
      project={item}
      onPublished={onUpdated}
    />
    ```
- 发布成功后调用 `onUpdated()` 刷新项目数据；**不**调用 `updateProjectStage` 改阶段状态。

## §2 弹窗内容（锁定 `BID_NOTICE`）

复用 `/notice/new` 的字段结构与 `TYPE_META.BID_NOTICE`，去掉类型选择器：

1. **标题**（必填）—— 预填 `关于{item.title}的采购公告`，可编辑。
2. **发布日期** —— 预填今天（`new Date().toISOString().slice(0,10)`），可改。
3. **结构化元数据**（BID_NOTICE 8 字段，逐项从项目预填、可编辑）：

   | 元数据字段 | 预填来源 |
   |------------|----------|
   | 项目编号 `projectCode` | `item.departmentNumber \|\| item.contractNumber \|\| ''` |
   | 招标方式 `method` | `item.procurementMethod` |
   | 预算金额 `budget` | `item.budgetAmount`（格式化为带千分位的金额串） |
   | 采购内容/范围 `scope` | `item.procurementCategory`（+ `item.projectOverview`） |
   | 投标人资格要求 `qualification` | `item.supplierRequirements` |
   | 报名/投标截止 `deadline` | 空（用户填，`datetime-local`） |
   | 开标时间 `openTime` | `item.bidOpeningTime`（`datetime-local`） |
   | 联系方式 `contact` | `${item.requesterName}（${item.requesterDepartment}）` |

4. **正文** `RichTextEditor`（`@/components/rich-text-editor`，与 `/notice/new` 同款）—— 预填一段简单 HTML 模板（项目名/预算/方式/范围/截止/开标/联系方式），可编辑。
5. **摘要**（可选，单行 input）。
6. **两个开关**（顶部 checkbox，控制下方分区显隐）：
   - ☐ **添加附件** —— 开启后显示附件上传区（复用 `/notice/new` 的 `AttachmentUploader` 逻辑：标题 + 上传，走 `uploadFile` → `addAttachment`）。
   - ☐ **添加采购文件** —— 开启后显示「引用本项目采购文件」。**仅当项目 `TENDER_DOCUMENT` 步骤存在且 `attachments` 非空时可用**；否则禁用并提示「本项目暂无采购文件可引用」（`直接采购` 无 `TENDER_DOCUMENT` 步骤，自然禁用）。开启即把该项目阶段的第一份（或多份）采购文件挂到公告。
7. **底部操作栏**：取消（关窗）/ 保存草稿 / 发布。ID 状态文案沿用 `/notice/new`（未保存 / `ID: xxxxxxxx`）。

## §3 数据流（沿用 `/notice/new` 的「先草稿后附件」）

公告附件接口（`addAttachment`、新的 `attachFromObject`）都需要 `announcementId`，因此沿用 `/notice/new` 的两步式：

1. **首次「保存草稿」** → `createAnnouncement({ title, content, type:'BID_NOTICE', summary, status:'DRAFT', isTop, publishDate, metadata, relatedProjectCode })` → 拿到 `annId`。
   - `relatedProjectCode = metadata.projectCode || null`（与 `/notice/new:76` 一致）。
2. **有 `annId` 后**，附件区与采购文件引用区激活：
   - 附件：`uploadFile` → `addAttachment(annId, fileAssetId, title)`。
   - 采购文件：对项目 `TENDER_DOCUMENT` 阶段每份待引用文件调用新接口 `attachFromObject(annId, { objectKey, fileName, title })`。
   - 二次「保存草稿」改为 `updateAnnouncement(annId, {...})`。
3. **「发布」** → `updateAnnouncement(annId, { ...latestFields, status:'PUBLISHED' })`（若 `annId` 还不存在则直接 `createAnnouncement({...status:'PUBLISHED'})`）→ toast「已发布，开评标项目已同步创建」→ `onPublished()` 刷新项目 → 关窗。

> 提示条（`!annId` 时）同 `/notice/new:112`：「先填写基本信息并『保存草稿』后，才能上传附件与引用采购文件；全部配齐后再『发布』。」

## §4 后端改动（仅采购文件引用需要）

### 4.1 新接口 `POST /announcements/:id/attachments/from-object`

- **Controller** `apps/api/src/announcement/announcement.controller.ts`：新增 `@Post(':id/attachments/from-object')`，内联 body 类型 `{ objectKey: string; fileName?: string; title?: string; mimeType?: string; size?: number }`（与既有 `addAttachment` 一致的 inline-body 风格），`@Roles('admin','bid_host','procurement_staff','leader','staff')`，`@CurrentUser() user` 取 `user?.sub` 作 `uploaderId`。需新增 import：`CurrentUser`（`../auth/current-user.decorator`）、`AuthenticatedUser`（`../auth/auth.types`）。
- **Service** `apps/api/src/announcement/announcement-attachment.service.ts` 新增 `attachFromObject(announcementId, dto, userId?)`：
  1. 校验公告存在（同 `add`）。
  2. 读取本地文件 `resolve(process.cwd(), 'uploads', dto.objectKey)`；不存在抛 `NotFoundException({ error:'源文件不存在', code:'SOURCE_NOT_FOUND' })`。
  3. `createHash('sha256').update(buffer).digest('hex')` 算摘要；生成 MinIO key `uploads/{yyyy-mm-dd}/{uuid}.{ext}`（与 `UploadService.generateKey` 同口径）。
  4. `minioClient.putObject(MINIO_BUCKET, key, buffer, buffer.length, { 'Content-Type': mimeType })`。
  5. `prisma.fileAsset.create({ data: { key, originalName, mimeType, size, sha256, category:'announcement', uploaderId: userId } })`。
  6. `prisma.announcementAttachment.create({ data: { announcementId, fileAssetId, title }, include: { fileAsset: {...} } })`，返回结构与 `add` 一致。
- 需新增 import（service）：`resolve, basename`（`node:path`）、`readFile, access`（`node:fs/promises`）、`createHash, randomUUID`（`node:crypto`）。`minioClient, MINIO_BUCKET` 已在文件内导入。

### 4.2 文件大小与内存

`persist_uploaded_file` 用 memoryStorage（整文件入内存 buffer），`UploadService.computeSha256` 也基于 buffer；`attachFromObject` 同样 `readFile` 整文件入内存，与既有口径一致。采购文件体积在既有 500MB multer 上限内，沿用 buffer 模式可接受。

### 4.3 前端 API 客户端

`apps/web/src/lib/api/announcement.ts` 新增：
```ts
export function attachFromObject(announcementId: string, data: { objectKey: string; fileName?: string; title?: string; mimeType?: string; size?: number }) {
  return api.post<AnnouncementAttachment>(`/announcements/${announcementId}/attachments/from-object`, data);
}
```

## §5 边界与一致性

- **项目无编号** —— `projectCode` 留空、`relatedProjectCode=null`（与 `/notice/new` 一致，不报错）。
- **`直接采购`（无 `TENDER_DOCUMENT` 阶段）** —— 采购文件开关禁用 + 提示；附件开关仍可用。
- **`TENDER_DOCUMENT` 有多份文件** —— 一键引用该阶段的**全部附件**（不限扩展名，不做逐份勾选；与 `project-detail-panel.tsx:352` 的 `tenderDocxFiles` 不同——那是 `.docx` 修改按钮的口径，此处取全部，因公告采购文件可能是 PDF/docx）。
- **遮罩点击/ESC 误关导致草稿丢失** —— 仅在「有未保存改动」时 `confirm`，否则直接关（与现有弹窗轻量体验一致）。
- **视觉** —— 走 `neu-btn-primary / neu-btn-soft / neu-btn-xs`、`wb-section-rule`、`RichTextEditor`，与 `/notice/new` 完全同款；遵循项目 `neumorphic-design` skill。无新硬编码色。
- **无 mock 数据** —— 全量真实 API；加载/失败/空走真实 toast。

## 影响面

- **新增（web）**：`apps/web/src/components/projects/announcement-publish-modal.tsx`。
- **改动（web）**：
  - `apps/web/src/components/projects/project-detail-panel.tsx`（接线 + 渲染，约 +10 行）。
  - `apps/web/src/lib/api/announcement.ts`（+1 客户端方法）。
- **改动（api）**：
  - `apps/api/src/announcement/announcement.controller.ts`（+1 路由）。
  - `apps/api/src/announcement/announcement-attachment.service.ts`（+1 方法 + sha256 流式计算）。
  - 视需要 +1 DTO 文件或内联 DTO。
- **零 Prisma 迁移、零 schema 改动**。
- **零影响**：`/notice/new`、`/notice`、信息门户/供应商端展示逻辑（均为既有读取已发布公告）。

## 验收（视觉以截图为准）

1. 项目管理详情面板，`PUBLIC_ANNOUNCEMENT` 阶段卡片「公告制作与发布」可点击，弹出弹窗（磨砂遮罩 + ESC/点遮罩可关）。
2. 弹窗锁定采购公告；标题、8 个元数据字段、正文均**按项目数据预填**且可编辑。
3. 「添加附件」开关开启后可上传附件；「添加采购文件」开关在项目有 `TENDER_DOCUMENT` 文件时可勾选并成功引用（不重新上传），在 `直接采购` 项目下禁用。
4. 「保存草稿」生成草稿公告（`/notice` 列表可见 DRAFT）；「发布」后公告 `PUBLISHED`，3002 / :3005 `/notice` / :3004 均可见。
5. 发布后**阶段仍为「进行中」**（不自动完成），需用户手动完成。
6. 引用的采购文件在公告详情可下载；用户全程无需手动重新上传（后端在服务端从项目本地文件复制到 MinIO）。
