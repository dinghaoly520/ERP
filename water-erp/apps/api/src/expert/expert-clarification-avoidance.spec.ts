/**
 * EXP-P2-06（2026-09-29 审查修复）：澄清答疑回避屏蔽回归防护。
 * documents/assist/compare/reviews/submitScores 四路均按 conflictedSupplierIds 拦截回避
 * 供应商，唯澄清漏网——回避专家此前可看到回避供应商全部澄清问答并点名其发起澄清。
 * 回避名单存 BidSupplier 行 id（前端勾选 sup.id 提交），BidClarification.supplierId 是
 * Supplier.id FK——过滤前须换算（本 spec 同时锁该 id 空间契约）。
 */
describe('澄清回避屏蔽（EXP-P2-06）', () => {
  const CONFLICT_ROW_ID = 'bs-conflict';   // 回避名单里的 BidSupplier 行 id
  const CONFLICT_SUPPLIER_ID = 'sup-conflict'; // 其 Supplier.id（澄清 FK 空间）
  const OK_SUPPLIER_ID = 'sup-ok';

  function makeService() {
    const bidSupplierFindMany = jest.fn().mockResolvedValue([{ supplierId: CONFLICT_SUPPLIER_ID }]);
    const bidSupplierFindFirst = jest.fn()
      .mockResolvedValueOnce({ id: 'bs-x', supplierId: CONFLICT_SUPPLIER_ID, projectId: 'p1' }) // create 的 dto.supplierId 行查询
      .mockResolvedValue({ id: CONFLICT_ROW_ID }); // 回避换算查询
    const bidExpertFindFirst = jest.fn().mockResolvedValue({
      id: 'be1',
      conflictedSupplierIds: [CONFLICT_ROW_ID],
    });
    const prisma = {
      bidExpert: { findFirst: bidExpertFindFirst },
      bidSupplier: { findMany: bidSupplierFindMany, findFirst: bidSupplierFindFirst },
      bidClarification: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', stage: 'EVALUATING' }) },
    };
    const svc: any = new (require('./expert.service').ExpertService as any)(
      prisma as any, {} as any, {} as any, {} as any,
    );
    svc.assertRoomUnlocked = jest.fn().mockResolvedValue(undefined);
    return { svc, prisma };
  }

  it('listClarifications：回避行 id 换算为 Supplier.id 后 notIn 过滤', async () => {
    const { svc, prisma } = makeService();
    await svc.listClarifications('u1', 'p1');
    expect(prisma.bidSupplier.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', id: { in: [CONFLICT_ROW_ID] } },
      select: { supplierId: true },
    });
    expect(prisma.bidClarification.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', supplierId: { notIn: [CONFLICT_SUPPLIER_ID] } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('createClarification：点名回避供应商（按行 id 寻址）→ 403 CONFLICTED_SUPPLIER', async () => {
    const { svc } = makeService();
    await expect(
      svc.createClarification('u1', 'p1', { supplierId: 'bs-x', question: 'q' } as any),
    ).rejects.toMatchObject({ status: 403, response: { code: 'CONFLICTED_SUPPLIER' } });
  });

  it('createClarification：非回避供应商放行（换算查询无命中）', async () => {
    const { svc, prisma } = makeService();
    // 重排 mock 队列：call1=行寻址返回 OK 供应商；call2（回避换算）无命中
    prisma.bidSupplier.findFirst.mockReset()
      .mockResolvedValueOnce({ id: 'bs-x', supplierId: OK_SUPPLIER_ID, projectId: 'p1' })
      .mockResolvedValue(null);
    prisma.bidClarification.create.mockResolvedValue({});
    await svc.createClarification('u1', 'p1', { supplierId: 'bs-x', question: 'q' } as any);
    expect(prisma.bidClarification.create).toHaveBeenCalled();
  });
});
