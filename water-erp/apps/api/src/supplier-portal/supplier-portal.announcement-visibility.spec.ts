/**
 * SUP-P1-05（2026-09-29 审查修复）→ 2026-10-20 用户裁定修订：resolveOwnAnnouncement 状态闸回归防护。
 * 项目侧公告读端（详情正文/概览 AI 摘要/招标文件解析三消费端）：OFFLINE/HIDDEN/ARCHIVED/DRAFT
 * 仍完全不出（status: PUBLISHED 硬过滤）；但「公示期满」不再对项目机会读端生效——公示期满
 * 仅在公开渠道下线，供应商「项目机会」必须持续显示公告原文与采购文件
 * （实录：DMGY-XB-2026100901 公示期 3 天默认值短于投标窗口，截标前采购文件显示「暂无」）。
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

  it('公示期满（publicityEnd 已过）→ 仍返回正文（2026-10-20 裁定：项目机会须持续显示公告原文与采购文件）', async () => {
    const { svc } = makeService({ id: 'a1', publicityEnd: new Date('2020-01-01').toISOString(), content: '正文' });
    const out = await svc.resolveOwnAnnouncement(
      { projectCode: 'BID-1', projectManagementItemId: null },
      { id: true, content: true },
    );
    expect(out).toMatchObject({ id: 'a1', content: '正文' });
    expect(out).not.toHaveProperty('publicityEnd');
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
