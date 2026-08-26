# C3 转非招标方式登记——暂停暂存（2026-08-26 并行会话避让）

> **状态：** 因 GB/T 43711 会话并行占用工作区（schema.prisma/app.module/bid.controller/bid-confirm-panel 均有其未提交改动），C3 已按协作约定暂停。对方提交后从本文档恢复。

## 已定设计（勘探完成，可直接落地）

- **模型** `NonTenderDealRecord { bidProjectId @unique, pmItemId?, method(竞争性谈判/询价/单一来源), winnerSupplierId?, winnerName, dealAmount?, fileAssetId?, note?, recordedById?, recordedAt }`
- **服务** `apps/api/src/bid/non-tender-deal.service.ts`：`register()` 守卫=stage==='ABORTED' + 方式枚举 + 一项目一条；成交文件（FileAsset）同步建 `Attachment{attachmentType:'AWARD_NOTICE', projectManagementStageId: AWARD_DECISION 阶段}` 随 ASIP/归档范围机器自动入档；写 `BidSupervisionLog{action:'转非招标方式成交登记'}`；无 PMI/无文件时安全跳过附件
- **控制器** 独立 `non-tender-deal.controller.ts` 挂 bid.module：`POST/GET /api/bid/projects/:id/non-tender-deal`（staff/leader/admin）
- **ASIP 联动** `archive-export.service.ts` 其他/ 目录增「非招标成交记录.json」（按 pmItemId 反查，含方式/成交人/金额/文件名）
- **范围表不加行**（可选项无阻断语义，附件已随档）；UI 挂 AbortDialog（stage ABORTED 后显示登记表单：方式/成交人/金额）
- **迁移**：`npx prisma migrate dev --create-only --name non_tender_deal` → db execute → resolve

## 已写好的失败态测试（恢复时原样放回 apps/api/src/bid/）

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { NonTenderDealService } from './non-tender-deal.service';

/** C3 转非招标方式成交登记（CTS-EBS01 A-199）：流标→非招标成交→入归档链 */
describe('NonTenderDealService（C3 A-199）', () => {
  const aborted = { id: 'bp-1', stage: 'ABORTED', projectManagementItemId: 'pmi-1', round: 1, name: '水厂滤料采购' };
  const dto = { method: '竞争性谈判', winnerName: '华西物资', dealAmount: 128000, note: '两家有效报价转谈判' };

  const mk = (over: Record<string, any> = {}) => ({
    bidProject: { findUnique: jest.fn().mockResolvedValue(aborted) },
    nonTenderDealRecord: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'nd-1', ...dto }) },
    fileAsset: { findUnique: jest.fn() },
    projectManagementStage: { findFirst: jest.fn().mockResolvedValue({ id: 'st-award' }) },
    attachment: { create: jest.fn().mockResolvedValue({ id: 'att-1' }) },
    bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    ...over,
  });

  it('流标项目登记成功：结构化记录 + 成交文件挂定标阶段附件 + 监督日志', async () => {
    const prisma = mk({ fileAsset: { findUnique: jest.fn().mockResolvedValue({ id: 'fa-1', key: 'uploads/x.pdf', originalName: '成交记录.pdf', mimeType: 'application/pdf', size: 1024 }) } });
    const r = await new NonTenderDealService(prisma as any).register('bp-1', { ...dto, fileAssetId: 'fa-1' } as any, 'u-1');
    expect(r.id).toBe('nd-1');
    expect(r.attachmentId).toBe('att-1');
    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attachmentType: 'AWARD_NOTICE', objectKey: 'uploads/x.pdf',
        projectManagementItemId: 'pmi-1', projectManagementStageId: 'st-award',
      }),
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: '转非招标方式成交登记', result: '竞争性谈判 → 华西物资' }),
    });
  });

  it('未流标项目被拒 NOT_ABORTED', async () => {
    const prisma = mk({ bidProject: { findUnique: jest.fn().mockResolvedValue({ ...aborted, stage: 'EVALUATING' }) } });
    await expect(new NonTenderDealService(prisma as any).register('bp-1', dto as any)).rejects.toMatchObject({
      response: { code: 'NOT_ABORTED' },
    });
  });

  it('非三类方式被拒 BAD_METHOD', async () => {
    const prisma = mk();
    await expect(new NonTenderDealService(prisma as any).register('bp-1', { ...dto, method: '公开招标' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('重复登记被拒 ALREADY_REGISTERED', async () => {
    const prisma = mk({ nonTenderDealRecord: { findUnique: jest.fn().mockResolvedValue({ id: 'nd-0' }), create: jest.fn() } });
    await expect(new NonTenderDealService(prisma as any).register('bp-1', dto as any)).rejects.toMatchObject({
      response: { code: 'ALREADY_REGISTERED' },
    });
  });

  it('无成交文件时不建附件；无 PMI 归属时同样安全', async () => {
    const prisma = mk({ bidProject: { findUnique: jest.fn().mockResolvedValue({ ...aborted, projectManagementItemId: null }) } });
    const r = await new NonTenderDealService(prisma as any).register('bp-1', dto as any);
    expect(r.attachmentId).toBeNull();
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });
});
```
