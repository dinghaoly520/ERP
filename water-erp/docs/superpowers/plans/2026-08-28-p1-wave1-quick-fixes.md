# P1 整改波1（快速批 6 项）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地审计报告《附录A功能检测对照报告-投标开标评标-2026-08-28》§P1 中零 schema、零业务决策的 6 项整改：A-94（投标 DTO 服务端校验）、A-88（草稿删除）、A-98（服务器标准时钟）、A-101（回执查看+U盾补签）、A-100（接收列表按递交时间排序）、A-136（专家端澄清修改文件）。

**Architecture:** 全部为存量端点/页面的窄改：2 个后端校验/删除端点 + 1 个排序 util 复用到两处 + 1 组专家端新只读端点 + 3 个供应商门户前端改动（时钟组件、回执卡、草稿删除钮）+ 1 个专家门户前端区块。零 Prisma 迁移、零共享包改动。

**Tech Stack:** NestJS 11 + class-validator（全局 ValidationPipe whitelist:true）/ Next.js 16 App Router + React 19 / @water-erp/ukey（SM2 签名）/ @water-erp/shared（server-clock）。

**Spec:** 无独立 spec——设计即审计报告 §P1 表对应 6 行（`docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md` §五）+ 用户在会话中确认的波1 分批方案。冲突时以审计报告补齐思路列为准。

## Global Constraints

- **零 schema 迁移**：波1 承诺不改 `apps/api/prisma/schema.prisma`（改了即违反分批前提，返工）。
- **whitelist 剥落陷阱（最高风险）**：全局 `ValidationPipe({ whitelist: true, transform: true })` 会静默剥落 DTO 中无 class-validator 装饰器的字段。新增 DTO **每个透传字段都必须有装饰器**（嵌套宽松结构用 `@IsObject()`）；字符串字段空串 `""` 须 `@Transform` 转 `undefined` 才能跳过 `@IsOptional` 校验。
- **下载链接禁用 `rel="noreferrer"`**（丢 Referer → portal 识别失败 401）；用 `rel="noopener"` 或 blob 下载。
- **供应商门户 :3004 前端风格**：沿用 `sp-*`/`neu-*` 类名体系与 `@/components/ui`（SpDialog/SpButton 等）；专家门户 :3006 用其自有 `exp-*` 体系。不引入 cgzxui。
- **提交纪律**：每任务一提交；只 `git add` 本任务明确文件路径（禁 `git add -A`）；不主动 `git push`（用户明示才推）。
- **API 构建从 workspace 根**：`pnpm --filter api build`（apps/api 目录内跑会 deps-check 失败）；lint 用 `pnpm --filter api lint`。
- 单测与源码同目录（`*.spec.ts`）；服务测例优先测纯函数/helper，Prisma 交互测例只测门控分支（mock prisma，参照既有 spec 文件风格）。
- 完成每个任务后：`pnpm --filter api test -- <spec>` 绿 + `pnpm --filter api lint` 绿 + 涉及前端 app 的 `pnpm --filter <app> exec tsc --noEmit`（或该 app 的 tsc 检查命令）绿。
- 受保护证据类目（`upload-categories.ts` 中 EVIDENCE_PROTECTED_CATEGORIES）不碰；本计划不改 `upload.service.ts` 的 `canAccessFile`。

---

### Task 1: A-94 投标草稿/递交 DTO 服务端格式校验

**背景**：`POST /api/supplier-portal/bid-submissions/:projectId/draft|submit` 目前控制器裸收内联 `body` 类型（`supplier-portal.controller.ts:400-441`），无任何 class-validator 校验——`bidPrice`/`deliveryPeriod` 为自由字符串。检测点 A-94 要求主要数据项内容与格式校验。

**Files:**
- Create: `apps/api/src/supplier-portal/dto/bid-submission.dto.ts`
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts:400-441`（draft/submit 两端点换 DTO）
- Test: `apps/api/src/supplier-portal/dto/bid-submission.dto.spec.ts`
- Test: `apps/api/test/supplier.e2e-spec.ts`（追加 1 个用例）

**Interfaces:**
- Consumes: 服务层既有 `saveBidDraft(supplierId, projectId, data: BidSubmissionData)` / `submitBid(...)` 签名不变——DTO 仅替换控制器 `@Body()` 类型，透传给服务层。
- Produces: `SaveBidDraftDto`、`SubmitBidDto`（后者 extends 前者 + envelope/signature）。Task 2 的 DELETE 端点与本文无关。

- [ ] **Step 1: 写失败测试**（`bid-submission.dto.spec.ts`，直接用真实管道验证剥落/透传行为——这是防「字段蒸发」的关键测试）：

```ts
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { SaveBidDraftDto, SubmitBidDto } from './bid-submission.dto';

