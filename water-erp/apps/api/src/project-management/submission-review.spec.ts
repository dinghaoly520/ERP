import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProjectManagementService } from './project-management.service';

/** CTS-EBS01 A-36/37：项目递交与受理留痕（申报人/时间、验证人/时间，双人分离） */
describe('ProjectManagementService 递交受理（CTS A-36/37）', () => {
  const mk = (findUniqueResult: Record<string, unknown> | null) => {
    const prisma = {
      projectManagementItem: {
        findUnique: jest.fn().mockResolvedValue(findUniqueResult),
        update: jest.fn().mockResolvedValue({ id: 'pmi-1' }),
      },
    };
    const service = new ProjectManagementService(
      prisma as never,
      { allocateProjectCode: async () => 'GB-TEST', allocateProcureCode: async () => 'GB-PROC-TEST' } as never, // gbCode
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  };

  const user = (role: string, sub = 'u-leader') => ({ role, sub }) as never;

  it('递交：未递交 → PENDING 并写申报人留痕', async () => {
    const { service, prisma } = mk({ reviewStatus: null });
    await service.submitForReview('pmi-1', user('staff', 'u-staff'));
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pmi-1' },
        data: expect.objectContaining({ reviewStatus: 'PENDING', submittedById: 'u-staff', submittedAt: expect.any(Date) }),
      }),
    );
  });

  it('递交：驳回后可重新递交（清空意见）', async () => {
    const { service, prisma } = mk({ reviewStatus: 'REJECTED' });
    await service.submitForReview('pmi-1', user('staff', 'u-staff'));
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reviewComment: null }) }),
    );
  });

  it('递交：待审中不可重复递交', async () => {
    const { service } = mk({ reviewStatus: 'PENDING' });
    await expect(service.submitForReview('pmi-1', user('staff'))).rejects.toMatchObject({
      response: { code: 'ALREADY_SUBMITTED' },
    });
  });

  it('递交：已通过不可再递交', async () => {
    const { service } = mk({ reviewStatus: 'APPROVED' });
    await expect(service.submitForReview('pmi-1', user('staff'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('审核：staff 无权受理', async () => {
    const { service } = mk({ reviewStatus: 'PENDING' });
    await expect(service.reviewSubmission('pmi-1', { approve: true }, user('staff'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('审核：申报人与审核人不得同一人（非 admin）', async () => {
    const { service } = mk({ reviewStatus: 'PENDING', submittedById: 'u-leader' });
    await expect(
      service.reviewSubmission('pmi-1', { approve: true }, user('leader', 'u-leader')),
    ).rejects.toMatchObject({ response: { code: 'SELF_REVIEW_FORBIDDEN' } });
  });

  it('审核：驳回必须填写理由', async () => {
    const { service } = mk({ reviewStatus: 'PENDING', submittedById: 'u-staff' });
    await expect(
      service.reviewSubmission('pmi-1', { approve: false }, user('leader')),
    ).rejects.toMatchObject({ response: { code: 'REJECT_REASON_REQUIRED' } });
  });

  it('审核：非待审状态不可受理', async () => {
    const { service } = mk({ reviewStatus: null });
    await expect(service.reviewSubmission('pmi-1', { approve: true }, user('leader'))).rejects.toMatchObject({
      response: { code: 'NOT_PENDING_REVIEW' },
    });
  });

  it('审核：通过 → APPROVED 并写验证人留痕', async () => {
    const { service, prisma } = mk({ reviewStatus: 'PENDING', submittedById: 'u-staff' });
    await service.reviewSubmission('pmi-1', { approve: true }, user('leader', 'u-leader'));
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewStatus: 'APPROVED', reviewedById: 'u-leader', reviewedAt: expect.any(Date) }),
      }),
    );
  });
});
