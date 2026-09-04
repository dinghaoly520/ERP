# P1 波4（全量收口批）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地审计报告 §P1 剩余全部 7 项：A-129（委员会区域/等级）、A-132（评委分工）、A-151（报告章节附注编辑）、A-152（评委平台自签 SM2 电子签名，专家不购 CA 走软证书）、A-87（投标页招标文件要点清单）、A-89（新轨标书 PDF 版式强制）、A-105（保证金逐家退还+定标联动）——完成后 ★ 层（一星）与 ★★ 层（二星）P1 缺口全部闭合；附带波3 终审缓修四小项。

**Architecture:** 一次 schema 迁移承载全部数据面（ExpertProfile 区域/等级、BidExpert 分工+电子签名证据、BidProject 报告附注、BidSupplier 逐家退还、新 ExpertCert 模型）。A-152 复用供应商侧四签范式（canonical → MockUKeyAdapter 软证书 sign → SignatureService 验签 → Json 归档）落到专家门户报告步骤，闭环判定抽出共享 util 双路复用（专家自签与主持登记同闸）。A-87 复用 ai-bid-analysis 既有 TENDER_PROCESSING 提取（发布即入队 + 供应商只读端点）。A-89 以「平台强制 PDF 版式（拒 Office 原生格式）」落地，锚点天然为 PDF 哈希（`docs/cts-ebs01-remediation-plan.md:73` 既有口径：PDF 满足版式文件，OFD 才需商业组件）。A-105 整体移植波3 已成稿设计（锚点已复核至当前行号）。

**Tech Stack:** NestJS 11 + Prisma（手写迁移三步）/ @water-erp/ukey（sm-crypto 软证书、canonicalJson、sha256Hex）/ packages/shared / Next.js 16（:3005 web、:3006 expert-portal exp-*、:3007 bid-portal cgzxui、:3004 supplier-portal sp-*）。

**Spec:** 无独立 spec——设计即审计报告 §P1 表对应行（`docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md` §五）+ 本计划内嵌决策（含用户 2026-09-02 两项裁定：供应商将来购真 CA、专家为企业内部人员走平台自签软证书不购 CA；A-152 手写签字扫描**保留但降级**为可选补充，闭环判定改电子签名）。冲突时以审计报告补齐思路列 + 用户裁定为准。

**范围外（本计划一概不碰）：** A-130 外部专家库接口（归公共服务平台对接专项）；P2 项；远程异地评标 A-154~157（★★★ 专项基建）。

## Global Constraints

- **schema.prisma 高危共享**（并行会话约定）：开工前 `git status` 确认 tracked 干净；全部 schema 改动集中在 Task 1 一次提交，提交前必须 `cd apps/api && npx prisma validate`；迁移非交互三步（`migrate dev --create-only` → 若因存量刻意偏离触发 reset 提示则**手写同构 SQL** → `prisma db execute --file` → `migrate resolve --applied`）→ `prisma generate` → `migrate status` 确认。共享 dev DB **永不 migrate reset**。先例：`20260831111301_opening_confirm_signature`、`20260901184839_wave3_decrypt_time_bond_ledger`。
- **并行会话**：工作区常驻对方未提交 WIP（project-management/supplier 域）——只 add 本任务明确文件，禁 `git add -A`；推送被拒走波3 先例（临时 worktree cherry-pick/merge，绝不 stash 对方文件）。
- **packages/shared 改动后必须重建**：`pnpm --filter @water-erp/shared build`。
- **whitelist 剥落**：新 DTO 每字段必有装饰器。
- **监督日志 riskFlag 统一 `'高风险'`/`'无'`**。
- **A-152 证书语义**：专家=企业内部人员，平台自签 SM2 软证书（MockUKeyAdapter 生成，浏览器 WebCrypto+sm-crypto，无 Node 专有 API）；供应商侧将来换真 CA 的 vendor 轨道不受影响；专家门户不探测 vendor 中间件亦可（探测逻辑保留，真盾来了即用）。
- **A-152 密钥隔离**：专家门户 MockUKeyAdapter 用**独立 localStorage 存储 key**（与供应商门户共浏览器，默认 key `mock-ukey-keystore` 会撞车）。
- **A-89 口径**：PDF=版式文件（remediation 既有口径）；强制对象=标书角色 technical/business/coverLetter（bond 凭证为扫描件不在此列）；zip/rar 整包提交维持允许。
- **验证命令**：`pnpm --filter api test -- <spec>` + `pnpm --filter api lint`；前端 `pnpm --filter <app> exec tsc --noEmit`；api 构建从 workspace 根 `pnpm --filter api build`。
- **提交纪律**：每任务一提交、只 add 明确文件、不 push；前缀 `feat(p1-wave4):` / `fix(p1-wave4):` / `test(p1-wave4):`。
- **A-87 运行时依赖**：招标要求数据由 ai-bid worker 生成（`pnpm --filter api dev:worker:ai-bid-analysis`）；验收演示前确认 worker 在跑。
- curl/浏览器调试 API 必带 `X-Portal` 头（:3004=`supplier`、:3005=`web`、:3006=`expert`、:3007=`bid`）。

---

### Task 1: Schema 迁移——波4 全部数据面

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（ExpertProfile :1209-1239；BidExpert :556-605；BidProject :313-392；BidSupplier :410-443；User 反向关系区；文件末尾新模型）
- Create: `apps/api/prisma/migrations/<timestamp>_wave4_expert_domain_full_batch/migration.sql`

**Interfaces:**
- Produces（后续任务消费）：`ExpertProfile.regionCode String?` + `ExpertProfile.expertLevel String?`（T2/T3）；`BidExpert.reviewGroup String?` + `BidExpert.dutyRole String?`（T4/T5）；`BidExpert.esignature Json?` + `BidExpert.esignatureAt DateTime?`（T11-T13）；`BidProject.reportNotes Json?`（T6/T7）；`BidSupplier.bondReturnedAt DateTime?` + `BidSupplier.bondReturnReason String?`（T14/T15）；`ExpertCert` 模型（唯一键 `certSn`，T11/T12）。

- [ ] **Step 1: schema 编辑**——
  `ExpertProfile`（`@@index([availability])` :1237 之前追加字段）：
```prisma
  regionCode   String?  // A-129：行政区域代码（GB/T 2260 六位；管理端录入/抽取配额过滤维度）
  expertLevel  String?  // A-129：专家库档案等级 A|B|C|D|E（区别于 ExpertEvaluation.overallGrade 履职评价等级）
```
  `BidExpert`（`signRegisteredBy` :599 之后）：
```prisma
  reviewGroup  String?   // A-132：评审分组（技术组|商务组|综合组）
  dutyRole     String?   // A-132：组内职责（主审|复核|成员；组长另由 isLead 表达）
  esignature   Json?     // A-152：评标报告电子签名归档 {v,payload,signature,algorithm,certSn,verifiedAt}
  esignatureAt DateTime? // A-152：电子签名时间
```
  `BidProject`（`bondReturnedAt` :353 附近）：
```prisma
  reportNotes  Json?     // A-151：评标报告章节附注 [{section:'一'..'十', content}]（签字包生成前编辑、docx 渲染）
```
  `BidSupplier`（`dangerAttribution` :439 之后，波3 `decryptedAt` 旁）：
```prisma
  bondReturnedAt  DateTime?  // A-105：逐家保证金退还时间（null=未退还）
  bondReturnReason String?   // A-105：不予退还理由（与 bondReturnedAt 互斥使用）
```
  `User` 反向关系数组区（与既有 `bidExperts BidExpert[]` 同区）追加：
```prisma
  expertCerts ExpertCert[]
```
  schema 末尾（`SupplierCert` :3539-3551 之后，风格镜像 SupplierCert）：
