import { PerformanceService } from './performance.service';

describe('PerformanceService.submitSatisfaction', () => {
  const createSubject = () => {
    const prisma = {
      contract: { findFirst: jest.fn() },
      satisfactionFeedback: { upsert: jest.fn().mockResolvedValue({ id: 'feedback-1' }) },
    };
    const subject = new PerformanceService(prisma as any, {} as any);
    return { subject, prisma };
  };

  it('允许成交供应商评价本企业已验收合同项目', async () => {
    const { subject, prisma } = createSubject();
    prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1' });

    await subject.submitSatisfaction(
      { id: 'supplier-1', name: '示例供应商' },
      { projectCode: 'P-001', score: 5, comment: '流程顺畅' },
    );

    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: { supplierId: 'supplier-1', projectCode: 'P-001', status: 'accepted' },
      select: { id: true },
    });
    expect(prisma.satisfactionFeedback.upsert).toHaveBeenCalled();
  });

  it('拒绝评价未参与或未验收的项目', async () => {
    const { subject, prisma } = createSubject();
    prisma.contract.findFirst.mockResolvedValue(null);

    await expect(subject.submitSatisfaction(
      { id: 'supplier-1', name: '示例供应商' },
      { projectCode: 'OTHER-001', score: 4 },
    )).rejects.toMatchObject({ response: { code: 'SATISFACTION_NOT_ALLOWED' } });
    expect(prisma.satisfactionFeedback.upsert).not.toHaveBeenCalled();
  });
});
