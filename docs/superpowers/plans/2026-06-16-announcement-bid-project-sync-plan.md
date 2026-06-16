# 公告发布 → 自动创建开评标项目 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BID_NOTICE 公告发布时自动创建 BidProject，公告删除时解除关联。

**Architecture:** AnnouncementService.update() 检测 status→PUBLISHED 时调用 BidService.createFromAnnouncement()；BidService 新增专用创建方法含字段映射与幂等检查；AnnouncementService.remove() 中解除关联但不级联删除。

**Tech Stack:** NestJS 11, Prisma, PostgreSQL, Next.js 16, React 19, Tailwind CSS v4

---

### Task 1: Prisma Schema — BidProject 新增字段

**Files:**
- Modify: `water-erp/apps/api/prisma/schema.prisma:87-112`
- Modify: `water-erp/apps/api/prisma/seed-data/BidProject.json`

- [ ] **Step 1: 在 BidProject 模型中新增 4 个可选字段**

在 `water-erp/apps/api/prisma/schema.prisma` 的 `BidProject` 模型中，在 `riskNote` 之后、`encryptionKeyId` 之前插入：

```prisma
model BidProject {
  id                  String                  @id @default(cuid())
  projectCode         String                  @unique
  name                String
  procurementMethod   String
  openTime            DateTime
  deadline            DateTime
  stage               BidStage                @default(DOWNLOAD)
  riskNote            String?
  budget              Decimal?                @db.Decimal(14, 2)   // ← 新增：预算金额
  scope               String?                 // ← 新增：采购内容/范围
  qualification       String?                 // ← 新增：投标人资格要求
  contact             String?                 // ← 新增：联系方式
  encryptionKeyId     String?
  // ... 其余字段不变
}
```

- [ ] **Step 2: 更新种子数据 JSON**

在 `water-erp/apps/api/prisma/seed-data/BidProject.json` 中，为每个项目补充 4 个新字段（值均为 `null`），以第一个项目为例：

```json
{
  "id": "cmqbysdhu000bkoh1u8ikgv08",
  "projectCode": "BID-2026-0518",
  "name": "2026年度水利工程物资集中采购",
  "procurementMethod": "公开招标",
  "openTime": "2026-06-08T01:30:00.000Z",
  "deadline": "2026-06-08T01:00:00.000Z",
  "stage": "OPENING",
  "riskNote": "解密窗口进行中",
  "budget": null,
  "scope": null,
  "qualification": null,
  "contact": null,
  "createdAt": "2026-06-13T06:18:29.587Z",
  "updatedAt": "2026-06-13T06:18:29.587Z"
}
```

其余 4 个项目同样追加 `"budget": null, "scope": null, "qualification": null, "contact": null`。

