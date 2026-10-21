import { BidDocumentService } from './bid-document.service';

/**
 * checkEligibility OPEN 公司隔离（2026-10-21 边界闭环）：
 * 「全库供应商可下载」收紧为「本公司库」——公告归属公司 ∈ 供应商 APPROVED SupplierCompanyLink；
 * 平台级公告（companyId null）仍全员；存量跨公司受邀行（BidSupplier）放行（受邀即授权）。
 */
describe('BidDocumentService — checkEligibility OPEN 公司隔离（2026-10-21）', () => {
  const mk = (prismaOverrides: Record<string, any> = {}) => {
    const prisma: any = {
      announcement: { findUnique: jest.fn() },
      supplierCompanyLink: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(null) },
      ...prismaOverrides,
    };
    const svc: any = Object.create(BidDocumentService.prototype);
    svc.prisma = prisma;
    return { svc, prisma };
  };

  it('OPEN + 公告归属公司命中 APPROVED 归属 → eligible「公开下载」', async () => {
    const { svc, prisma } = mk();
    prisma.announcement.findUnique.mockResolvedValue({ companyId: 'co-A' });
    prisma.supplierCompanyLink.findMany.mockResolvedValue([{ companyId: 'co-A' }]);
    await expect(svc.checkEligibility({ accessScope: 'OPEN', announcementId: 'a1' }, 's1'))
      .resolves.toEqual({ eligible: true, reason: '公开下载' });
  });

  it('OPEN + 他司公告且无归属/无受邀 → 拒绝（reason 指引归属口径）', async () => {
    const { svc, prisma } = mk();
    prisma.announcement.findUnique.mockResolvedValue({ companyId: 'co-B' });
    await expect(svc.checkEligibility({ accessScope: 'OPEN', announcementId: 'a1' }, 's1'))
      .resolves.toMatchObject({ eligible: false });
  });

  it('OPEN + 平台级公告（companyId null）→ 全员放行', async () => {
    const { svc, prisma } = mk();
    prisma.announcement.findUnique.mockResolvedValue({ companyId: null });
    await expect(svc.checkEligibility({ accessScope: 'OPEN', announcementId: 'a1' }, 's1'))
      .resolves.toEqual({ eligible: true, reason: '公开下载' });
  });

  it('OPEN + 他司公告 + 存量跨公司受邀行 → 放行（受邀即授权）', async () => {
    const { svc, prisma } = mk();
    prisma.announcement.findUnique.mockResolvedValue({ companyId: 'co-B' });
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1' });
    await expect(svc.checkEligibility({ accessScope: 'OPEN', announcementId: 'a1', bidProjectId: 'p1' }, 's1'))
      .resolves.toEqual({ eligible: true, reason: '受邀参与本项目' });
  });

  it('INVITED 分支不受影响（受邀名单判定照旧）', async () => {
    const { svc, prisma } = mk();
    prisma.bidDocumentAccess = { findUnique: jest.fn().mockResolvedValue({ eligible: true }) };
    await expect(svc.checkEligibility({ accessScope: 'INVITED', announcementId: 'a1', id: 'd1' }, 's1'))
      .resolves.toMatchObject({ eligible: true });
  });
});
