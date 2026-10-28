import { BadRequestException } from '@nestjs/common';
import { ProjectManagementService } from './project-management.service';

/** 2026-10-28 二轮隔离（spec 2026-10-28-pmi-reproc-round-isolation）：
 *  1) reproc：旧轮 PMI 开标/获取时间快照到旧轮 BidProject + PMI 清空；
 *  2) EXPERT_SELECTION 完成闸按轮数专家（第一轮抽过不能让第二轮免抽）；
 *  3) SUPPLIER_INVITATION 完成闸只数本轮回执。 */
describe('流标再采第二轮隔离', () => {
  const mkService = (prisma: Record<string, any>) =>
    new ProjectManagementService(
      prisma as never,
      {} as never,
      { analyzeProjectDetail: jest.fn().mockResolvedValue({ summary: {}, fileAnalyses: [] }) } as never,
      {} as never,
      {} as never,
      {} as never,
      { checkStageGate: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never,
      { assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );

  // ── 1) reproc 快照 + 清空 ──
  const R1_STAGES = [
    { stageKey: 'PROCUREMENT_DEMAND', stageOrder: 1, round: 1, status: 'COMPLETED' },
    { stageKey: 'INITIATION', stageOrder: 2, round: 1, status: 'COMPLETED' },
    { stageKey: 'TENDER_DOCUMENT', stageOrder: 3, round: 1, status: 'COMPLETED' },
    { stageKey: 'PUBLIC_ANNOUNCEMENT', stageOrder: 4, round: 1, status: 'COMPLETED' },
    { stageKey: 'SUPPLIER_INVITATION', stageOrder: 5, round: 1, status: 'COMPLETED' },
    { stageKey: 'EXPERT_SELECTION', stageOrder: 6, round: 1, status: 'COMPLETED' },
    { stageKey: 'BID_EVALUATION', stageOrder: 7, round: 1, status: 'IN_PROGRESS' },
    { stageKey: 'AWARD_DECISION', stageOrder: 8, round: 1, status: 'NOT_STARTED' },
    { stageKey: 'CONTRACT', stageOrder: 9, round: 1, status: 'NOT_STARTED' },
  ];

  const mkReprocPrisma = (opts: { timesAlreadyCleared?: boolean } = {}) => {
    const tx = {
      projectManagementStage: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      bidProject: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      projectManagementItem: { update: jest.fn().mockResolvedValue({ id: 'pmi-1' }) },
    };
    return {
      projectManagementItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pmi-1',
          projectCode: 'SWHI-TP-2026102801',
          procurementMethod: '竞价采购',
          currentRound: 1,
          status: 'ACTIVE',
          requesterName: '张三', requesterDepartment: '采购中心', title: '二轮隔离测试项目',
          procurementCategory: '服务', budgetAmount: null, projectReason: '', supplierRequirements: '',
          initiationDate: null, procurementOrganizationForm: '', isAnnualBudget: false,
          bidOpeningTime: opts.timesAlreadyCleared ? null : new Date('2026-10-20T06:00:00Z'),
          documentAcquireTime: opts.timesAlreadyCleared ? null : '2026年10月10日09:00至2026年10月15日15:00',
          stages: R1_STAGES,
        }),
      },
      bidProject: {
        findFirst: jest.fn().mockResolvedValue({ stage: 'ABORTED', riskNote: '流标（竞价采购，投标供应商 2 家）' }),
      },
      projectManagementStage: {
        findMany: jest.fn().mockResolvedValue([
          { stageName: '定标', attachments: [] },
          { stageName: '合同', attachments: [] },
        ]),
      },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    };
  };

  it('reproc：旧轮时间快照到旧轮 BidProject + PMI 两字段清空 + currentRound 推进', async () => {
    const prisma = mkReprocPrisma();
    const svc = mkService(prisma);
    await expect(svc.reproc('pmi-1', { startStageKey: 'TENDER_DOCUMENT' } as never)).resolves.toMatchObject({ round: 2 });
    // 快照：写到旧轮（round:1）项目行
    expect(prisma.__tx.bidProject.updateMany).toHaveBeenCalledWith({
      where: { projectManagementItemId: 'pmi-1', round: 1 },
      data: {
        roundOpeningTime: new Date('2026-10-20T06:00:00Z'),
        roundDocAcquireTime: '2026年10月10日09:00至2026年10月15日15:00',
      },
    });
    // 清空：PMI 更新包含两字段置 null（信息不含旧值，仅供合并进 infoData 的确认字段）
    const pmiUpdate = prisma.__tx.projectManagementItem.update.mock.calls[0][0];
    expect(pmiUpdate.data.bidOpeningTime).toBeNull();
    expect(pmiUpdate.data.documentAcquireTime).toBeNull();
    expect(pmiUpdate.data.currentRound).toBe(2);
  });

  it('reproc：两时间本就为空 → 跳过快照（不产生空写），PMI 更新仍含清空值幂等无害', async () => {
    const prisma = mkReprocPrisma({ timesAlreadyCleared: true });
    const svc = mkService(prisma);
    await expect(svc.reproc('pmi-1', { startStageKey: 'TENDER_DOCUMENT' } as never)).resolves.toMatchObject({ round: 2 });
    expect(prisma.__tx.bidProject.updateMany).not.toHaveBeenCalled();
    const pmiUpdate = prisma.__tx.projectManagementItem.update.mock.calls[0][0];
    expect(pmiUpdate.data.bidOpeningTime).toBeNull();
    expect(pmiUpdate.data.documentAcquireTime).toBeNull();
  });

  // ── 2) EXPERT_SELECTION 完成闸分轮 ──
  const mkGatePrisma = (opts: { round2Experts: number }) => {
    const bpByRound: Record<number, { id: string }> = { 1: { id: 'bp-r1' }, 2: { id: 'bp-r2' } };
    return {
      projectManagementStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'st-exp', stageKey: 'EXPERT_SELECTION', stageOrder: 6, round: 2,
          status: 'IN_PROGRESS', projectManagementItemId: 'pmi-1',
          officialTenderAttachmentId: null,
        }),
        findMany: jest.fn().mockResolvedValue([
          { stageKey: 'PROCUREMENT_DEMAND', stageOrder: 1 },
          { stageKey: 'BID_EVALUATION', stageOrder: 7 },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'st-exp', status: 'COMPLETED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      projectManagementItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pmi-1', status: 'ACTIVE', title: '测试', currentStage: 'EXPERT_SELECTION',
          currentRound: 2, procurementMethod: '竞价采购', stages: [],
        }),
        update: jest.fn().mockResolvedValue({ id: 'pmi-1' }),
      },
      bidProject: {
        findFirst: jest.fn().mockImplementation((args: any) => bpByRound[args?.where?.round as number] ?? null),
      },
      bidExpert: { count: jest.fn().mockResolvedValue(opts.round2Experts) },
      invitationRsvp: { findMany: jest.fn().mockResolvedValue([]) },
    };
  };

  it('专家闸分轮：第二轮项目 0 专家 → 拦截（第一轮抽过不算数）', async () => {
    const prisma = mkGatePrisma({ round2Experts: 0 });
    const svc = mkService(prisma);
    await expect(
      svc.updateStage('pmi-1', 'EXPERT_SELECTION', { status: 'COMPLETED', round: 2 } as never),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.bidExpert.count).toHaveBeenCalledWith({ where: { projectId: 'bp-r2' } });
  });

  it('专家闸分轮：第二轮项目已有专家 → 放行完成', async () => {
    const prisma = mkGatePrisma({ round2Experts: 5 });
    const svc = mkService(prisma);
    await expect(
      svc.updateStage('pmi-1', 'EXPERT_SELECTION', { status: 'COMPLETED', round: 2 } as never),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  // ── 3) SUPPLIER_INVITATION 完成闸只数本轮回执 ──
  it('邀请闸分轮：回执查询只查本轮 BidProject 名下（旧轮回执不计入新轮完成判定）', async () => {
    const prisma = mkGatePrisma({ round2Experts: 5 });
    prisma.projectManagementStage.findFirst.mockResolvedValue({
      id: 'st-sup', stageKey: 'SUPPLIER_INVITATION', stageOrder: 5, round: 2,
      status: 'IN_PROGRESS', projectManagementItemId: 'pmi-1', officialTenderAttachmentId: null,
    });
    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pmi-1', status: 'ACTIVE', title: '测试', currentStage: 'SUPPLIER_INVITATION',
      currentRound: 2, procurementMethod: '竞价采购', stages: [],
    });
    prisma.invitationRsvp.findMany.mockResolvedValue([
      { supplierId: 's1', status: 'ACCEPTED', respondedAt: new Date() },
      { supplierId: 's2', status: 'ACCEPTED', respondedAt: new Date() },
      { supplierId: 's3', status: 'ACCEPTED', respondedAt: new Date() },
    ]);
    const svc = mkService(prisma);
    await expect(
      svc.updateStage('pmi-1', 'SUPPLIER_INVITATION', { status: 'COMPLETED', round: 2, confirmedThreshold: 3 } as never),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(prisma.invitationRsvp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'bp-r2' } }),
    );
  });
});