- [ ] **Step 3: 生成并应用 Prisma migration**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm db:generate
```

由于是 nullable 字段，`prisma migrate dev` 在非交互环境使用：

```bash
cd apps/api
npx prisma migrate dev --create-only --name add_bid_project_detail_fields
npx prisma db execute --file prisma/migrations/*_add_bid_project_detail_fields/migration.sql
npx prisma migrate resolve --applied add_bid_project_detail_fields
```

- [ ] **Step 4: 验证 migration 成功**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm db:seed
```

预期：Seed 完成，招标项目: 5（新字段全为 null，不报错）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/ apps/api/prisma/seed-data/BidProject.json
git commit -m "feat: BidProject 新增 budget/scope/qualification/contact 字段

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 后端 DTO 扩展

**Files:**
- Modify: `water-erp/apps/api/src/bid/dto/create-bid-project.dto.ts`
- Modify: `water-erp/apps/api/src/bid/dto/update-bid-project.dto.ts`

- [ ] **Step 1: 扩展 CreateBidProjectDto**

将 `water-erp/apps/api/src/bid/dto/create-bid-project.dto.ts` 替换为：

```ts
import { IsString, IsNotEmpty, IsDateString, IsOptional, IsNumber } from 'class-validator';

export class CreateBidProjectDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() procurementMethod: string;
  @IsDateString() openTime: string;
  @IsDateString() deadline: string;
  @IsString() @IsOptional() riskNote?: string;
  @IsNumber() @IsOptional() budget?: number;
  @IsString() @IsOptional() scope?: string;
  @IsString() @IsOptional() qualification?: string;
  @IsString() @IsOptional() contact?: string;
}
```

- [ ] **Step 2: 扩展 UpdateBidProjectDto**

将 `water-erp/apps/api/src/bid/dto/update-bid-project.dto.ts` 替换为：

```ts
import { IsString, IsOptional, IsNumber } from 'class-validator';

export class UpdateBidProjectDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() procurementMethod?: string;
  @IsString() @IsOptional() openTime?: string;
  @IsString() @IsOptional() deadline?: string;
  @IsString() @IsOptional() stage?: string;
  @IsString() @IsOptional() riskNote?: string;
  @IsNumber() @IsOptional() budget?: number;
  @IsString() @IsOptional() scope?: string;
  @IsString() @IsOptional() qualification?: string;
  @IsString() @IsOptional() contact?: string;
}
```

- [ ] **Step 3: 验证编译通过**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm --filter api build
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bid/dto/create-bid-project.dto.ts apps/api/src/bid/dto/update-bid-project.dto.ts
git commit -m "feat: CreateBidProjectDto / UpdateBidProjectDto 新增 budget/scope/qualification/contact 可选字段

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: BidService — 新增 createFromAnnouncement 和 syncFromAnnouncement

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.service.ts`

- [ ] **Step 1: 新增 createFromAnnouncement 方法**

在 `BidService` 类中（`createProject` 方法之后，约 line 174），新增方法：

```ts
/**
 * 从公告发布联动创建 BidProject。
 * 幂等：若 relatedProjectCode 已存在有效项目则跳过。
 */
async createFromAnnouncement(
  announcement: { id: string; title: string; publishDate: Date | null },
  metadata: Record<string, any>,
) {
  const projectCode = `BID-${Date.now()}`;
  const openTime = metadata.openTime
    ? new Date(metadata.openTime)
    : (announcement.publishDate || new Date());
  const deadline = metadata.deadline
    ? new Date(metadata.deadline)
    : new Date(openTime.getTime() + 7 * 86400000);

  const project = await this.prisma.bidProject.create({
    data: {
      name: announcement.title,
      projectCode,
      procurementMethod: metadata.method || '公开招标',
      openTime,
      deadline,
      riskNote: '（来自公告自动创建）',
      budget: metadata.budget ? Number(metadata.budget) : null,
      scope: metadata.scope || null,
      qualification: metadata.qualification || null,
      contact: metadata.contact || null,
      stage: 'DOWNLOAD',
    },
  });

  this.logger.log(
    `公告联动创建项目: ${project.projectCode} (announcementId=${announcement.id})`,
  );

  return project;
}

/**
 * 已发布公告再次编辑时，同步更新 BidProject 的可编辑字段。
 * 不改变 projectCode 和 stage。
 */
