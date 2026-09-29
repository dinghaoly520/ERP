/**
 * SUP-P1-05（2026-09-29 审查修复）：resolveOwnAnnouncement 状态闸回归防护。
 * 项目侧公告读端（详情正文/概览 AI 摘要/招标文件解析三消费端）此前无任何 status
 * 过滤——OFFLINE/HIDDEN/ARCHIVED/公示期满甚至 DRAFT（从未发布）的 BID_NOTICE
 * 正文照常下发，绕过 2026-09-26 v2「已下线仅标题壳/下架完全不出」政策。
 */
describe('resolveOwnAnnouncement 状态闸（SUP-P1-05）', () => {
  const makeService = (findFirstResult: Record<string, unknown> | null) => {
    const findFirst = jest.fn().mockResolvedValue(findFirstResult);
    const prisma = {
      announcement: { findFirst },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    // resolveAnnouncementCodes 依赖文件检索——直接注入 codes：mock projectManagementItem 无 PMI 即走 resolveAnnouncementCodes
    const svc: any = new (require('./supplier-portal.service').SupplierPortalService as any)(
      prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    // 绕过 resolveAnnouncementCodes 的复杂依赖：桩掉私有协作者
    svc.resolveAnnouncementCodes = jest.fn().mockResolvedValue(['SC-XX-2026-001']);
    return { svc, findFirst };
  };

  it('查询必须带 status: PUBLISHED（DRAFT/OFFLINE/HIDDEN/ARCHIVED 一律不出）', async () => {
    const { svc, findFirst } = makeService({ id: 'a1', publicityEnd: null, content: '正文' });
    const out = await svc.resolveOwnAnnouncement(
      { projectCode: 'BID-1', projectManagementItemId: null },
      { id: true, content: true },
    );
    expect(findFirst).toHaveBeenCalled();
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ status: 'PUBLISHED', type: 'BID_NOTICE' });
    expect(out).toMatchObject({ id: 'a1', content: '正文' });
  });

  it('公示期满（publicityEnd 已过）→ 返回 null（正文不可看）', async () => {
    const { svc } = makeService({ id: 'a1', publicityEnd: new Date('2020-01-01').toISOString(), content: '正文' });
    const out = await svc.resolveOwnAnnouncement(
      { projectCode: 'BID-1', projectManagementItemId: null },
      { id: true, content: true },
    );
    expect(out).toBeNull();
  });

  it('PUBLISHED 未到期（publicityEnd 在未来/为空）→ 原样返回且不泄漏探测列', async () => {
    const { svc } = makeService({ id: 'a1', publicityEnd: new Date('2099-01-01').toISOString(), content: '正文' });
    const out = await svc.resolveOwnAnnouncement(
      { projectCode: 'BID-1', projectManagementItemId: null },
      { id: true, content: true },
    );
    expect(out).toMatchObject({ id: 'a1', content: '正文' });
    expect(out).not.toHaveProperty('publicityEnd');
  });
});
