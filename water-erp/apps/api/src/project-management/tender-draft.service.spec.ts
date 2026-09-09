import { NotFoundException } from '@nestjs/common';
import { TenderDraftService } from './tender-draft.service';

/** 采购文件编写·项目草稿跨设备同步（2026-09-09）：服务器为准，localStorage 降级缓存 */
describe('TenderDraftService', () => {
  const mk = (exists = true) => ({
    projectManagementItem: { findUnique: jest.fn().mockResolvedValue(exists ? { id: 'pm-1' } : null) },
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

  it('getDraft：有记录返回 drafts + 更新时间', async () => {
    const prisma = mk();
    const rec = { drafts: draft, updatedAt: new Date('2026-09-09T08:00:00Z'), updatedById: 'u1' };
    prisma.projectTenderDraft.findUnique.mockResolvedValue(rec);
    const r = await new TenderDraftService(prisma as any).getDraft('pm-1');
    expect(r?.drafts).toEqual(draft);
    expect(prisma.projectTenderDraft.findUnique).toHaveBeenCalledWith({ where: { projectId: 'pm-1' } });
  });

  it('saveDraft：upsert 且记录保存人', async () => {
    const prisma = mk();
    prisma.projectTenderDraft.upsert.mockResolvedValue({ projectId: 'pm-1', updatedAt: new Date() });
    await new TenderDraftService(prisma as any).saveDraft('pm-1', { drafts: draft } as never, { sub: 'u1' } as never);
    const arg = prisma.projectTenderDraft.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ projectId: 'pm-1' });
    expect(arg.create.updatedById).toBe('u1');
    expect(arg.create.createdById).toBe('u1');
    expect(arg.update.drafts).toEqual(draft);
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