async syncFromAnnouncement(
  projectId: string,
  announcement: { title: string },
  metadata: Record<string, any>,
) {
  const openTime = metadata.openTime ? new Date(metadata.openTime) : undefined;
  const deadline = metadata.deadline ? new Date(metadata.deadline) : undefined;

  const updated = await this.prisma.bidProject.update({
    where: { id: projectId },
    data: {
      name: announcement.title,
      procurementMethod: metadata.method || '公开招标',
      ...(openTime && { openTime }),
      ...(deadline && { deadline }),
      budget: metadata.budget ? Number(metadata.budget) : null,
      scope: metadata.scope || null,
      qualification: metadata.qualification || null,
      contact: metadata.contact || null,
    },
  });

  this.logger.log(`公告同步更新项目: ${updated.projectCode} (projectId=${projectId})`);
  return updated;
}
```

- [ ] **Step 2: 扩展 updateProject 方法支持全部字段**

在 `updateProject` 方法（line 176-193）中，将 data 部分扩展为：

```ts
async updateProject(id: string, dto: UpdateBidProjectDto) {
  if (dto.stage) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    assertBidStageTransition(project.stage, dto.stage as BidStage);
  }

  return this.prisma.bidProject.update({
    where: { id },
    data: {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.procurementMethod !== undefined && { procurementMethod: dto.procurementMethod }),
      ...(dto.openTime !== undefined && { openTime: new Date(dto.openTime) }),
      ...(dto.deadline !== undefined && { deadline: new Date(dto.deadline) }),
      ...(dto.stage && { stage: dto.stage as any }),
      ...(dto.riskNote !== undefined && { riskNote: dto.riskNote }),
      ...(dto.budget !== undefined && { budget: dto.budget }),
      ...(dto.scope !== undefined && { scope: dto.scope }),
      ...(dto.qualification !== undefined && { qualification: dto.qualification }),
      ...(dto.contact !== undefined && { contact: dto.contact }),
    },
  });
}
```

- [ ] **Step 3: 验证编译通过**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm --filter api build
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bid/bid.service.ts
git commit -m "feat: BidService 新增 createFromAnnouncement / syncFromAnnouncement 方法

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: BidModule 导出 BidService + AnnouncementModule 导入

**Files:**
- Modify: `water-erp/apps/api/src/bid/bid.module.ts`
- Modify: `water-erp/apps/api/src/announcement/announcement.module.ts`

- [ ] **Step 1: BidModule 导出 BidService**

在 `water-erp/apps/api/src/bid/bid.module.ts`，exports 数组中增加 `BidService`：

```ts
@Module({
  imports: [AuthModule, PrismaModule, NotificationModule],
  controllers: [BidController],
  providers: [BidService, BidGateway],
  exports: [BidGateway, BidService],  // ← 新增 BidService
})
export class BidModule {}
```

- [ ] **Step 2: AnnouncementModule 导入 BidModule**

在 `water-erp/apps/api/src/announcement/announcement.module.ts`，imports 中增加 `BidModule`：

```ts
import { BidModule } from '../bid/bid.module';

@Module({
  imports: [AuthModule, PrismaModule, BidModule],  // ← 新增 BidModule
  controllers: [AnnouncementController],
  providers: [AnnouncementService, AnnouncementAiService, BidDocumentService, AnnouncementAttachmentService],
  exports: [AnnouncementService, BidDocumentService, AnnouncementAttachmentService],
})
export class AnnouncementModule {}
```

- [ ] **Step 3: 验证无循环依赖，编译通过**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm --filter api build
```

预期：编译成功。AnnouncementModule → BidModule → Auth/Prisma/Notification，无环。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bid/bid.module.ts apps/api/src/announcement/announcement.module.ts
git commit -m "feat: BidModule 导出 BidService，AnnouncementModule 导入 BidModule

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: AnnouncementService — 发布联动 + 删除解绑

**Files:**
- Modify: `water-erp/apps/api/src/announcement/announcement.service.ts`

- [ ] **Step 1: 在 AnnouncementService 构造函数注入 BidService**

```ts
import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { BidService } from '../bid/bid.service';  // ← 新增 import

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private prisma: PrismaService,
    private announcementAi: AnnouncementAiService,
    @Optional() private bidService?: BidService,  // ← 新增注入
  ) {}
  // ...
}
```

使用 `@Optional()` 避免 BidService 不可用时（虽然理论上不会）导致 AnnouncementService 整个崩溃。

- [ ] **Step 2: 在 update 方法中插入发布联动逻辑**

在 `update` 方法中 `return this.prisma.announcement.update(...)` **之前**插入联动逻辑。完整 update 方法变为：

