import { NotFoundException } from '@nestjs/common';
import { TenderDraftService } from './tender-draft.service';

/** 采购文件编写·项目草稿跨设备同步（2026-09-09）：服务器为准，localStorage 降级缓存。
 *  2026-10-28 二轮隔离：草稿按 (projectId, round) 存取，round 缺省=PMI currentRound。 */
describe('TenderDraftService', () => {
  const mk = (exists = true, currentRound = 1) => ({
    projectManagementItem: { findUnique: jest.fn().mockResolvedValue(exists ? { id: 'pm-1', currentRound } : null) },
    projectTenderDraft: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    projectTenderDraftVersion: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  });

  const draft = { COMPETITIVE_NEGOTIATION: { projectName: '钻机采购' } };

  it('getDraft：无记录返回 null（前端回落 localStorage 并回传完成上云迁移）', async () => {
    const prisma = mk();
    prisma.projectTenderDraft.findUnique.mockResolvedValue(null);
    await expect(new TenderDraftService(prisma as any).getDraft('pm-1')).resolves.toBeNull();
  });

  it('getDraft：有记录返回 drafts + 更新时间（缺省轮=PMI currentRound）', async () => {
    const prisma = mk(true, 2);
    const rec = { drafts: draft, updatedAt: new Date('2026-09-09T08:00:00Z'), updatedById: 'u1' };
    prisma.projectTenderDraft.findUnique.mockResolvedValue(rec);
    const r = await new TenderDraftService(prisma as any).getDraft('pm-1');
    expect(r?.drafts).toEqual(draft);
    expect(prisma.projectTenderDraft.findUnique).toHaveBeenCalledWith({ where: { projectId_round: { projectId: 'pm-1', round: 2 } } });
  });

  it('saveDraft：upsert（复合键 projectId+round）且记录保存人', async () => {
    const prisma = mk();
    prisma.projectTenderDraft.upsert.mockResolvedValue({ projectId: 'pm-1', updatedAt: new Date() });
    await new TenderDraftService(prisma as any).saveDraft('pm-1', { drafts: draft } as never, { sub: 'u1' } as never, 2);
    const arg = prisma.projectTenderDraft.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ projectId_round: { projectId: 'pm-1', round: 2 } });
    expect(arg.create.round).toBe(2);
    expect(arg.create.updatedById).toBe('u1');
    expect(arg.create.createdById).toBe('u1');
    expect(arg.update.drafts).toEqual(draft);
  });

  it('二轮隔离：第二轮 getDraft 不回读第一轮草稿（按 (projectId, round) 取行）', async () => {
    const prisma = mk(true, 2);
    prisma.projectTenderDraft.findUnique.mockResolvedValue(null); // 第二轮无草稿（第一轮有也不查）
    await expect(new TenderDraftService(prisma as any).getDraft('pm-1', 2)).resolves.toBeNull();
    expect(prisma.projectTenderDraft.findUnique).toHaveBeenCalledWith({ where: { projectId_round: { projectId: 'pm-1', round: 2 } } });
  });

  it('clearDraft：只清该轮草稿与版本（不影响其他轮）', async () => {
    const prisma = mk();
    await new TenderDraftService(prisma as any).clearDraft('pm-1', 2);
    expect(prisma.projectTenderDraft.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'pm-1', round: 2 } });
    expect(prisma.projectTenderDraftVersion.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'pm-1', round: 2 } });
  });

  it('addVersion：超限裁剪只保留最近 20 条', async () => {
    const prisma = mk();
    prisma.projectTenderDraftVersion.create.mockResolvedValue({ id: 'v-new', label: 'L', createdAt: new Date() });
    // 裁剪查询返回 2 条应淘汰的旧版本（第 21、22 新）
    prisma.projectTenderDraftVersion.findMany.mockResolvedValue([{ id: 'v-old-1' }, { id: 'v-old-2' }]);
    await new TenderDraftService(prisma as any).addVersion('pm-1', { drafts: draft, label: 'L' } as never);
    expect(prisma.projectTenderDraftVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, orderBy: { createdAt: 'desc' } }),
    );
    expect(prisma.projectTenderDraftVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['v-old-1', 'v-old-2'] } },
    });
  });

  it('项目不存在：各端点统一 404（归属越权由 PmiOwnershipGuard 拦截）', async () => {
    const prisma = mk(false);
    const svc = new TenderDraftService(prisma as any);
    await expect(svc.getDraft('pm-x')).rejects.toThrow(NotFoundException);
    await expect(svc.saveDraft('pm-x', { drafts: draft } as never, undefined)).rejects.toThrow(NotFoundException);
  });
});
