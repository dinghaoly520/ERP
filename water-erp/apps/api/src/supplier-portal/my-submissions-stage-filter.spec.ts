import { SupplierPortalService } from './supplier-portal.service';

process.env.KMS_SECRET = process.env.KMS_SECRET || 'unit-test-kms-secret-32-chars-long!!';

/** 我的投标「进行中/已完成」重叠修复（2026-10-23）：getMySubmissions 默认全阶段
 *  （异议页依赖：归档后仍可对结果提异议——注释在 objections/page.tsx:106）；
 *  my-bids 视图经 includeFinished=false 排除 ARCHIVED/ABORTED，归口「已完成/合作历史」。 */
describe('SupplierPortalService.getMySubmissions — 阶段过滤参数', () => {
  const mk = () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ name: '某供应商' }) },
      supplierBidSubmission: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, svc: new (SupplierPortalService as any)(prisma) as SupplierPortalService };
  };

  it('默认（无参）：全阶段——异议页口径不变', async () => {
    const { prisma, svc } = mk();
    await svc.getMySubmissions('s1');
    expect(prisma.supplierBidSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { supplierId: 's1' } }),
    );
  });

  it('includeFinished=false：where 排除 ARCHIVED/ABORTED（进行中视图）', async () => {
    const { prisma, svc } = mk();
    await svc.getMySubmissions('s1', { includeFinished: false });
    expect(prisma.supplierBidSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supplierId: 's1', project: { stage: { notIn: ['ARCHIVED', 'ABORTED'] } } },
      }),
    );
  });
});