```ts
async update(id: string, dto: UpdateAnnouncementDto) {
  const announcement = await this.prisma.announcement.findUnique({ where: { id } });
  if (!announcement) throw new BadRequestException({ error: '公告不存在', code: 'NOT_FOUND' });

  const title = dto.title ?? announcement.title;
  const type = dto.type ?? announcement.type;
  const content = dto.content ?? announcement.content;
  const shouldRegenerateSummary = dto.aiSummary === undefined && (
    dto.title !== undefined || dto.content !== undefined || dto.type !== undefined
  );
  const aiSummary = dto.aiSummary ?? (shouldRegenerateSummary
    ? await this.announcementAi.summarize({ title, type, content })
    : undefined);

  const targetStatus = dto.status ?? announcement.status;
  const isPublishTransition =
    announcement.type === 'BID_NOTICE' &&
    announcement.status !== 'PUBLISHED' &&
    targetStatus === 'PUBLISHED';

  const result = await this.prisma.announcement.update({
    where: { id },
    data: {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.content !== undefined && { content: dto.content }),
      ...(dto.type !== undefined && { type: dto.type as any }),
      ...(dto.summary !== undefined && { summary: dto.summary }),
      ...(aiSummary !== undefined && { aiSummary }),
      ...(dto.status !== undefined && { status: dto.status as any }),
      ...(dto.publishDate !== undefined && { publishDate: new Date(dto.publishDate) }),
      ...(dto.isTop !== undefined && { isTop: dto.isTop }),
      ...(dto.relatedProjectCode !== undefined && { relatedProjectCode: dto.relatedProjectCode }),
      ...(dto.metadata !== undefined && { metadata: dto.metadata as any }),
    },
  });

  // ── 联动：BID_NOTICE 首次发布 → 创建 BidProject ──
  if (isPublishTransition && this.bidService) {
    try {
      const meta = (announcement.metadata || {}) as Record<string, any>;
      // 幂等检查：relatedProjectCode 是否已关联有效项目
      let existingProject = null;
      if (announcement.relatedProjectCode) {
        existingProject = await this.prisma.bidProject.findUnique({
          where: { projectCode: announcement.relatedProjectCode },
        });
      }

      if (existingProject) {
        // 已存在 → 同步更新
        await this.bidService.syncFromAnnouncement(
          existingProject.id,
          { title: result.title },
          meta,
        );
        this.logger.log(
          `公告已关联项目 ${existingProject.projectCode}，同步更新字段`,
        );
      } else {
        // 不存在 → 创建
        const project = await this.bidService.createFromAnnouncement(
          { id: result.id, title: result.title, publishDate: result.publishDate },
          meta,
        );
        // 回写 relatedProjectCode
        await this.prisma.announcement.update({
          where: { id },
          data: { relatedProjectCode: project.projectCode },
        });
        // 挂载招标文件
        const bidDoc = await this.prisma.bidDocument.findUnique({
          where: { announcementId: id },
        });
        if (bidDoc) {
          await this.prisma.bidDocument.update({
            where: { announcementId: id },
            data: { bidProjectId: project.id },
          });
        }
        this.logger.log(
          `公告首次发布，自动创建项目 ${project.projectCode}`,
        );
      }
    } catch (e) {
      // 联动失败不阻塞发布，记录日志供排查
      this.logger.error(
        `公告发布联动创建项目失败 (announcementId=${id}): ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }

  return result;
}
```

- [ ] **Step 3: 在 remove 方法中插入解绑逻辑**

```ts
async remove(id: string) {
  const announcement = await this.prisma.announcement.findUnique({
    where: { id },
    select: { type: true, relatedProjectCode: true, status: true },
  });

  // 删除前解除关联：BID_NOTICE 已发布且有相关项目
  if (
    announcement &&
    announcement.type === 'BID_NOTICE' &&
    announcement.status === 'PUBLISHED' &&
    announcement.relatedProjectCode
  ) {
    try {
      const project = await this.prisma.bidProject.findUnique({
        where: { projectCode: announcement.relatedProjectCode },
      });
      if (project) {
        // 标记项目来源已删除
        await this.prisma.bidProject.update({
          where: { projectCode: announcement.relatedProjectCode },
          data: {
            riskNote: (project.riskNote || '') + '（来源公告已删除）',
          },
        });
        // 解除招标文件挂载
        await this.prisma.bidDocument.updateMany({
          where: { announcementId: id },
          data: { bidProjectId: null },
        });
        this.logger.log(
          `公告删除，解除项目 ${announcement.relatedProjectCode} 关联`,
        );
      }
    } catch (e) {
      this.logger.error(
        `公告删除解除关联失败 (announcementId=${id}): ${(e as Error).message}`,
      );
    }
  }

  return this.prisma.announcement.delete({ where: { id } });
}
```

- [ ] **Step 4: 验证编译通过**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm --filter api build
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/announcement/announcement.service.ts
git commit -m "feat: AnnouncementService 发布联动创建 BidProject + 删除解绑

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 共享类型扩展 — packages/shared BidProject 类型

**Files:**
- Modify: `water-erp/packages/shared/src/types.ts`

- [ ] **Step 1: 扩展 BidProject 接口**

在 `water-erp/packages/shared/src/types.ts` line 27-37，新增 4 个可选字段：

```ts
export interface BidProject {
  id: string;
  projectCode: string;
  name: string;
  procurementMethod: string;
  openTime: string;
  deadline: string;
  stage: string;
  riskNote?: string;
  budget?: number;        // ← 新增
  scope?: string;         // ← 新增
  qualification?: string; // ← 新增
  contact?: string;       // ← 新增
  _count?: { suppliers: number };
}
```

- [ ] **Step 2: 编译 shared 包**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm --filter @water-erp/shared build
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: BidProject 类型新增 budget/scope/qualification/contact 可选字段

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: bid-portal — 项目表格新增"来源"列 + 按钮调整

**Files:**
- Modify: `water-erp/apps/bid-portal/src/app/(dashboard)/bid/page.tsx`

- [ ] **Step 1: 将"创建项目"按钮移入 DataToolbar，文案改为次要样式**

在 `page.tsx`：
- 从 `PageHero` 的 `actions` 中移除按钮（line 93-101）
- 在 `<DataToolbar>` 内搜索框和阶段下拉之后，添加按钮：

```tsx
<DataToolbar>
  <div className="relative flex-1 min-w-[200px]">
    {/* 搜索框保持不变 */}
  </div>
  <select ...>
    {/* 阶段下拉保持不变 */}
  </select>
  {/* 新增：手动创建按钮（次要位置） */}
  <button
    onClick={() => setShowCreate(true)}
    className="flex items-center gap-1.5 rounded-xl border border-[#dce6f3] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] hover:text-[#18243a] transition"
  >
    <Plus size={12} strokeWidth={1.5} />
    手动创建
  </button>