```prisma
/// A-152：评委签名证书（企业内部人员平台自签 SM2 软证书；一专家一 ACTIVE，换证旧证 REVOKED）
model ExpertCert {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  certSn        String    @unique
  certDn        String
  publicKey     String    // SM2 hex（04 开头 128 位）
  alg           String    @default("SM2")
  bindingStatus String    @default("ACTIVE") // ACTIVE | REVOKED
  boundAt       DateTime  @default(now())
  revokedAt     DateTime?

  @@index([userId, bindingStatus])
}
```

- [ ] **Step 2: 校验 + 迁移三步**——`npx prisma validate` → `npx prisma migrate dev --create-only --name wave4_expert_domain_full_batch`（审阅：6 列 ALTER + ExpertCert 建表/索引/外键；若 reset 提示则手写同构 SQL）→ `db execute` → `resolve --applied` → `generate` → `migrate status` 确认（存量刻意偏离告警为已知，勿动）。手写 SQL 模板（列名/类型逐一对照）：
```sql
-- P1 波4 Task1：A-129/A-132/A-151/A-152/A-105 数据面
ALTER TABLE "ExpertProfile" ADD COLUMN "regionCode" TEXT;
ALTER TABLE "ExpertProfile" ADD COLUMN "expertLevel" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "reviewGroup" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "dutyRole" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "esignature" JSONB;
ALTER TABLE "BidExpert" ADD COLUMN "esignatureAt" TIMESTAMP(3);
ALTER TABLE "BidProject" ADD COLUMN "reportNotes" JSONB;
ALTER TABLE "BidSupplier" ADD COLUMN "bondReturnedAt" TIMESTAMP(3);
ALTER TABLE "BidSupplier" ADD COLUMN "bondReturnReason" TEXT;
CREATE TABLE "ExpertCert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "certSn" TEXT NOT NULL,
    "certDn" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "alg" TEXT NOT NULL DEFAULT 'SM2',
    "bindingStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ExpertCert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExpertCert_certSn_key" ON "ExpertCert"("certSn");
CREATE INDEX "ExpertCert_userId_bindingStatus_idx" ON "ExpertCert"("userId", "bindingStatus");
ALTER TABLE "ExpertCert" ADD CONSTRAINT "ExpertCert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: 提交**：
```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/<目录>/
git commit -m "feat(p1-wave4): schema——ExpertProfile 区域/等级 + BidExpert 分工/电子签名 + BidProject 报告附注 + BidSupplier 逐家退还列 + ExpertCert 模型（A-129/A-132/A-151/A-152/A-105）"
```

---

### Task 2: A-129 后端——档案字段 + 抽取配额过滤 + 管理端 DTO + 种子回填

**Files:**
- Modify: `apps/api/src/expert-admin/expert-admin.service.ts`（`previewExtraction` :401-726 候选过滤 :423-431；预览返回行）
- Modify: `apps/api/src/ai-bid-analysis/services/expert-extraction-ai.service.ts`（`LlmSpecialtyQuota` :49-57）
- Modify: `apps/api/src/expert-admin/dto/extract-preview.dto.ts`（`SpecialtyQuotaDto` :4-20）+ `expert-admin-misc.dto.ts`（:21-35）
- Modify: `apps/api/prisma/seed-data/ExpertProfile.json`（regionCode/expertLevel 回填——经脚本确定性推导，勿手改 187 行）
- Test: `apps/api/src/expert-admin/expert-admin.service.spec.ts`（扩展抽取 describe）

**Interfaces:**
- Produces: `SpecialtyQuotaDto { specialty, count, employer?, department?, regionCode?, expertLevel? }`（T3 表单消费）；管理端专家编辑可写 `regionCode/expertLevel`；预览候选行携带两字段。
- 语义：配额维为**可选过滤**——未填不过滤；`expertLevel` 允许填单值（'A'）或逗号集（'A,B'，`in` 查询）。

- [ ] **Step 1: TDD——先加失败用例**（`previewExtraction` describe 内，mock 风格照既有）：
```ts
it('A-129：配额带 regionCode/expertLevel → 候选过滤 where 注入 expertProfile 两字段', async () => {
  await service.previewExtraction('p1', { mode: 'manual', manualQuotas: [
    { specialty: '造价咨询', count: 3, regionCode: '510000', expertLevel: 'A,B' },
  ] } as any);
  expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ expertProfile: expect.objectContaining({
      regionCode: '510000', expertLevel: { in: ['A', 'B'] },
    }) }),
  }));
});
it('A-129：配额未带区域/等级 → where 不含两键（undefined 透传 prisma 即忽略）', async () => { /* 同上断 not.objectContaining */ });
```
跑 `pnpm --filter api test -- expert-admin.service` 确认红。
- [ ] **Step 2: 实现**——`SpecialtyQuotaDto` 与 `LlmSpecialtyQuota` 增 `@IsOptional() @IsString() @MaxLength(20) regionCode?: string` 与 `@IsOptional() @IsString() @Matches(/^[A-E](,[A-E])*$/) expertLevel?: string`；`previewExtraction` 候选 where 的 `expertProfile` 对象按配额首行（或逐配额过滤——以现场实现为准：现实现为全配额共享一个候选池 then 按配额挑选，故把过滤并入 `expertProfile` where 时用**所有配额的交集语义不可行**，采用：`regionCode` 相同值合并、`expertLevel` 取并集 `in`；若各配额值不一致，取并集并在预览返回 `quotaFiltersApplied` 说明——以现场代码结构为准，保持「未填不过滤」铁律）。
- [ ] **Step 3: 管理端 DTO/预览行**：`expert-admin-misc.dto.ts` 编辑 DTO 增两字段（`@IsOptional @IsString @MaxLength(6)` regionCode / `@IsOptional @IsIn(['A','B','C','D','E'])` expertLevel）落 update 链；预览返回的候选行 select 增 `expertProfile: { select: { regionCode: true, expertLevel: true } }`（以现场 select 为准并入）。
- [ ] **Step 4: 种子回填脚本**（一次性 node，写完跑完即删不入库）：`ExpertProfile.json` 187 条——regionCode 统一 `'510000'`（四川省本级；演示库）；expertLevel 由 title 推导：`教授级高工→'A'`、含 `高工|高级工程师→'B'`、含 `工程师→'C'`、其余 `'D'`；JSON 序列化保持原字段顺序风格。跑后 `git diff --stat` 应只有该 JSON。
- [ ] **Step 5: 验证 + 提交**：`pnpm --filter api test -- expert-admin` 绿 + lint。
```bash
git add apps/api/src/expert-admin/ apps/api/src/ai-bid-analysis/services/expert-extraction-ai.service.ts apps/api/prisma/seed-data/ExpertProfile.json
git commit -m "feat(p1-wave4): A-129 专家档案行政区域代码与库内等级——配额可选过滤（未填不过滤）+ 管理端可编辑 + 种子确定性回填"
```

---

### Task 3: A-129 前端——:3005 专家库编辑 + 抽取配额表单

**Files:**
- Modify: `apps/web/src/app/(main)/expert/extract/page.tsx`（配额状态 :20/:97、配额增删改 :801-816）
- Modify: `apps/web/src/app/(main)/expert/repository/page.tsx`（专家库编辑表单——以现场文件名为准，grep `specialty` 编辑表单定位）
- Modify: `apps/web/src/lib/api/expert.ts`（配额/编辑类型补两字段）

**Interfaces:**
- Consumes: Task 2 的 `SpecialtyQuotaDto` 扩展与管理端编辑字段。

- [ ] **Step 1: 配额表单**——`SpecialtyQuota` interface 增 `regionCode?: string; expertLevel?: string`；配额行 UI 增两个可选控件（区域=六位代码 text input placeholder `510000`；等级=select 空/A/B/C/D/E），随既有配额行渲染与自动配平逻辑共存（两新字段不参与配平计算）。提交 body 直接透传。
- [ ] **Step 2: 专家库编辑**——库管理编辑弹窗/表单增 区域代码（text，maxLength 6，`\d{6}` 提示）与 等级（select 空/A-E）两字段，提交走既有 update 封装（`lib/api/expert.ts` 类型补齐）。列表如有列区可选加「等级」胶囊（无则不加，保持最小）。
- [ ] **Step 3: 验证 + 提交**：`pnpm --filter web exec tsc --noEmit` exit 0。
```bash
git add apps/web/src/app/\(main\)/expert/ apps/web/src/lib/api/expert.ts
git commit -m "feat(p1-wave4): A-129 :3005 抽取配额区域/等级过滤控件 + 专家库档案两字段编辑"
```

---

### Task 4: A-132 后端——评委分工端点 + 校验

**Files:**
- Create: `apps/api/src/bid/dto/committee-assignment.dto.ts`
- Modify: `apps/api/src/expert-admin/expert-admin.service.ts`（`setLeader` :934-960 旁新增方法）+ `expert-admin.controller.ts`（:106-117 旁）
- Test: `apps/api/src/expert-admin/expert-admin.service.spec.ts`

**Interfaces:**
- Produces: `PUT /api/expert-admin/projects/:id/committee/assignment` body `{ assignments: [{ userId, reviewGroup?, dutyRole? }] }`（Roles leader/admin/staff——对齐 setLeader 邻路由）；校验 `reviewGroup ∈ {技术组,商务组,综合组}`、`dutyRole ∈ {主审,复核,成员}`、userId ∈ 本项目正选 BidExpert；事务逐行 update（**不清空未提交项**——partial update 语义）；写监督日志 `action:'评委分工设置'` riskFlag `'无'`；错误码 `EXPERT_NOT_IN_COMMITTEE`。
- `GET` 随 `getProjectInvitations`（:989 select）补 `reviewGroup/dutyRole` 两字段即可（本任务一并改 select）。

- [ ] **Step 1: TDD 用例**：
```ts
it('A-132：分工设置——合法两行 update + 监督日志；名册外 userId 400', async () => {
  prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', expertRole: '正选' }, { userId: 'u2', expertRole: '正选' }]);
  await service.setCommitteeAssignment('p1', { assignments: [
    { userId: 'u1', reviewGroup: '技术组', dutyRole: '主审' },
    { userId: 'u2', reviewGroup: '商务组', dutyRole: '复核' },
  ] } as any);
  expect(prisma.bidExpert.update).toHaveBeenCalledTimes(2);
  expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
  await expect(service.setCommitteeAssignment('p1', { assignments: [{ userId: 'uX', reviewGroup: '技术组' }] } as any))
    .rejects.toMatchObject({ response: { code: 'EXPERT_NOT_IN_COMMITTEE' } });
});
it('A-132：非法枚举 400（reviewGroup 白名单）', /* 传 'A组' → 400，DTO IsIn 在 e2e/管道层；service 层双保险断 BadRequest */);
```
- [ ] **Step 2: DTO**：
```ts
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CommitteeAssignmentItemDto {
  @IsString() @MaxLength(64) userId!: string;
  @IsOptional() @IsIn(['技术组', '商务组', '综合组']) reviewGroup?: string;
  @IsOptional() @IsIn(['主审', '复核', '成员']) dutyRole?: string;
}
export class CommitteeAssignmentDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => CommitteeAssignmentItemDto)
  assignments!: CommitteeAssignmentItemDto[];
}
```
- [ ] **Step 3: service + controller**（`setLeader` 旁，风格镜像：正选校验/事务/监督日志）：
```ts
/** A-132：评委职责分工（技术/商务分组 + 主审/复核），partial 更新，写入报告委员会名单（见 docx 任务） */
async setCommitteeAssignment(projectId: string, dto: CommitteeAssignmentDto, actorId?: string) {
  const roster = await this.prisma.bidExpert.findMany({ where: { projectId, expertRole: '正选' }, select: { userId: true } });
  const ids = new Set(roster.map(r => r.userId));
  for (const a of dto.assignments) {
    if (!ids.has(a.userId)) throw new BadRequestException({ error: `专家 ${a.userId} 不在本项目正选名单`, code: 'EXPERT_NOT_IN_COMMITTEE' });
  }
  await this.prisma.$transaction(async (tx) => {
    for (const a of dto.assignments) {
      await tx.bidExpert.update({ where: { projectId_userId: { projectId, userId: a.userId } },
        data: { reviewGroup: a.reviewGroup ?? undefined, dutyRole: a.dutyRole ?? undefined } });
    }
    await tx.bidSupervisionLog.create({ data: { projectId, time: new Date(), role: '系统', target: '评标委员会',
      action: '评委分工设置', result: dto.assignments.map(a => `${a.userId}:${a.reviewGroup ?? '—'}/${a.dutyRole ?? '—'}`).join('；'), riskFlag: '无' } });
  });
  return { success: true };
}
```
controller：`@Put('projects/:id/committee/assignment')` + `@Roles(...)` 对齐 `extract/leader` 邻路由 + ApiOperation「A-132: 评委职责分工（分组/主审复核，partial）」。
- [ ] **Step 4: 验证 + 提交**：spec 绿 + lint。
```bash
git add apps/api/src/expert-admin/ apps/api/src/bid/dto/committee-assignment.dto.ts
git commit -m "feat(p1-wave4): A-132 评委分工端点——reviewGroup/dutyRole 白名单校验+名册校验+partial 更新+监督日志"
```

---

### Task 5: A-132 前端 + 报告名单扩列

**Files:**
- Modify: `apps/web/src/app/(main)/expert/extract/page.tsx`（步骤 5 组长选定区 :2651-2655 附近）
- Modify: `apps/web/src/lib/api/expert.ts`（+setCommitteeAssignment 封装 + 类型）
- Modify: `apps/api/src/bid/bid-sign-packet.service.ts`（快照 committee 映射 :509-518）+ `bid-sign-packet-docx.service.ts`（第二节表头 :109-116）
- Modify: `apps/bid-portal/src/components/workspace/evaluation-view.tsx`（专家状态卡 :578-596）+ `signing-tab.tsx`（签字清单 :316-323）
- Test: `apps/api/src/bid/bid-sign-packet.service.spec.ts`（如无则建——快照含两字段断言）

**Interfaces:**
- Consumes: Task 4 端点与 BidExpert 两列。

- [ ] **Step 1: docx 名单 5→7 列**——表头 `['姓名','专业','角色','分组','职责','组长','采购人代表']`；行数据插 `e.reviewGroup ?? '—'` / `e.dutyRole ?? '—'`；快照映射 committee 增 `reviewGroup/dutyRole`（`bidExpert.findMany` select 两列——查 :420-429 select 是否需补）。
- [ ] **Step 2: :3005 步骤5 分工配置**——组长选定列表每行（正选）增两个下拉（分组 空/技术组/商务组/综合组；职责 空/主审/复核/成员），「保存分工」按钮批量调 `setCommitteeAssignment`（只提交非空项）；从 DB 恢复初始值（`getProjectInvitations` 已含两字段）。
- [ ] **Step 3: :3007 展示**——evaluation-view 专家状态卡姓名行后追加 `reviewGroup · dutyRole` 文本（有则显）；signing-tab 签字清单行组长徽标旁追加同款小徽标。
- [ ] **Step 4: 快照 spec**（`buildSnapshot` 用例断 committee 行含 reviewGroup/dutyRole；无既有 spec 则新建最小 describe，mock prisma findMany 返回含两字段）。
- [ ] **Step 5: 验证 + 提交**：`pnpm --filter api test -- sign-packet` + `pnpm --filter web exec tsc --noEmit` + `pnpm --filter bid-portal exec tsc --noEmit`。
```bash
git add apps/web/src/app/\(main\)/expert/extract/page.tsx apps/web/src/lib/api/expert.ts apps/api/src/bid/bid-sign-packet.service.ts apps/api/src/bid/bid-sign-packet.service.spec.ts apps/api/src/bid/bid-sign-packet-docx.service.ts apps/bid-portal/src/components/workspace/evaluation-view.tsx apps/bid-portal/src/components/workspace/signing-tab.tsx
git commit -m "feat(p1-wave4): A-132 分工写入报告名单（5→7 列）+ :3005 步骤5 分组/职责配置 + :3007 双处展示"
```

---

### Task 6: A-151 后端——报告章节附注存取 + docx 渲染

**Files:**
- Create: `apps/api/src/bid/dto/report-notes.dto.ts`
- Modify: `apps/api/src/bid/bid.service.ts`（`markBondReturned` :5683 旁新增两方法）+ `bid.controller.ts`（:134 旁）
- Modify: `apps/api/src/bid/bid-sign-packet.service.ts`（`buildSnapshot` :419-527 project 读入 reportNotes）+ `bid-sign-packet-docx.service.ts`（`buildMainReport` :99-183 + `SignPacketSnapshot` :16-37）
- Test: `apps/api/src/bid/bid.service.spec.ts`（+describe）

**Interfaces:**
- Produces: `GET /api/bid/projects/:id/report-notes` → `{ notes: [{section, content}] }`；`PUT` 同路径 body 同构（Roles bid_host/admin）。章节限定 `'一'..'十'`，content ≤2000 字；十节附注**替代**默认硬编码句前半（`本报告由系统根据评标过程数据自动生成；`保留、用户句接续），一至九节附注以「附注：」段插入对应节末。错误码 `INVALID_SECTION`。
- docx 渲染：`SignPacketSnapshot` 增 `reportNotes: Array<{section:string; content:string}>`。

- [ ] **Step 1: DTO**：
```ts
import { IsArray, IsIn, IsString, IsOptional, ArrayMinSize, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const SECTIONS = ['一','二','三','四','五','六','七','八','九','十'] as const;
export class ReportNoteItemDto {
  @IsIn(SECTIONS) section!: string;
  @IsString() @MaxLength(2000) content!: string;
}
export class ReportNotesDto {
  @IsOptional() @IsArray() @ArrayMinSize(0) @ValidateNested({ each: true })
  @Type(() => ReportNoteItemDto)
  notes!: ReportNoteItemDto[];
}
```
- [ ] **Step 2: service 两方法**（TDD：先写 `PUT 空数组清空` / `非法章节 400 INVALID_SECTION` / `十节内容落库` 三用例）：
```ts
/** A-151：评标报告章节附注（签字包生成前编辑，docx 渲染；重新生成取最新值） */
async getReportNotes(projectId: string) {
  const p = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { reportNotes: true } });
  return { notes: (p?.reportNotes as ReportNoteItemDto[] | null) ?? [] };
}
async setReportNotes(projectId: string, dto: ReportNotesDto, actorId?: string) {
  const p = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!p) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
  await this.prisma.bidProject.update({ where: { id: projectId }, data: { reportNotes: dto.notes as any } });
  await this.prisma.bidSupervisionLog.create({ data: { projectId, time: new Date(), role: '系统', target: p.name,
    action: '评标报告附注编辑', result: dto.notes.map(n => `第${n.section}节 ${n.content.length} 字`).join('；') || '清空附注', riskFlag: '无' } }).catch(() => {});
  return { success: true };
}
```
controller 两路由（GET/PUT，Roles `bid_host,admin`）。
- [ ] **Step 3: 快照 + docx**——`buildSnapshot` 的 bidProject findUnique 并入 `reportNotes: true`（快照字段 `reportNotes`）；`buildMainReport` 逐节渲染：`const note = (s.reportNotes ?? []).find(n => n.section === SEC); if (note) this.para('附注：' + note.content, { italics: true })`（以 docx 服务现有 para/options 能力为准，斜体可用则用不可用则普通段前缀「附注：」）；十节改为 `'本报告由系统根据评标过程数据自动生成；' + (十节附注 content ?? '')`（附注为空时保留现硬编码全句）。
- [ ] **Step 4: 验证 + 提交**：`pnpm --filter api test -- bid.service sign-packet` + lint。
```bash
git add apps/api/src/bid/dto/report-notes.dto.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.controller.ts apps/api/src/bid/bid.service.spec.ts apps/api/src/bid/bid-sign-packet.service.ts apps/api/src/bid/bid-sign-packet-docx.service.ts
git commit -m "feat(p1-wave4): A-151 报告章节附注——GET/PUT 端点（一~十白名单/监督日志）+ 签字包快照携带 + docx 各节附注渲染/十节正文续写"
```

---

### Task 7: A-151 前端——:3007 签字包生成前附注编辑

**Files:**
- Modify: `apps/bid-portal/src/lib/api/sign-packet.ts`（+getReportNotes/setReportNotes）
- Modify: `apps/bid-portal/src/components/workspace/signing-tab.tsx`（生成按钮 :225-230 旁）

**Interfaces:**
- Consumes: Task 6 两端点。

- [ ] **Step 1:** 生成按钮旁增「报告附注」按钮 → 弹窗（cgzxui 既有 dialog 风格）列十个 section 的 textarea（label 一、基本情况…十、其他说明；默认收起仅有值/十节展开——折叠面板或全列均可，取该组件库既有形态）→「保存」PUT → toast；生成签字包流程不强制先存附注（附注为可选编辑，生成时取库内最新）。
- [ ] **Step 2: 验证 + 提交**：`pnpm --filter bid-portal exec tsc --noEmit`。
```bash
git add apps/bid-portal/src/lib/api/sign-packet.ts apps/bid-portal/src/components/workspace/signing-tab.tsx
git commit -m "feat(p1-wave4): A-151 :3007 签字包生成前「报告附注」编辑弹窗（十节 textarea，生成取最新）"
```

---

### Task 8: A-87 后端——提取前移（发布钩子）+ 供应商只读端点

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts`（:2006-2054 启动评标处的 task upsert+入队抽为私有方法）
- Modify: `apps/api/src/announcement/announcement.service.ts`（BID_NOTICE 发布且关联 BidProject 处——grep ` BidProject` 创建/关联点，N16 直建 :645 附近同域）+ `announcement.module.ts`（imports 增 `AiBidAnalysisModule`——若该 module 未导出所需 provider 则在 AiBidAnalysisModule exports 补，以现场 DI 图为准）
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts` + `supplier-portal.controller.ts`（新只读端点）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（+describe）

**Interfaces:**
- Produces: `GET /api/supplier-portal/bid-projects/:id/tender-requirements`（supplier 角色）→ `{ status: 'READY' | 'PENDING', requirements: {...} | null }`——READY 返回扁平清单 `{ projectName, bidDeadline, maxPrice, qualification: [{category, content, isRequired}], technical: [{category, content, isStarred}], commercial: [...], priceEvaluationMethod }`；PENDING=任务未跑完/未入队；未关联任务亦返回 PENDING（不报错，前端空态提示）。
- 提取前移：`ensureTenderAnalysis(projectId)` 私有方法（task upsert + `tenderQueue.add`，幂等：`task.requirements` 已存在则跳过入队）——`startEvaluation` 原两处调用点（:2006/:2049）改为调它；公告发布 BID_NOTICE 且 `relatedProjectCode` 命中 BidProject 时调用（`.catch(()=>{})` 不阻塞发布）。

- [ ] **Step 1: 抽方法**——对照 :2006-2054 现场代码把「AiBidAnalysisTask upsert + tenderQueue.add」抽为 `private async ensureTenderAnalysis(projectId: string, opts?: { force?: boolean })`（force=true 保留 rerun 端点语义 :2142/:2193——rerun 传 force 跳过幂等闸）；启动评标两调用点行为不变（既有 spec 必须全绿）。
- [ ] **Step 2: 发布钩子**——announcement.service 发布成功路径（status→PUBLISHED 且 type=BID_NOTICE）：查 `bidProject.findUnique({ where: { projectCode: relatedProjectCode } })`，命中则 `await this.bidService?…`——注意 DI：announcement 侧若不便注入 BidService，改为直接注入 `tenderQueue`（`@InjectQueue('tender-processing')`，AiBidAnalysisModule exports Queue）+ 最小 task upsert（照抄 ensure 内 upsert 三行）。取注入代价小者，report 说明所选路径。`.catch` 包裹；同一项目重复发布不重复入队（幂等闸）。
- [ ] **Step 3: 供应商端点（TDD 三用例先红）**——无任务→`{status:'PENDING', requirements:null}`；有 requirements→READY 且扁平结构正确（qualification/technical/commercial 三数组 + isStarred 保留）；非本项目受邀供应商→仍可读（要点清单对全体潜在投标人公开，公开公告口径）——**不做名册门控**（检测项要求投标人可见；如现场有下载门控争议，保守放开读、结构化清单不含密文文件本体）。实现直接 prisma 读 `aiBidAnalysisTask.findUnique({ where: { projectId } })`（查该表唯一键字段名——1:1 关联，以 schema :204-224 现场为准）。
- [ ] **Step 4: 验证 + 提交**：`pnpm --filter api test -- supplier-portal.service bid.service announcement`（相关套件）+ lint。
```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/announcement/ apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts apps/api/src/supplier-portal/supplier-portal.controller.ts
git commit -m "feat(p1-wave4): A-87 招标要求提取前移——ensureTenderAnalysis 幂等复用 + 公告发布入队钩子 + 供应商门户只读要点端点（READY/PENDING）"
```

---

### Task 9: A-87 前端——投标详情页「招标文件要点」卡

**Files:**
- Modify: `apps/supplier-portal-next/src/lib/api/bid.ts`（+getTenderRequirements）
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx`（`overview-card` :434-471 与 `content-card` :473-551 之间插入）

