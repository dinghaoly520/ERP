import { ActionExecutorService } from './action-executor.service';

/** 2026-11-03 稳健收口：写动作按 id 裸写四域，属主闸只认会话属主不看目标归属——
 *  现执行前断言非 admin 操作人公司与目标归属一致（当前 planner 未接线，执行器
 *  不可达；此为防 planner 复活带回裸写的纵深闸）。 */
describe('ActionExecutorService 写动作公司断言', () => {
  const mkLog = (targetType: string, targetId: string) => ({
    id: 'al-1', status: 'confirmed', targetType, targetId, actionType: 'update_status', payloadJson: {},
  });

  const mkPrisma = (opts: {
    log?: ReturnType<typeof mkLog> | null;
    actorCompany?: string | null;
    targetCompany?: string | null;
  }) => {
    const writes: string[] = [];
    const prisma: any = {
      assistantActionLog: {
        findUnique: jest.fn().mockResolvedValue(opts.log ?? null),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: opts.actorCompany ?? null }) },
      supplier: { findUnique: jest.fn().mockResolvedValue({ companyId: opts.targetCompany ?? null }), update: jest.fn().mockImplementation(() => { writes.push('supplier'); return {}; }) },
      procurementProject: { findUnique: jest.fn().mockResolvedValue({ companyId: opts.targetCompany ?? null }), update: jest.fn() },
      announcement: { findUnique: jest.fn().mockResolvedValue({ companyId: opts.targetCompany ?? null }), update: jest.fn() },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ companyId: opts.targetCompany ?? null }) },
    };
    return { prisma, writes };
  };

  const mkSvc = (prisma: any) => new ActionExecutorService(prisma, { archiveAll: jest.fn() } as any);

  it('非 admin 同公司 → 放行执行写', async () => {
    const { prisma, writes } = mkPrisma({ log: mkLog('supplier', 's-1'), actorCompany: 'co-1', targetCompany: 'co-1' });
    const r = await mkSvc(prisma).execute('al-1', { sub: 'u-1', role: 'leader' });
    expect(r.status).toBe('success');
    expect(writes).toContain('supplier');
  });

  it('非 admin 跨公司 → 拒绝且不触任何业务写、日志落 failed', async () => {
    const { prisma, writes } = mkPrisma({ log: mkLog('supplier', 's-1'), actorCompany: 'co-1', targetCompany: 'co-2' });
    const r = await mkSvc(prisma).execute('al-1', { sub: 'u-1', role: 'leader' });
    expect(r.status).toBe('failed');
    expect(r.message).toContain('公司隔离');
    expect(writes).toHaveLength(0);
    expect(prisma.assistantActionLog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('admin 直通（不查公司）', async () => {
    const { prisma, writes } = mkPrisma({ log: mkLog('supplier', 's-1'), targetCompany: 'co-x' });
    const r = await mkSvc(prisma).execute('al-1', { sub: 'root', role: 'admin' });
    expect(r.status).toBe('success');
    expect(writes).toContain('supplier');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('缺操作人上下文 → 拒绝（防御纵深）', async () => {
    const { prisma, writes } = mkPrisma({ log: mkLog('supplier', 's-1') });
    const r = await mkSvc(prisma).execute('al-1');
    expect(r.status).toBe('failed');
    expect(writes).toHaveLength(0);
  });

  it('目标无归属公司 → 非 admin 拒绝', async () => {
    const { prisma } = mkPrisma({ log: mkLog('announcement', 'a-1'), actorCompany: 'co-1', targetCompany: null });
    const r = await mkSvc(prisma).execute('al-1', { sub: 'u-1', role: 'staff' });
    expect(r.status).toBe('failed');
  });
});
