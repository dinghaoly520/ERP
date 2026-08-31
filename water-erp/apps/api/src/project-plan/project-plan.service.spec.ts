import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProjectPlanService } from './project-plan.service';

/** CTS-EBS01 A-47~49：计划整包报审/受理规则 */
describe('ProjectPlanService 报审受理（CTS A-47~49）', () => {
  const mk = (over: Record<string, unknown> = {}) => {
    const prisma = {
      projectPlanItem: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
      },
      projectTeamMember: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      ...over,
    };
    return { service: new ProjectPlanService(prisma as never), prisma };
  };

  const user = (role: string, sub = 'u-leader') => ({ role, sub }) as never;

  it('报审：无可报审条目 → NOTHING_TO_SUBMIT', async () => {
    const { service } = mk();
    await expect(service.submitPlans('pmi-1', user('staff'))).rejects.toMatchObject({
      response: { code: 'NOTHING_TO_SUBMIT' },
    });
  });

  it('报审：DRAFT/REJECTED 整包 → SUBMITTED', async () => {
    const { service, prisma } = mk({
      projectPlanItem: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    });
    const r = await service.submitPlans('pmi-1', user('staff', 'u-staff'));
    expect(r).toEqual({ submitted: 3 });
    expect(prisma.projectPlanItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED', submittedById: 'u-staff' }) }),
    );
  });

  it('受理：staff 无权', async () => {
    const { service } = mk();
    await expect(service.reviewPlans('pmi-1', { approve: true }, user('staff'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('受理：无待审条目 → NOT_PENDING_REVIEW', async () => {
    const { service } = mk();
    await expect(service.reviewPlans('pmi-1', { approve: true }, user('leader'))).rejects.toMatchObject({
      response: { code: 'NOT_PENDING_REVIEW' },
    });
  });

  it('受理：报审人=审核人（非 admin）→ SELF_REVIEW_FORBIDDEN', async () => {
    const { service } = mk({
      projectPlanItem: { findMany: jest.fn().mockResolvedValue([{ submittedById: 'u-leader' }]) },
    });
    await expect(service.reviewPlans('pmi-1', { approve: true }, user('leader', 'u-leader'))).rejects.toMatchObject({
      response: { code: 'SELF_REVIEW_FORBIDDEN' },
    });
  });

  it('受理：驳回无理由 → REJECT_REASON_REQUIRED', async () => {
    const { service } = mk({
      projectPlanItem: { findMany: jest.fn().mockResolvedValue([{ submittedById: 'u-staff' }]) },
    });
    await expect(service.reviewPlans('pmi-1', { approve: false }, user('leader'))).rejects.toMatchObject({
      response: { code: 'REJECT_REASON_REQUIRED' },
    });
  });

  it('受理：通过 → 全部 APPROVED 并留痕', async () => {
    const { service, prisma } = mk({
      projectPlanItem: {
        findMany: jest.fn().mockResolvedValue([{ submittedById: 'u-staff' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    });
    const r = await service.reviewPlans('pmi-1', { approve: true }, user('leader', 'u-leader'));
    expect(r).toEqual({ reviewed: 2, approved: true });
    expect(prisma.projectPlanItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', reviewedById: 'u-leader' }) }),
    );
  });

  it('编辑：报审中 → PLAN_LOCKED', async () => {
    const { service } = mk({
      projectPlanItem: { findFirst: jest.fn().mockResolvedValue({ status: 'SUBMITTED' }) },
    });
    await expect(service.updatePlan('pmi-1', 'p-1', { content: 'x' })).rejects.toMatchObject({
      response: { code: 'PLAN_LOCKED' },
    });
  });

  it('编辑：已通过条目可调整并自动降回 DRAFT（A-07 重新申报语义）', async () => {
    const { service, prisma } = mk({
      projectPlanItem: {
        findFirst: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
        update: jest.fn().mockResolvedValue({ id: 'p-1' }),
      },
    });
    await service.updatePlan('pmi-1', 'p-1', { content: '调整后内容' });
    expect(prisma.projectPlanItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DRAFT', content: '调整后内容', reviewedAt: null, reviewComment: null }),
      }),
    );
  });

  it('团队：重复成员 → DUPLICATE_MEMBER', async () => {
    const { service } = mk({
      projectTeamMember: { findFirst: jest.fn().mockResolvedValue({ id: 'm-1' }) },
    });
    await expect(service.addTeamMember('pmi-1', { userId: 'u-1', role: '技术' })).rejects.toMatchObject({
      response: { code: 'DUPLICATE_MEMBER' },
    });
  });

  it('编辑/删除：DRAFT 可操作', async () => {
    const { service, prisma } = mk({
      projectPlanItem: {
        findFirst: jest.fn().mockResolvedValue({ status: 'DRAFT' }),
        update: jest.fn().mockResolvedValue({ id: 'p-1' }),
      },
    });
    await service.updatePlan('pmi-1', 'p-1', { content: '改' });
    expect(prisma.projectPlanItem.update).toHaveBeenCalled();
  });
});