**Interfaces:**
- Consumes: Task 8 端点。

- [ ] **Step 1: API 封装**——`getTenderRequirements(projectId): Promise<{status, requirements}>`。
- [ ] **Step 2: 要点卡**——沿用 `content-card` 同款卡片结构，标题「招标文件要点（系统解析）」：
  - `status==='PENDING'` 或无数据 → 空态行「招标文件要点解析中或尚未生成——可先下载招标文件查阅原文」（不轮询，挂载拉一次+手动刷新钮可选；**不造假数据**）
  - READY → 三分组折叠列表（资格要求/技术要求/商务要求），每条 `content` + 星标（`isStarred` 显 ★ 徽标）+ `category` 小标签；顶部一行摘要：`项目类型 · 评标办法 priceEvaluationMethod · 最高限价 maxPrice · 截止 bidDeadline`
  - 卡底注：「解析由系统自动生成，以招标文件原文为准」
- [ ] **Step 3: 验证 + 提交**：`pnpm --filter supplier-portal-next exec tsc --noEmit`。
```bash
git add apps/supplier-portal-next/src/lib/api/bid.ts "apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx"
git commit -m "feat(p1-wave4): A-87 供应商投标详情页「招标文件要点」卡——三分组清单+★条款+解析空态（不造数）"
```