</DataToolbar>
```

同时更新 `PageHero` 的 `actions` prop 移除：

```tsx
<PageHero
  eyebrow="开评标管理"
  tone="blue"
  icon={<Gavel size={14} strokeWidth={1.5} />}
  title="开评标管理系统"
  description="统一入口 · 多端协同 · 限时开标 · 全程留痕"
  // actions 不再包含创建按钮
/>
```

- [ ] **Step 2: 表格新增"来源"列**

在 table header 中"项目名称"和"采购方式"之间插入：

```tsx
<th className="px-5 py-3 text-left text-xs font-semibold text-[#5a6d8a]">来源</th>
```

在每个 table row 中对应位置插入：

```tsx
<td className="px-5 py-3">
  {p.riskNote?.includes('来自公告自动创建') ? (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold text-[#11a874] bg-[#11a87418]">
      来自公告
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold text-[#5a6d8a] bg-[#5a6d8a18]">
      手动创建
    </span>
  )}
</td>
```

- [ ] **Step 3: 验证 bid-portal 编译通过**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm --filter bid-portal build
```

- [ ] **Step 4: Commit**

```bash
git add apps/bid-portal/src/app/\(dashboard\)/bid/page.tsx
git commit -m "feat: bid-portal 项目表格新增来源列，手动创建按钮移至工具栏

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: web notice 页面 — 发布/删除提示文案调整

**Files:**
- Modify: `water-erp/apps/web/src/app/(dashboard)/notice/page.tsx`

- [ ] **Step 1: 发布成功 toast 追加提示**

在 `publish` 函数（约 line 279-282）中，发布成功后追加提示：

```ts
const publish = async () => {
  if (type === 'BID_NOTICE' && !bidDoc) { if (!confirm('该招标公示尚未上传招标文件，确认直接发布？')) return; }
  const id = await save('PUBLISHED');
  if (id) {
    if (type === 'BID_NOTICE') {
      toast.success('已发布，开评标项目已同步创建');
    } else {
      toast.success('已发布');
    }
    onSaved();
  }
};
```

- [ ] **Step 2: 删除确认追加提示**

在 `remove` 函数（约 line 73-88）中，BID_NOTICE 类型的删除确认追加说明：

```ts
const remove = async (a: AnnouncementListItem) => {
  const msg = a.type === 'BID_NOTICE' && a.status === 'PUBLISHED'
    ? '确认删除「' + a.title + '」？删除公告不会删除关联的开评标项目。'
    : '确认删除「' + a.title + '」？';
  if (!confirm(msg)) return;
  // ... 其余逻辑不变
};
```

- [ ] **Step 3: 验证 web 编译通过**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm --filter web build
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/notice/page.tsx
git commit -m "feat: notice 页面发布/删除提示文案联动说明

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 端到端验证

- [ ] **Step 1: 启动基础设施和所有服务**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm infra:up
# 等待 PostgreSQL / Redis / MinIO 就绪
pnpm db:seed
```

```bash
# 另开终端
pnpm dev:api
pnpm dev:web
pnpm dev:bid
```

- [ ] **Step 2: 验证公告发布 → 自动创建项目**

1. 浏览器访问 `http://localhost:3005/notice`
2. 登录 `caigou / caigou@2026`
3. 点击「新建信息」→ 类型选「招标公示」
4. 在结构化信息中填写：
   - 项目编号：`TEST-001`
   - 招标方式：`竞争性谈判`
   - 预算金额：`500000`
   - 开标时间：选择一个未来时间
   - 报名/投标截止：选择开标时间之后的时间
   - 其余字段随意填写
5. 填写标题和正文 → 先点「保存草稿」
6. 上传招标文件（可选）→ 点「发布」
7. 预期：toast 显示"已发布，开评标项目已同步创建"
8. 访问 `http://localhost:3007/bid`，登录 `lizhuren / lizhuren@2026`
9. 预期：项目列表中出现新创建的项目，「来源」列显示"来自公告"，projectCode 为 `BID-{timestamp}` 格式

- [ ] **Step 3: 验证公告编辑 → 同步更新**

1. 在 notice 页面编辑刚发布的公告
2. 修改招标方式为「询价」→ 保存
3. 回到 bid-portal 刷新
4. 预期：对应项目的采购方式已更新为「询价」

- [ ] **Step 4: 验证公告删除 → 解绑**

1. 删除刚创建的公告
2. 预期：bid-portal 项目列表仍保留该项目，riskNote 追加"（来源公告已删除）"

- [ ] **Step 5: 验证专家抽取下拉框可见**

1. 访问 `http://localhost:3005/expert/extract`
2. 预期：项目下拉框中出现新创建的项目（来自公告的）

- [ ] **Step 6: 验证手动创建不受影响**

1. 在 bid-portal 点击「手动创建」按钮
2. 填写表单 → 确认创建
3. 预期：项目列表出现手动创建的项目，「来源」列为"手动创建"

- [ ] **Step 7: 验证幂等**

1. 同一个公告多次点击发布（正常流程不会，但可通过 API 测试）
2. 预期：不会创建重复项目

---

### Task 10: 运行现有测试确保无回归

- [ ] **Step 1: 运行 API 单元测试**

```bash
cd "D:/claude projects/ERP-main/water-erp"
pnpm --filter api test
```

预期：所有已有测试通过。

- [ ] **Step 2: 运行 API E2E 测试**

```bash
pnpm --filter api test:e2e
```

预期：E2E 测试通过（种子数据含 BidProject，新增 nullable 字段不影响已有断言）。

- [ ] **Step 3: 修复任何失败的测试**

如有测试因 DTO 字段变更或 service 签名变更而失败，修复后重新运行。

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test: 端到端验证通过 — 公告发布联动创建开评标项目

Co-Authored-By: Claude <noreply@anthropic.com>"
```