describe('bid-submission.dto（A-94：whitelist 下字段透传 + 格式校验）', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const transform = (value: any, metaType: any) =>
    pipe.transform(value, { type: 'body', metatype: metaType } as any);

  it('合法草稿：全部字段透传（splitFiles/clientDeks 不得被 whitelist 剥落）', async () => {
    const body = {
      bidPrice: '1260.5', deliveryPeriod: '90 日历天', qualityCommitment: '合格',
      technicalFile: '技术标说明', businessFile: '', coverLetter: '投标函',
      technicalFileAssetId: 'ck8abc123', bidBondAssetId: 'ck8bond456',
      fullBidFileAssetId: 'ck8full789', coverLetterFileAssetId: 'ck8cover012',
      splitFiles: { tech: { assetId: 'a1' }, biz: { assetId: 'a2' }, other: { assetId: 'a3' } },
      clientDeks: { 'ck8abc123': 'aa:bb:cc' },
    };
    const dto = await transform(body, SaveBidDraftDto) as SaveBidDraftDto;
    expect(dto.bidPrice).toBe('1260.5');
    expect(dto.deliveryPeriod).toBe('90 日历天');
    expect(dto.splitFiles).toEqual({ tech: { assetId: 'a1' }, biz: { assetId: 'a2' }, other: { assetId: 'a3' } });
    expect(dto.clientDeks).toEqual({ 'ck8abc123': 'aa:bb:cc' });
    expect(dto.businessFile).toBeUndefined(); // 空串 → undefined（@Transform）
  });

  it.each(['abc', '12,600', '-5', '1.23456', '12.6万元'])('非法报价 %s → 400', async (bad) => {
    await expect(transform({ bidPrice: bad }, SaveBidDraftDto)).rejects.toThrow(BadRequestException);
  });

  it('报价空串/缺省 → 放行（视为未填）', async () => {
    const dto = await transform({ bidPrice: '' }, SaveBidDraftDto) as SaveBidDraftDto;
    expect(dto.bidPrice).toBeUndefined();
  });

  it('工期超长 → 400；未知属性被剥落', async () => {
    await expect(transform({ deliveryPeriod: 'x'.repeat(51) }, SaveBidDraftDto)).rejects.toThrow(BadRequestException);
    const dto = await transform({ deliveryPeriod: '90天', hackerField: 'x' }, SaveBidDraftDto) as SaveBidDraftDto;
    expect((dto as any).hackerField).toBeUndefined();
  });

  it('SubmitBidDto：envelope/signature 透传', async () => {
    const dto = await transform({
      envelope: { version: 'dual-v2', files: {} }, signature: 'MEUCIQ==signature',
    }, SubmitBidDto) as SubmitBidDto;
    expect(dto.envelope).toEqual({ version: 'dual-v2', files: {} });
    expect(dto.signature).toBe('MEUCIQ==signature');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**：`pnpm --filter api test -- bid-submission.dto` → 模块不存在报错。

- [ ] **Step 3: 写 DTO**（`bid-submission.dto.ts`）：

```ts
import { IsObject, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * A-94：投标草稿/递交服务端格式校验（此前 /draft /submit 裸收 body 无校验）。
 * 注意：全局 ValidationPipe whitelist:true 会剥落无装饰器字段——每个透传字段都必须有装饰器，
 * 否则静默蒸发（splitFiles/clientDeks/envelope 用 @IsObject() 放行嵌套结构）。
 */
export class SaveBidDraftDto {
  /** 投标报价：数字字符串（前端口径 万元或元，≥10000 视为元），≤4 位小数 */
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional()
  @Matches(/^\d{1,12}(\.\d{1,4})?$/, { message: '投标报价须为不超过 4 位小数的数字' })
  bidPrice?: string;

  /** 工期：自由文本（如「90 日历天」），只做长度校验 */
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value?.trim()))
  @IsOptional()
  @IsString()
  @Length(1, 50, { message: '工期须为 1-50 字符' })
  deliveryPeriod?: string;

  @IsOptional() @IsString() @MaxLength(500) qualityCommitment?: string;
  @IsOptional() @IsString() @MaxLength(500) technicalFile?: string;
  @IsOptional() @IsString() @MaxLength(500) businessFile?: string;
  @IsOptional() @IsString() @MaxLength(500) coverLetter?: string;

  @IsOptional() @IsString() @MaxLength(64) technicalFileAssetId?: string;
  @IsOptional() @IsString() @MaxLength(64) businessFileAssetId?: string;
  @IsOptional() @IsString() @MaxLength(64) coverLetterAssetId?: string;
  @IsOptional() @IsString() @MaxLength(64) bidBondAssetId?: string;
  /** P0-1 完整/拆分模型别名（服务层 normalizeBidFileAssets 归一） */
  @IsOptional() @IsString() @MaxLength(64) fullBidFileAssetId?: string;
  @IsOptional() @IsString() @MaxLength(64) coverLetterFileAssetId?: string;

  /** P0-1 前端完整/拆分模型（服务层归一到三角色契约）——嵌套结构宽松放行 */
  @IsOptional() @IsObject() splitFiles?: { tech?: any; biz?: any; other?: any };
  /** E2EE 客户端加密密钥（assetId → "keyHex:ivHex:authTagHex"） */
  @IsOptional() @IsObject() clientDeks?: Record<string, string>;
}

/** 递交在草稿字段之上增加双信封 v2 信封与证书签名（服务层验签） */
export class SubmitBidDto extends SaveBidDraftDto {
  @IsOptional() @IsObject() envelope?: any; // DualEnvelope（@water-erp/ukey 类型，仅类型引用避免循环依赖）
  @IsOptional() @IsString() @MaxLength(4096) signature?: string;
}
```

- [ ] **Step 4: 控制器接线**：`supplier-portal.controller.ts` 两端点签名换 `@Body() dto: SaveBidDraftDto` / `@Body() dto: SubmitBidDto`，方法体把 `body` 改为 `dto`（服务层入参 `dto as any` 或直接传，服务层 `BidSubmissionData` 类型兼容即可）；文件头部 import 新 DTO。**不改动其它端点。**

- [ ] **Step 5: 单测绿**：`pnpm --filter api test -- bid-submission.dto`。

- [ ] **Step 6: e2e 回归用例**：`apps/api/test/supplier.e2e-spec.ts` 追加（沿用该文件既有登录/项目 fixture 风格；若无现成草稿用例可参照同文件其他 POST 用例取 supplier 登录 cookie 与项目 id）：
  - POST draft `bidPrice: 'abc'` → 400；POST draft 全字段（含 `splitFiles`/`clientDeks`）→ 200 且 GET 回读 `splitFiles`/`clientDeks` 在（防剥落回归）；POST draft `bidPrice: ''` → 200。
  - 若 e2e 环境无可用项目 fixture，则只加「非法报价 400」用例并在报告注明。

- [ ] **Step 7: 全量验证 + 提交**：`pnpm --filter api lint` → `pnpm --filter api test`（全量）→ 提交：
```bash
git add apps/api/src/supplier-portal/dto/bid-submission.dto.ts apps/api/src/supplier-portal/dto/bid-submission.dto.spec.ts apps/api/src/supplier-portal/supplier-portal.controller.ts apps/api/test/supplier.e2e-spec.ts
git commit -m "feat(p1-wave1): A-94 投标草稿/递交服务端 DTO 校验——bidPrice 数字格式(≤4位小数)/工期长度/全字段 whitelist 透传(splitFiles/clientDeks/envelope @IsObject 防剥落)；空串 Transform 转未填"
```

---

### Task 2: A-88 投标草稿删除端点 + 前端删除入口

**背景**：检测点 A-88「在线/离线编辑、删除、查看投标文件」——草稿可保存可回读但无删除入口。草稿=`SupplierBidSubmission` 行（`status='draft'`，唯一键 `supplierId_projectId`）。已提交的删除属「撤回」既有通道（`withdrawSubmission`），不属本任务。

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（新增 DELETE 端点）
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（新增 `deleteBidDraft`）
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx`（草稿区加「删除草稿」）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（若无此文件则新建，参照同目录其它 spec 的 prisma mock 风格）

**Interfaces:**
- Consumes: 既有私有方法 `assertCanSaveBidDraft(supplierId, projectId)`（截止/阶段闸门与保存草稿一致——截止后不可删，对齐 A-92 口径）。
- Produces: `DELETE /api/supplier-portal/bid-submissions/:projectId/draft` → `{ deleted: true }`；错误码 `DRAFT_NOT_FOUND`(400) / `DRAFT_NOT_DELETABLE`(400)。

- [ ] **Step 1: 写失败测试**（service spec，mock `this.prisma.supplierBidSubmission`；`assertCanSaveBidDraft` 用 jest.spyOn mock 放行）：

```ts
describe('deleteBidDraft（A-88）', () => {
  it('draft 草稿 → 删除成功', async () => {
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ id: 'sub1', status: 'draft' });
    prisma.supplierBidSubmission.delete.mockResolvedValue({ id: 'sub1' });
    await expect(service.deleteBidDraft('sup1', 'proj1')).resolves.toEqual({ deleted: true });
    expect(prisma.supplierBidSubmission.delete).toHaveBeenCalledWith({ where: { id: 'sub1' } });
  });
  it('不存在 → 400 DRAFT_NOT_FOUND', async () => {
    prisma.supplierBidSubmission.findUnique.mockResolvedValue(null);
    await expect(service.deleteBidDraft('sup1', 'proj1')).rejects.toThrow(BadRequestException);
  });
  it('已提交 → 400 DRAFT_NOT_DELETABLE（须走撤回）', async () => {
    prisma.supplierBidSubmission.findUnique.mockResolvedValue({ id: 'sub1', status: 'submitted' });
    await expect(service.deleteBidDraft('sup1', 'proj1')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 服务端实现**——`supplier-portal.service.ts` 紧邻 `saveBidDraft` 后新增：

```ts
/** A-88：删除未递交的投标草稿。与保存草稿同闸门（截止前）；已提交须走撤回（withdrawSubmission）。 */
async deleteBidDraft(supplierId: string, projectId: string) {
  await this.assertCanSaveBidDraft(supplierId, projectId);
  const existing = await this.prisma.supplierBidSubmission.findUnique({
    where: { supplierId_projectId: { supplierId, projectId } },
  });
  if (!existing) throw new BadRequestException({ error: '草稿不存在', code: 'DRAFT_NOT_FOUND' });
  if (existing.status !== 'draft') {
    throw new BadRequestException({ error: '已递交的标书不可删除，请使用撤回', code: 'DRAFT_NOT_DELETABLE' });
  }
  await this.prisma.supplierBidSubmission.delete({ where: { id: existing.id } });
  return { deleted: true };
}
```

控制器（紧邻 draft 端点后）：

```ts
/** A-88：删除未递交的投标草稿（已提交走撤回） */
@Delete('bid-submissions/:projectId/draft')
async deleteBidDraft(@Request() req: any, @Param('projectId') projectId: string) {
  const supplierId = await this.getSupplierId(req.user.sub);
  return this.portalService.deleteBidDraft(supplierId, projectId);
}
```

（`Delete` 若未 import 从 `@nestjs/common` 补。）

- [ ] **Step 4: 单测绿 + lint**。

- [ ] **Step 5: 前端**——`submit/page.tsx`：找到「保存草稿」按钮所在操作区（草稿状态区），同排追加次级按钮「删除草稿」；点击弹确认（用该 app 既有确认模式：优先 `SpDialog`，参照 `bids/[id]/page.tsx` 中的 SpDialog 用法；若该文件未引入则从 `@/components/ui` 引入）；确认后调用供应商 API 封装（`@/lib/api/bid` 的 `bidApi` 或现有 fetch 封装，与保存草稿同一路径前缀）`DELETE /supplier-portal/bid-submissions/:projectId/draft`；成功后 toast「草稿已删除」、清空表单各字段与本地自动草稿缓存（若该页有 localStorage 自动草稿逻辑一并清）、回读 submission 置空。失败（404/400）toast 展示服务端 error 文案。

- [ ] **Step 6: 验证 + 提交**：`pnpm --filter supplier-portal-next exec tsc --noEmit` 绿（或该 app 既有 tsc 检查命令；如 package.json 无 scripts 则用 `pnpm --filter supplier-portal-next exec tsc --noEmit`）。提交：
```bash
git add apps/api/src/supplier-portal/supplier-portal.controller.ts apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts apps/supplier-portal-next/src/app/\(main\)/bids/\[id\]/submit/page.tsx
git commit -m "feat(p1-wave1): A-88 投标草稿删除——DELETE /bid-submissions/:projectId/draft（与保存同截止闸门、仅 draft 可删、已提交提示走撤回）+ 投递页删除草稿确认交互"
```

---

### Task 3: A-98 服务器标准时间动态显示 + 预检统一 serverNowMs

**背景**：检测点 A-98「动态显示国家授时中心当前时间」。`@water-erp/shared` 已有 `syncServerClock()/serverNow()/serverNowMs()/clockSyncedAt()`（`packages/shared/src/server-clock.ts`，半程 RTT 补偿），但供应商门户仅 `countdown-timer.tsx` 使用；`bids/page.tsx:28,41` 与 `bids/[id]/page.tsx:114` 的截止预检仍用本地 `Date.now()`；且无「当前标准时间」常显组件。开标端 :3007 已有服务器对时展示（审计 A-108/A-110 ✅），本任务只改供应商门户。

**Files:**
- Create: `apps/supplier-portal-next/src/components/server-clock.tsx`
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/page.tsx`（挂时钟条 + 28/41 行换 serverNowMs）
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx`（挂时钟条 + 114 行换 serverNowMs）

**Interfaces:**
- Consumes: `@water-erp/shared` 的 `syncServerClock/serverNow/serverNowMs/clockSyncedAt`（已构建进 dist，无需重 build；若 import 报错则先 `pnpm --filter @water-erp/shared build`）。
- Produces: `<ServerClock />` 组件（Task 4 的回执卡可复用同页展示，无强依赖）。

- [ ] **Step 1: 组件**（`server-clock.tsx`，dayjs 该 app 已有）：

```tsx
"use client";
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { clockSyncedAt, serverNow, syncServerClock } from "@water-erp/shared";

/**
 * A-98：服务器标准时间动态显示。客户端本地时钟可篡改——本组件锚定 /api/time
 * （syncServerClock 半程 RTT 补偿），秒级刷新；未同步成功前灰点+退化本地时间。
 */
export function ServerClock() {
  const [now, setNow] = useState<Date | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    void syncServerClock().then(() => {
      setSynced(clockSyncedAt() > 0);
      setNow(serverNow());
    });
    setNow(serverNow()); // 首帧即时渲染（未同步=本地时间兜底）
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="sp-clock" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span
        aria-hidden
        style={{
          width: 6, height: 6, borderRadius: "50%",
          background: synced ? "var(--sp-success, #16a34a)" : "#9ca3af",
        }}
      />
      服务器标准时间
      <strong style={{ fontFamily: "var(--sp-mono, monospace)" }}>
        {now ? dayjs(now).format("YYYY-MM-DD HH:mm:ss") : "--"}
      </strong>
    </span>
  );
}
```

（内联样式为保底；若 bids 页已有更贴合的样式类（`sp-*`）可改用，不强求新 CSS。）

- [ ] **Step 2: 挂载与预检替换**：
  - `bids/page.tsx`：列表页工具栏/页头行挂 `<ServerClock />`（import 从 `@/components/server-clock`）；`:28` `(new Date(deadline).getTime() - Date.now())` 与 `:41` `const now = Date.now()` → `serverNowMs()`（import from `@water-erp/shared`）。
  - `bids/[id]/page.tsx`：meta 信息行（「投标截止」附近）挂 `<ServerClock />`；`:114` `new Date(project.deadline) > new Date()` → `new Date(project.deadline).getTime() > serverNowMs()`。
  - 注意：页面若同时已有 `countdown-timer`（内部也会 syncServerClock），重复调用无害（inflight 去重）。

- [ ] **Step 3: 验证 + 提交**：`pnpm --filter supplier-portal-next exec tsc --noEmit` 绿。提交：
```bash
git add apps/supplier-portal-next/src/components/server-clock.tsx apps/supplier-portal-next/src/app/\(main\)/bids/page.tsx apps/supplier-portal-next/src/app/\(main\)/bids/\[id\]/page.tsx
git commit -m "feat(p1-wave1): A-98 供应商门户服务器标准时间常显（ServerClock 组件 /api/time 半程补偿）+ 投标列表/详情截止预检统一 serverNowMs 弃本地时钟"
```

---

### Task 4: A-101 投标回执供应商端查看 + U盾补签

**背景**：检测点 A-101「投标回执+回执电子签名」。后端完备：`GET /bid-submissions/:submissionId/receipt-payload`（服务端重建 canonical）+ `POST /bid-submissions/:submissionId/receipt-signature`（SM2/SM3 验签存档幂等，`supplier-portal.service.ts:165-215`；验签公钥=`Supplier.sm2PublicKey`）。缺的只是供应商端界面：回执查看（编号/负载摘要/签名状态）与补签入口。U盾签名交互**照抄同目录 `bids/[id]/clarifications/page.tsx`**（A-143 已建：`openUkey` from `@/utils/ukey-factory`、`UKeyAdapter` from `@water-erp/ukey`、PIN 弹窗 SpDialog、certSn 优先本地缓存 `supplier_ukey_bound.certSn` 兜底服务端 ACTIVE 绑定、服务端 `ServerCertRow {certSn, bindingStatus}`）。

**Files:**
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx`（投标详情页：已递交状态下加「投标回执」卡 + 未签署时「签署回执（U盾）」）
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/page.tsx`（列表行加回执签署徽标，轻量）

**Interfaces:**
- Consumes: 既有端点 `GET/POST /api/supplier-portal/bid-submissions/:submissionId/receipt-payload|receipt-signature`；`GET /api/supplier-portal/bid-submissions/:projectId`（`getSubmission` 返回全行含 `id/receiptNo/receiptSignature(Json)/receiptSignedAt/submittedAt/status`）；clarifications 页的 U盾会话建立代码块。
- Produces: 无新端点（纯前端）。

- [ ] **Step 1: 详情页回执卡**——`bids/[id]/page.tsx` 在已递交（submission.status === 'submitted'）展示区追加卡片「投标回执」：
  - 字段：回执编号 `submission.receiptNo`（空则「待生成」）、递交时间 `submission.submittedAt`（dayjs 格式化）、签名状态：`submission.receiptSignature` 存在 → 「已电子签名（SM2/SM3 · 验签时间 {receiptSignature.verifiedAt}）」；否则 → 「未签署」+ 主按钮「签署回执（U盾）」。
  - 签署流程（复刻 clarifications 页，步骤）：
    1. `GET /supplier-portal/bid-submissions/${submission.id}/receipt-payload` → `{ payload, canonical }`（负载含 filesCommit/receivedAt，卡片可折叠展示 payload JSON 供核验）。
    2. 弹 PIN 对话框（SpDialog）→ `openUkey(password)` 得 adapter；certSn 解析顺序照抄 clarifications 页（localStorage `supplier_ukey_bound.certSn` → 服务端 ACTIVE `ServerCertRow` 首条）。
    3. `adapter.sign(certSn, canonical)`（若 API 名不同以 clarifications 页实际调用为准）→ `POST receipt-signature { signature }`。
    4. 成功：toast「回执已签署」+ 重取 submission 刷新卡片；400 `RECEIPT_SIGNATURE_INVALID` → toast 验签失败请重试；400 `SM2_PUBLIC_KEY_MISSING` → toast「请先在 U盾管理页绑定数字证书」；403 → toast error 文案。
  - 幂等：若中途服务端已签（幂等返回），刷新后按已签署展示。

- [ ] **Step 2: 列表页徽标**——`bids/page.tsx` 已递交行状态区加小徽标：`receiptSignature` ? 「回执已签」 : 「回执未签」（数据源若列表接口未含 receiptSignature，则行内不展示、仅详情页可见，并在报告注明——**不得为徽标新增后端字段透传**之外的改动；若列表行数据来自 `bidApi` 列表端点且无该字段，跳过 Step 2）。

- [ ] **Step 3: 验证 + 提交**：`pnpm --filter supplier-portal-next exec tsc --noEmit` 绿。提交：
```bash
git add apps/supplier-portal-next/src/app/\(main\)/bids/\[id\]/page.tsx apps/supplier-portal-next/src/app/\(main\)/bids/page.tsx
git commit -m "feat(p1-wave1): A-101 供应商端投标回执查看卡（编号/递交时间/签名状态/负载核验）+ 未签署 U盾补签（复用 receipt-payload/signature 端点与 A-143 同款 PIN 弹窗）"
```

---

### Task 5: A-100 平台端接收列表按递交时间排序

**背景**：检测点 A-100「文件接收、校验、按接收时间排序」。`BidService.getWorkspace`（`bid.service.ts:557`，:3005 开标确认面板与 :3007 工作区共同数据源）与 `buildOpeningHandoverPackage`（`bid.service.ts` ~1086，开标文件包）的供应商行均按名册 `createdAt` 排序，未按递交时间。排序语义（本计划裁定）：**已递交（按 submittedAt 升序）在前 → 未递交（保持名册序）居中 → 已撤回（按 submittedAt 升序）殿后**；JS sort 稳定（V8），未递交组内保持名册序。

**Files:**
- Create: `apps/api/src/bid/supplier-row-order.util.ts`（纯函数，两处复用 + 可测）
- Modify: `apps/api/src/bid/bid.service.ts`（`getWorkspace` supplierRows 排序 + `buildOpeningHandoverPackage` 同排序）
- Test: `apps/api/src/bid/supplier-row-order.util.spec.ts`

**Interfaces:**
- Produces: `sortSupplierRowsBySubmission<T extends { submitted: boolean; withdrawn: boolean; submission: { submittedAt: Date | string | null } | null }>(rows: T[]): T[]`（原位稳定排序并返回）。两个调用方行结构均满足该形状（getWorkspace 行有 `submitted/withdrawn/submission.submittedAt`；文件包行需实现时补齐同形状判断——见 Step 3）。

- [ ] **Step 1: 写失败测试**：

```ts
import { sortSupplierRowsBySubmission } from './supplier-row-order.util';

const row = (name: string, submitted: boolean, withdrawn: boolean, at: string | null) =>
  ({ name, submitted, withdrawn, submission: at ? { submittedAt: at } : null });

describe('sortSupplierRowsBySubmission（A-100 按接收时间排序）', () => {
  it('已递交按 submittedAt 升序在前；未递交保持名册序；已撤回殿后', () => {
    const rows = [
      row('甲', false, false, null),                    // 名册1 未投
      row('乙', true, false, '2026-08-28T10:02:00Z'),   // 第二个递交
      row('丙', true, false, '2026-08-28T10:01:00Z'),   // 第一个递交
      row('丁', false, false, null),                    // 名册2 未投
      row('戊', true, true, '2026-08-28T09:00:00Z'),    // 已撤回
    ];
    expect(sortSupplierRowsBySubmission(rows).map(r => r.name)).toEqual(['丙', '乙', '甲', '丁', '戊']);
  });
  it('空数组/全未投原样返回', () => {
    expect(sortSupplierRowsBySubmission([])).toEqual([]);
    const rows = [row('甲', false, false, null), row('乙', false, false, null)];
    expect(sortSupplierRowsBySubmission(rows).map(r => r.name)).toEqual(['甲', '乙']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败 → 实现 util**：

```ts
/**
 * A-100：平台端接收列表按接收时间排序。
 * 组序：已递交(submittedAt 升序) → 未递交(名册序) → 已撤回(submittedAt 升序)。
 * Array.prototype.sort 在 V8 稳定——未递交组内名册顺序保持。
 */
export interface SubmissionOrderedRow {
  submitted: boolean;
  withdrawn: boolean;
  submission: { submittedAt: Date | string | null } | null;
}

export function sortSupplierRowsBySubmission<T extends SubmissionOrderedRow>(rows: T[]): T[] {
  const group = (r: T) => (r.submitted ? 0 : !r.withdrawn ? 1 : 2);
  const ts = (r: T) => (r.submission?.submittedAt ? new Date(r.submission.submittedAt).getTime() : 0);
  return rows.sort((a, b) => (group(a) - group(b)) || (ts(a) - ts(b)));
}
```

- [ ] **Step 3: 接线两处**：
  - `getWorkspace`：`supplierRows` map 完成后、`return { project, suppliers: supplierRows, ... }` 前调用 `sortSupplierRowsBySubmission(supplierRows)`。
  - `buildOpeningHandoverPackage`：该处 `suppliers` 行结构没有 `submitted/withdrawn`——先看其 submissions 查询（当前 select `{ supplierId, envelopeVersion, decryptedAssets }`），**给该 select 追加 `status: true, submittedAt: true`**（零 schema 改动，仅查询列），构建行时补 `submitted: sub?.status === 'submitted'`、`withdrawn: sub?.status === 'withdrawn'`、`submission: sub ? { submittedAt: sub.submittedAt } : null` 三字段参与排序，**文件包输出字段不变**（排序用的临时字段在组装输出对象前剥离，或在排序后 map 回原形状——以不改变文件包 JSON 结构为准）。

- [ ] **Step 4: 验证 + 提交**：`pnpm --filter api test -- supplier-row-order` 绿 → `pnpm --filter api lint` → 提交：
```bash
git add apps/api/src/bid/supplier-row-order.util.ts apps/api/src/bid/supplier-row-order.util.spec.ts apps/api/src/bid/bid.service.ts
git commit -m "feat(p1-wave1): A-100 接收列表按递交时间排序——getWorkspace 与开标文件包供应商行统一 sortSupplierRowsBySubmission（已递交按接收时间升序/未投保持名册序/已撤回殿后）"
```

---

### Task 6: A-136 专家端澄清与修改文件列表 + 下载

**背景**：检测点 A-136「有效招标文件确认（招标文件+澄清修改文件）」——招标文件专家可下载（`expert.controller.ts:246` `downloadTenderDocument`，buffer 流式直出+监督日志），但澄清修改文件（`TenderClarificationDoc`）仅供应商端可下载（`tender-clarification.service.ts:246` `downloadDoc`，按 supplier 回执）。专家端「标书获取」步骤在 `apps/expert-portal/src/components/evaluate/documents-step.tsx`（现有「招标文件」区块下追加）。

**附件下载走服务端流式直出**（镜像 `expert.service.downloadTenderDocument` 的 minio 用法），**不改 `upload.service.canAccessFile`**——澄清附件是明文上传件（无信封），服务端读出后直接返回，绕开 /upload 下载授权链，授权已在 `downloadDocForExpert` 门控内完成。

**Files:**
- Modify: `apps/api/src/expert/expert.module.ts`（imports += TenderClarificationModule）
- Modify: `apps/api/src/tender-clarification/tender-clarification.service.ts`（+`listDocsForExpert` / `downloadDocForExpert`）
- Modify: `apps/api/src/expert/expert.controller.ts`（+2 路由，注入 TenderClarificationService）
- Modify: `apps/expert-portal/src/components/evaluate/documents-step.tsx`（+「澄清与修改文件」区块）
- Test: `apps/api/src/tender-clarification/tender-clarification.service.spec.ts`（扩展）

**Interfaces:**
- Consumes: `expert.service.ts` 头部的 minio 直出 import（`minioClient`/`MINIO_BUCKET`/`streamToBuffer`——与该文件同款 import 来源）；`BidExpert`（userId+projectId 归属）；`BidSupervisionLog`（留痕，role='评审专家'）。
- Produces: `GET /api/expert/projects/:projectId/clarification-docs` → `[{ id, version, title, content, publishedAt, fileAssetId }]`；`POST /api/expert/projects/:projectId/clarification-docs/:docId/download` → `{ buffer, fileName, mimeType, title, version, content }`（无附件时 buffer=null）。前端 blob 下载。

- [ ] **Step 1: 写失败测试**（扩展 `tender-clarification.service.spec.ts`，沿用该文件既有 prisma mock 风格）：

```ts
describe('A-136 专家端澄清修改文件', () => {
  it('listDocsForExpert：仅已发布、按 version 升序', async () => {
    prisma.tenderClarificationDoc.findMany.mockResolvedValue([{ id: 'd1', version: 1 }]);
    await service.listDocsForExpert('p1');
    expect(prisma.tenderClarificationDoc.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'p1', status: '已发布' },
      orderBy: { version: 'asc' },
    }));
  });
  it('downloadDocForExpert：非本项目评委 → 403 NOT_PROJECT_EXPERT', async () => {
    prisma.tenderClarificationDoc.findUnique.mockResolvedValue({ id: 'd1', projectId: 'p1', status: '已发布', fileAssetId: null });
    prisma.bidExpert.findFirst.mockResolvedValue(null);
    await expect(service.downloadDocForExpert('p1', 'd1', 'u9')).rejects.toThrow(ForbiddenException);
  });
  it('downloadDocForExpert：未发布/不存在 → 400 NOT_FOUND', async () => {
    prisma.tenderClarificationDoc.findUnique.mockResolvedValue(null);
    await expect(service.downloadDocForExpert('p1', 'dX', 'u1')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败。**

- [ ] **Step 3: 服务实现**——`tender-clarification.service.ts` 末尾新增（minio import 镜像 `expert.service.ts`；监督日志两分支各写一条）：

```ts
/** A-136：专家视角已发布澄清/修改文件列表（评委核对招标文件澄清修改的法定输入）。 */
async listDocsForExpert(projectId: string) {
  return this.prisma.tenderClarificationDoc.findMany({
    where: { projectId, status: '已发布' },
    orderBy: { version: 'asc' },
    select: { id: true, version: true, title: true, content: true, publishedAt: true, fileAssetId: true },
  });
}

/** A-136：专家下载澄清修改文件。门控=本项目 BidExpert；附件服务端流式直出（明文件，无信封，
 *  不经 /upload 下载授权链）；下载写监督日志。无附件（纯正文）同样留痕返回正文。 */
async downloadDocForExpert(projectId: string, docId: string, expertUserId: string) {
  const doc = await this.prisma.tenderClarificationDoc.findUnique({ where: { id: docId } });
  if (!doc || doc.projectId !== projectId || doc.status !== '已发布') {
    throw new BadRequestException({ error: '澄清文件不存在或未发布', code: 'NOT_FOUND' });
  }
  const expert = await this.prisma.bidExpert.findFirst({
    where: { projectId, userId: expertUserId },
    select: { expertName: true },
  });
  if (!expert) throw new ForbiddenException({ error: '仅本项目评标专家可下载', code: 'NOT_PROJECT_EXPERT' });

  const log = () =>
    this.prisma.bidSupervisionLog.create({
      data: {
        projectId, time: new Date(), role: '评审专家', target: expert.expertName,
        action: '下载澄清修改文件', result: `v${doc.version} ${doc.title}`, riskFlag: '无',
      },
    });

  if (doc.fileAssetId) {
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: doc.fileAssetId } });
    if (asset) {
      const objStream = await minioClient.getObject(MINIO_BUCKET, asset.key);
      const buffer = await streamToBuffer(objStream);
      await log();
      return {
        buffer, fileName: asset.originalName, mimeType: asset.mimeType ?? 'application/octet-stream',
        title: doc.title, version: doc.version, content: doc.content,
      };
    }
  }
  await log();
  return { buffer: null, fileName: null, mimeType: null, title: doc.title, version: doc.version, content: doc.content };
}
```

- [ ] **Step 4: 控制器 + 模块**——`expert.controller.ts` 构造器注入 `TenderClarificationService`，追加（放在 `downloadTenderDocument` 之后，响应方式与其完全同款——若该端点用 `@Res()` 流式则照抄，若直接 return 对象也照抄）：

```ts
/** A-136：本项目已发布澄清/修改文件列表（评委核对招标文件修改的法定输入） */
@Get('projects/:projectId/clarification-docs')
async listClarificationDocs(@Param('projectId') projectId: string) {
  return this.clarifications.listDocsForExpert(projectId);
}

/** A-136：专家下载澄清修改文件（服务端直出 + 监督日志） */
@Post('projects/:projectId/clarification-docs/:docId/download')
async downloadClarificationDoc(@Request() req: any, @Param('projectId') projectId: string, @Param('docId') docId: string) {
  return this.clarifications.downloadDocForExpert(projectId, docId, req.user.sub);
}
```

`expert.module.ts` imports 追加 `TenderClarificationModule`（from `../tender-clarification/tender-clarification.module`）。

- [ ] **Step 5: 前端**——`documents-step.tsx`「招标文件」区块下方新增「澄清与修改文件」卡：
  - 挂载时 `GET /expert/projects/${projectId}/clarification-docs`（该组件用的 api 封装与现有一致）。
  - 每行：`v{version}` 徽标 + title + publishedAt + 正文折叠预览（content）+ 「下载附件」按钮（fileAssetId 为空则不显示）。下载 = POST → blob → `a.download = fileName` 保存（不用 window.open，无 noreferrer 问题）。
  - 空态：「暂无澄清修改文件」。加载失败静默降级为空态 + console.warn。

- [ ] **Step 6: 验证 + 提交**：`pnpm --filter api test -- tender-clarification` 绿 → `pnpm --filter api lint` → `pnpm --filter expert-portal exec tsc --noEmit` 绿。提交：
```bash
git add apps/api/src/expert/expert.module.ts apps/api/src/expert/expert.controller.ts apps/api/src/tender-clarification/tender-clarification.service.ts apps/api/src/tender-clarification/tender-clarification.service.spec.ts apps/expert-portal/src/components/evaluate/documents-step.tsx
git commit -m "feat(p1-wave1): A-136 专家端澄清修改文件——list/download 两端点（本项目 BidExpert 门控+监督日志+附件服务端流式直出）+ 标书获取步骤澄清修改文件区块"
```

---

## 验收清单（全部任务完成后）

1. `pnpm --filter api test` 全量绿（新增 spec ≥4 个文件/扩展）；`pnpm --filter api lint` 绿；`pnpm --filter api build`（从 workspace 根）成功。
2. `pnpm --filter supplier-portal-next exec tsc --noEmit` 与 `pnpm --filter expert-portal exec tsc --noEmit` 绿。
3. `npx tsx scripts/list-uncovered-routes.ts` 无新增未覆盖路由（Task 6 新路由在 expert 控制器既有 @Roles 作用域内——控制器类级或方法级标注须确认其一存在，RolesGuard 默认拒绝）。
4. 浏览器冒烟（用户验收阶段）：:3004 投标列表时钟条/详情回执卡与补签/投递页草稿删除；:3006 标书获取步骤澄清文件区；:3005/:3007 供应商列表按递交时间排序。
5. 汇总报告：6 项对照审计条目，注明各端点/页面落点与测试证据。

## 任务间依赖

无强依赖（Task 1 的 DTO 与 Task 2 的端点同文件 `supplier-portal.controller.ts`——顺序执行避免冲突；Task 3/4 同改 `bids/[id]/page.tsx` 与 `bids/page.tsx`，顺序执行）。执行顺序：1 → 2 → 3 → 4 → 5 → 6。