---

### Task 10: A-89——新轨标书 PDF 版式强制（前后端）

**Files:**
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx`（`uploadEncryptedFile` :317-358 dualReady 分支 + accept :893/:920/:984 + hint）
- Modify: `apps/supplier-portal-next/src/utils/dual-envelope.ts`（`encryptAndUploadFile` 前置守卫）或 submit 页内守卫（取调用最近处）
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（投递校验 :1209-1221 `assertEnvelopeIntact` 旁）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（+2 用例）

**Interfaces:**
- 语义：标书角色 `technical`/`business`/`coverLetter`（即 full/split-tech/split-biz/coverLetter 类目）在**双信封新轨**必须上传 PDF；Office 原生格式（doc/docx/xls/xlsx）前端拒绝并给转换指引；后端在投递时按 FileAsset 文件名扩展断言 `.pdf`，违者 400 `BID_FILE_MUST_BE_PDF`。bond 凭证与 zip/rar 整包不在此列。
- 锚点口径不变：`entry.sha256` 本就是明文哈希——上传的明文是 PDF，锚点即 PDF 哈希。

- [ ] **Step 1: 前端守卫（TDD 不适用-UI）**——`uploadEncryptedFile` dualReady 分支最前：
```ts
const OFFICE_EXT = /\.(docx?|xlsx?)$/i;
const PDF_ONLY_ROLES = new Set(['technical', 'business', 'coverLetter']);
if (dualReady && PDF_ONLY_ROLES.has(role) && OFFICE_EXT.test(file.name)) {
  toast.error(`「${file.name}」为 Office 格式——投标文件须为 PDF 版式文件，请先用 Office/WPS「另存为 PDF」后上传（加密锚点以 PDF 为准）`);
  throw new Error('BID_FILE_MUST_BE_PDF');
}
```
accept 收窄：完整标书/拆分-技术/拆分-商务/投标函四处 `accept=".pdf,.zip,.rar"`（投标函 `.pdf`）；hint 同步「PDF/ZIP（Office 请先转 PDF）」。
- [ ] **Step 2: 后端断言（TDD 先红）**——投递枚举处：对声明的 technical/business/coverLetter 角色取对应 FileAsset（现场 :1209-1221 已逐角色拿 asset）断 `/\.(pdf)$/i.test(asset.fileName ?? '')`（**先核 FileAsset 文件名字段名**——密文上传时文件名是否保留原名：读 `dual-envelope.ts:24-42` `uploadFile(sealed.file, ...)` 的 File 构造与 `upload.service` 存名逻辑；若密文文件名已被改写为 .bin/.enc，则在 `encryptAndUploadFile` 的 uploadFile 调用上补传原始文件名参数——以 upload.service 支持的最近途径为准，report 说明）。违例抛：
```ts
throw new BadRequestException({ error: `投标文件（${role}）必须为 PDF 版式文件（版式转换口径）——请转换后重新加密上传`, code: 'BID_FILE_MUST_BE_PDF' });
```
spec 两用例：docx 扩展 → 400 BID_FILE_MUST_BE_PDF；pdf 扩展 → 通过。
- [ ] **Step 3: 验证 + 提交**：`pnpm --filter api test -- supplier-portal.service` + `pnpm --filter supplier-portal-next exec tsc --noEmit`。
```bash
git add apps/supplier-portal-next/src/app/\(main\)/bids/\[id\]/submit/page.tsx apps/supplier-portal-next/src/utils/dual-envelope.ts apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat(p1-wave4): A-89 新轨标书 PDF 版式强制——前端拒 Office 格式+转换指引、后端投递扩展断言 BID_FILE_MUST_BE_PDF（锚点=PDF 哈希，PDF 满足版式口径）"
```

---

### Task 11: A-152 后端——ExpertCert 端点 + 电子签名通道 + 闭环共享 util

**Files:**
- Create: `apps/api/src/expert/expert-esign.util.ts` + 同名 `.spec.ts`
- Create: `apps/api/src/bid/sign-loop.util.ts`（闭环判定共享化）
- Modify: `apps/api/src/expert/expert.service.ts`（+证书/签名四方法）+ `expert.controller.ts`（+4 路由）
- Modify: `apps/api/src/bid/bid-sign-packet.service.ts`（`register` :176-187 闭环块改调共享 util；`generate` 重置 :402-405 增清 esignature；回流包 expertSignStatuses :305-309 增电子签名摘要）
- Modify: `apps/api/src/bid/bid.service.ts`（`archiveAll` :5409-5428 签字状态哈希链并入 esignature/esignatureAt——Step 6）
- Create: `apps/api/src/expert/dto/expert-cert.dto.ts`、`expert-esign.dto.ts`
- Test: `apps/api/src/expert/expert.service.spec.ts`（+describe）

**Interfaces:**
- Produces:
  - `GET /api/expert/cert`（本人 ACTIVE ExpertCert）｜`POST /api/expert/cert` body `{certSn, certDn, publicKey, alg?}`（bind：`isValidPublicKey` 校验 → 旧 ACTIVE 置 REVOKED → 新 ACTIVE；错误码照抄供应商 `bindCert`：`SM2_PUBLIC_KEY_INVALID`）
  - `GET /api/expert/projects/:projectId/esign-payload` → `{ canonical, payload }`（门控：本人正选 BidExpert + 签字包已生成 + `signStatus==='PENDING'`；错误码 `SIGN_PACKET_NOT_GENERATED`/`NOT_SIGNABLE`）
  - `POST /api/expert/projects/:projectId/esign` body `{signature}`（验签前置：ExpertCert ACTIVE 本人 + `SignatureService.verify` → 400 `EXPERT_ESIGN_INVALID`）→ 事务 `updateMany`（PENDING→SIGNED 原子）写 `esignature {v:1,payload,signature,algorithm:'SM2/SM3',certSn,verifiedAt}` + `esignatureAt` + `signStatusAt` + `signRegisteredBy: userId` → 闭环判定（共享 util）→ 监督日志 `action:'评标报告电子签名（专家本人）'` riskFlag `'无'`
  - `buildExpertEsignCanonical(input: { purpose:'report_esign', projectId, bidExpertId, userId, expertName, packetSha256, packetGeneratedAt }): string`（canonicalJson @water-erp/ukey）
  - `closeSignLoopIfDone(tx, projectId, actorId, actorLabel)` 共享 util：PENDING 计数 0 → BidSignPacket.closedAt/closedById + 监督日志 `'评标签字闭环'`（文案照抄现 :178-187）——`register()` 与 expert esign 双路调用
- 语义：REFUSED_DISSENT/DEEMED_AGREED 只能主持端登记（异议/推定场景本就非本人签署）；电子签名不可用于覆盖非 PENDING 态（payload 端点即拦）。

- [ ] **Step 1: TDD canonical spec**（键序稳定/purpose 定值/含 packetSha256）→ 实现 `expert-esign.util.ts`。
- [ ] **Step 2: 证书 DTO+端点**（ExpertCertDto 三字段 IsString+MaxLength；`certDn` 不做 CN 匹配——专家 DN 为 `CN=专家姓名`，服务端校验 CN == 该专家 `expertName` 归一后一致，`CERT_DN_MISMATCH`）。
- [ ] **Step 3: 共享闭环 util**——从 `register` :176-187 原样抽移（两个调用点行为零变化，既有 sign-packet spec 全绿为证）。
- [ ] **Step 4: payload/esign 两端点（TDD 用例先红：payload 无包 400 / 非 PENDING 400 / 验签失败 400 EXPERT_ESIGN_INVALID / 成功写四列+闭环+日志 / 幂等重签 updateMany count=0 → 400 NOT_SIGNABLE）**。事务模板照 `register` :152-161 原子抢占风格。
- [ ] **Step 5: 重置清理 + 回流包**——`generate` 重置 data 增 `esignature: null, esignatureAt: null`；`generateHandover` 的 `expertSignStatuses` map 增 `esignature: e.esignature ? { algorithm, certSn, verifiedAt } : null, esignatureAt: e.esignatureAt`（剥壳摘要，完整证据在 DB/BidExpert）。
- [ ] **Step 6: 归档哈希链核验**——`archiveAll` :5409-5428「签字状态 JSON」若不含 esignature 字段则并入（读现场组装对象补 `esignature`/`esignatureAt` 两键；verify/export 同口径重算处一并）。
- [ ] **Step 7: 验证 + 提交**：`pnpm --filter api test -- expert.service sign-packet` + lint。
```bash
git add apps/api/src/expert/ apps/api/src/bid/sign-loop.util.ts apps/api/src/bid/bid-sign-packet.service.ts apps/api/src/bid/bid.service.ts
git commit -m "feat(p1-wave4): A-152 评委电子签名后端——ExpertCert 绑定端点 + esign canonical/payload/验签事务 + 闭环判定共享 util（双路）+ 重生成清签 + 回流包/归档链携带"
```

---

### Task 12: A-152 专家门户——软证书 + PIN 签署 UI

**Files:**
- Modify: `apps/expert-portal/package.json`（dependencies 增 `"@water-erp/ukey": "workspace:*"`——版本写法照 supplier-portal-next 现场行）
- Create: `apps/expert-portal/src/utils/expert-ukey.ts`（ukey 工厂 + **独立存储 key**）
- Create: `apps/expert-portal/src/components/exp-pin-dialog.tsx`（仿 `confirm-dialog.tsx` L27-115 结构 + 口令输入，`exp-dialog`/`neu-input` 类）
- Modify: `apps/expert-portal/src/app/(app)/evaluate/[id]/page.tsx`（report 步骤挂卡）
- Modify: `apps/expert-portal/src/lib/api.ts`（+四封装）
- Modify: `apps/expert-portal/src/components/evaluate/report-step.tsx`（新增「评标报告电子签署」区块 props）

**Interfaces:**
- Consumes: Task 11 四端点；`MockUKeyAdapter`（`packages/ukey/src/mock-ukey.ts`——`open({storage, password})`/`createCertificate(label)`/`listCertificates()`/`sign(certSn, msg)`）；供应商门户 PIN 范式（`opening-hall/page.tsx` `handleUkeyOpen` :174-197 / `doConfirmSign` :200-219——**口令仅内存 + pendingRef 续跑 + 服务端 ACTIVE 证书优先**）。
- Produces: 报告步骤（桌面端第 7 步）签署区块四态：无证书（引导创建软证书）→ 有证书未签（PIN 签署）→ 已签（徽标 `已电子签名（SM2/SM3 · verifiedAt）`）→ 签字包未生成/状态非 PENDING（等待提示）。

- [ ] **Step 1: 依赖 + 工厂**——package.json 增 ukey（`pnpm install` 刷 lockfile——**只允许 lockfile 因该依赖变动**，若大面积漂移用 `--frozen-lockfile` 校验后手补条目）；`expert-ukey.ts`：
```ts
import { MockUKeyAdapter, VendorUKeyAdapter, type UKeyAdapter } from '@water-erp/ukey';
// 专家侧独立存储（与供应商门户共浏览器，默认 key 会撞车）
const EXPERT_STORAGE_KEY = 'expert-mock-ukey-keystore';
const storage = {
  getItem: (k: string) => localStorage.getItem(EXPERT_STORAGE_KEY + ':' + k),  // 以 MockUKeyAdapter storage 接口现场签名为准适配
  setItem: (k: string, v: string) => localStorage.setItem(EXPERT_STORAGE_KEY + ':' + k, v),
  removeItem: (k: string) => localStorage.removeItem(EXPERT_STORAGE_KEY + ':' + k),
};
export async function openExpertUkey(password: string): Promise<UKeyAdapter> {
  if (await VendorUKeyAdapter.probe()) return VendorUKeyAdapter.open({ password });
  return MockUKeyAdapter.open({ storage: storage as any, password });
}
```
（storage 形参类型以 mock-ukey.ts 现场签名为准——只包 key 前缀，方法集对齐。）
- [ ] **Step 2: PIN 弹窗**——`ExpPinDialog`：props `{open, title, subtitle, onClose, onSubmit(pin), busy}`；结构抄 ConfirmDialog（portal/exp-dialog/Esc/滚动锁）+ `neu-input` type=password + 确认/取消 `neu-btn-*`。
- [ ] **Step 3: 签署区块（report-step）**——新增 props `esign: { packetReady: boolean; signStatus: string; esignature: object | null; hasCert: boolean }` 与回调 props `onCreateAndSign`, `onSign`；页面侧实现两流程（**照抄供应商范式**）：
  - 首次（无证书）：ExpPinDialog（首次口令将创建软证书）→ `openExpertUkey` → `createCertificate(expertName)` → `bindExpertCert({certSn, certDn, publicKey, alg})` → 继续 sign 流程
  - 签署：`getExpertEsignPayload(projectId)` → ExpPinDialog → `openExpertUkey` → 证书选择（服务端 ACTIVE 的 certSn 优先，本地 listCertificates 兜底）→ `adapter.sign(certSn, canonical)` → `submitExpertEsign(projectId, {signature})` → toast「已电子签署评标报告」+ 刷新
  - 错误映射：`EXPERT_ESIGN_INVALID`→「签名验证失败，请重试」；`SIGN_PACKET_NOT_GENERATED`→「等待主持人生成签字包」；`NOT_SIGNABLE`→「当前状态不可签署（可能已登记纸质）」
- [ ] **Step 4: 页面数据接线**——evaluate 页为 report-step 增拉取（`getSignState`：可并入既有 report GET 或复用 `myExpertRecord`——取改动最小路径：新增 `GET /expert/projects/:id/esign-state` 轻端点亦可在 Task 11 的 payload 端点上扩展 `stateOnly` 参数；**决定：Task 11 的 payload 端点 400 响应携带 reason code，前端据此判态；另在 report-step 挂载时调 `GET /expert/cert` 判 hasCert**——零新增端点）。
- [ ] **Step 5: 验证 + 提交**：`pnpm --filter expert-portal exec tsc --noEmit`；`pnpm --filter api test -- expert.service`（Task 11 套件不回归）。
```bash
git add apps/expert-portal/package.json apps/expert-portal/pnpm-lock.yaml apps/expert-portal/src/utils/expert-ukey.ts apps/expert-portal/src/components/exp-pin-dialog.tsx apps/expert-portal/src/app/\(app\)/evaluate/\[id\]/page.tsx apps/expert-portal/src/lib/api.ts apps/expert-portal/src/components/evaluate/report-step.tsx
git commit -m "feat(p1-wave4): A-152 专家门户电子签署——ukey 软证书集成（独立存储 key）+ ExpPinDialog + 报告步骤签署区块四态（创建证书→绑定→PIN 签名）"
```
（如 lockfile 在 workspace 根则 add 根 lockfile 路径，以 `git status` 实际为准。）

---

### Task 13: A-152 :3007——电子签名徽标 + 登记区分

**Files:**
- Modify: `apps/bid-portal/src/components/workspace/signing-tab.tsx`（专家表格行 :344-371 + 闭环横幅区）
- Modify: `apps/bid-portal/src/lib/api/sign-packet.ts`（类型 +esignature/esignatureAt）

**Interfaces:**
- Consumes: Task 11 回流包/包载荷 expertSignatures 摘要（`getSignPacket` GET 载荷需含每专家 esignature 摘要——若 GET 未含则在 Task 11 的 GET select 补，此处消费）。

- [ ] **Step 1:** 专家表行：`signStatus==='SIGNED'` 且 `esignature` 非空 → 状态徽标旁加「电子签名」小徽标（绿色，title 显示 `SM2/SM3 · certSn · verifiedAt`）；仅纸质登记（SIGNED 无 esignature）→ 维持现展示。行操作：电子已签专家不显示「撤销」（撤销仅主持登记路径；电子签名撤销走重生成整包——提示文案加于撤销按钮 title）。
- [ ] **Step 2:** 闭环横幅补一句「含 N 位专家电子签名」（count = esignature 非空数）。
- [ ] **Step 3: 验证 + 提交**：`pnpm --filter bid-portal exec tsc --noEmit`。
```bash
git add apps/bid-portal/src/components/workspace/signing-tab.tsx apps/bid-portal/src/lib/api/sign-packet.ts
git commit -m "feat(p1-wave4): A-152 :3007 签字表电子签名徽标（SM2/SM3·certSn·时间）+ 闭环横幅计数"
```

---

### Task 14: A-105 后端——逐家退还 + 定标联动 + 调度器逐家口径

**Files:**
- Create: `apps/api/src/bid/dto/supplier-bond-return.dto.ts`
- Modify: `apps/api/src/bid/bid.service.ts`（`markBondReturned` :5683 旁新增两方法；`deliverAwardLetter` 收尾 :5808-5810 前插钩子）
- Modify: `apps/api/src/bid/bid.controller.ts`（:134-139 旁 +2 路由）
- Modify: `apps/api/src/scheduler/scheduler.service.ts`（`remindBondReturns` :221-258 逐家口径）
- Test: `apps/api/src/bid/bid.service.spec.ts`（+3 用例）

**Interfaces:**
- Produces: `GET /api/bid/projects/:id/bond-returns`（逐家行 supplierName/bondStatus(唱标)/bondReturnedAt/bondReturnReason/isWinner，Roles admin/bid_host/leader/staff）；`POST /api/bid/projects/:id/bond-return-supplier` body `{supplierName, returned, reason?}`（不予退还需理由 `REASON_REQUIRED`；同步开标记录 bondStatus 为 已退还/不予退还；监督日志 `响应担保退还（逐家）`/`响应担保不予退还（逐家）` riskFlag 无/高风险；旧项目级端点 :134 **原样保留**）。定标联动：`deliverAwardLetter` 成功后（`return delivery` :5810 前）——未中标且 `bondReturnedAt` 为空者通知 staff（`sendToRole('staff', {type:'SYSTEM',title,content})` 两参签名照 scheduler :252 原文）+ `systemConfig` marker `bond_return_reminder_award:<projectId>` 幂等（key 主键 upsert，模板照 :240-247）。
- 调度器：扫描条件去掉项目级 `bondReturnedAt: null`（改逐家判定）——循环内查 `bidSupplier.count({projectId, submitStatus:'已提交', bondReturnedAt: null})` 为 0 则 continue；提醒文案附未退名单（take 5 姓名）。

**本任务代码全文沿用波3 计划 Task 9 成稿**（git 历史 `docs/superpowers/plans/2026-09-01-p1-wave3-opening-gates-bond-ledger.md` 的「Task 9: A-105 后端」节——service 两方法/DTO/路由/钩子/调度器改造代码块完整可抄），行号锚点以本表复核值为准。

- [ ] **Step 1: DTO + service 两方法**（照波3 成稿，TDD 三用例：退还三写断言/无理由 400/定标联动 sendToRole+marker）
- [ ] **Step 2: controller 两路由** + 旧路由注释「项目级（兼容保留）」
- [ ] **Step 3: 定标钩子 + 调度器改造**
- [ ] **Step 4: 验证 + 提交**：`pnpm --filter api test -- bid.service scheduler` + lint。
```bash
git add apps/api/src/bid/dto/supplier-bond-return.dto.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.controller.ts apps/api/src/scheduler/scheduler.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "feat(p1-wave4): A-105 保证金逐家退还——登记端点（同步开标记录已退还/不予退还）+ 清单 + 定标自动提醒 + 调度器逐家口径（旧项目级端点兼容保留）"
```

---

### Task 15: A-105 前端——:3005 合同弹窗逐家退还

**Files:**
- Modify: `apps/web/src/lib/api/contract.ts`（:102-105 旁 +2 封装）
- Modify: `apps/web/src/components/contracts/contract-stage-modal.tsx`（C4 按钮区 :158-164 替换）

**Interfaces:**
- Consumes: Task 14 两端点。

- [ ] **Step 1:** `listBondReturns(projectId)` / `markSupplierBondReturned(projectId, body)` 封装；C4 区两个项目级按钮替换为 `BondReturnBlock`（同文件内函数组件）：挂载拉清单，行=供应商名（中标行金色「中标」徽标）+ 唱标保证金状态 + 退还态（已退日期绿/不予退+理由红/未登记灰）+ 行内「退还」「不退」（prompt 理由）按钮——样式沿用该弹窗 `neu-btn-soft !h-[26px]` 系。旧项目级 API 保留不删，UI 全面切逐家。
- [ ] **Step 2: 验证 + 提交**：`pnpm --filter web exec tsc --noEmit`。
```bash
git add apps/web/src/lib/api/contract.ts apps/web/src/components/contracts/contract-stage-modal.tsx
git commit -m "feat(p1-wave4): A-105 :3005 合同弹窗保证金逐家退还——项目级双按钮换逐家行（中标标识/唱标状态/退还态/逐家登记）"
```

---

### Task 16: 搭车四小项（波3 终审缓修）

**Files:**
- Modify: `apps/api/src/bid/dto/bond-ledger.dto.ts`（:10-12 `@Max(1e12)` → `@Max(999999999999.99)`；spec 断言 1e13 与 1e12 双拒）
- Modify: `apps/bid-portal/src/components/opening-hall.tsx`（:541 `note: note.trim() || undefined` → `note: note.trim()`——空串显式清除旧备注；后端 `dto.note ?? null` 空串落库为空串，展示 `|| '—'` 不变）
- Modify: `packages/shared/src/bond-compliance.ts`（无改动——反向维已在）；`apps/api/src/bid/bond-compliance.spec.ts` +1 用例：`payMethod:'转账'` + `bondStatus:'保函有效'` → PAY_METHOD
- Modify: `apps/api/src/bid/bid.service.spec.ts`（+reuploadBidFile 重置专属用例：mock 事务后断 `decryptedAt: null` data 形状——参照 resealBidFiles 用例写法）

- [ ] **Step 1: 四处小改 + 各自用例** → `pnpm --filter api test -- bond-ledger.dto bond-compliance bid.service` + `pnpm --filter bid-portal exec tsc --noEmit`
- [ ] **Step 2: 提交**：
```bash
git add apps/api/src/bid/dto/bond-ledger.dto.ts apps/api/src/bid/dto/bond-ledger.dto.spec.ts apps/bid-portal/src/components/opening-hall.tsx apps/api/src/bid/bond-compliance.spec.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(p1-wave4): 搭车收口——台账 @Max 精确上限 999999999999.99、note 空串可清除、PAY_METHOD 反向维用例、reuploadBidFile 重置专属用例（波3 终审缓修四项）"
```

---

### Task 17: 审计报告注记 + 验收收尾

**Files:**
- Modify: `docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md`（勘误头波4 行 + 7 行注记）

- [ ] **Step 1: 勘误头**（波2/波3 行后）：
> **波4 注记（2026-09-XX）**：§P1 剩余七项（A-87/A-89/A-105/A-129/A-132/A-151/A-152）当日整改落地（计划 `docs/superpowers/plans/2026-09-02-p1-wave4-full-batch.md`，提交 <起>..<止>），见 §P1 表注记；P1 至此全部闭合（A-130 归公共服务平台对接专项）；★ 层与 ★★ 层 P1 缺口清零。
- [ ] **Step 2: 七行注记**（各检测行缺口列尾「✅ 已整改（日期 波4，提交号；一句话）」）——A-87 供应商端要点清单；A-89 PDF 版式强制（自声明口径：PDF 满足，OFD 待商业组件）；A-105 逐家退还+定标联动；A-129 区域/等级+配额过滤；A-132 分工+报告名单扩列；A-151 章节附注编辑；A-152 平台自签 SM2 电子签名（专家=企业内部人员自建证书口径 + 手写扫描降级为可选补充）。
- [ ] **Step 3: 提交**：
```bash
git add "docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md"
git commit -m "docs(p1-wave4): 审计报告七项注记整改落地（波4）+ 勘误头补波4 行——P1 全闭合"
```

---

## 验收清单（全部任务完成后）

1. `pnpm --filter api test` 相关套件全绿（新增/扩展：expert-admin/bid.service/expert.service/sign-packet/supplier-portal/bond-*）；`pnpm --filter api lint` 0 error；`pnpm --filter api build` 成功。
2. 四前端 app `exec tsc --noEmit` 全 exit 0（web/expert-portal/bid-portal/supplier-portal-next）。
3. `npx prisma validate` + `migrate status` 干净（本次迁移 applied）。
4. 浏览器验收（控制者执行）：①:3005 抽取配额带区域/等级过滤 + 步骤5 分工下拉保存 → 报告名单 7 列；②:3007 签字包「报告附注」编辑→生成→docx 各节附注可见；③专家门户（李自繁）报告步骤：创建软证书→PIN 签署→:3007 签字表「电子签名」徽标+闭环横幅计数→回流包下载含电子签名摘要；④供应商投标详情页「招标文件要点」卡（英雄项目 READY 三分组清单）；⑤投递页传 docx 标书被拒+指引、传 PDF 通过；⑥:3005 合同弹窗逐家退还两家（一退一不退）→开标记录保证金列变已退还/不予退还→发中标通知书后 staff 收到未中标退还提醒一次。
5. A-87 演示前置：`pnpm --filter api dev:worker:ai-bid-analysis` 在跑（英雄项目已有数据可直接展示）。
6. 审计注记核对。

## 任务间依赖

T1 → 全部（schema）。T2→T3、T4→T5、T6→T7、T8→T9、T11→T12→T13、T14→T15 严格成对；T10 独立（仅 submit 页+投递校验，与 T8/T9 同文件不同区域——仍按序串行）。执行顺序 1→17 严格串行（T2/T4/T6/T8/T11/T14 均动 expert-admin/bid 域共享文件与其 spec，并行互踩）。

## 风险与回归点

- `expert-admin.service.ts` 2841 行：T2/T4 两轮窄改，每步跑 `-- expert-admin` 防回归。
- expert-portal 引 ukey 是**新增 workspace 依赖**：lockfile 只允许该条目变动；若 dev 启动报 `require is not defined`（sm-crypto CJS），Next 16 Turbopack 下按 supplier-portal-next 现场同款处理（其已在 Next 下正常用 ukey，抄其 next.config/transpile 配置——report 记录）。
- A-87 发布钩子跨模块（announcement→AiBidAnalysis 队列）：以注入队列+最小 upsert 为兜底路径，绝不引入 announcement→BidModule 强依赖；发布失败回滚不受钩子 `.catch` 影响。
- A-89 后端扩展断言依赖密文上传的文件名保留——Step 2 已列两条实现路径，实现者必须先读 `dual-envelope.ts`/`upload.service` 落名逻辑再选，report 说明。
- A-152 重生成签字包重置 esignature 后，专家需重签（签名绑 packetSha256，旧签名对新包天然无效——双保险）。
- 共享 dev DB 迁移后再生成 client；并行会话若同时提交 schema 改动，按约定等其工作区干净再动 T1。
