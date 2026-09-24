import { ConflictException } from '@nestjs/common';
import { ProjectManagementService } from './project-management.service';
import { ScoreStandardValidator } from '../bid/score-standard-validator.service';

/** 评分标准配置闸（2026-09-24 方案 v2）：完成 03 采购文件前须完成评分标准配置。
 *  口径：办法=none 免校验（BP 缺失按 PMI 采购方式推导）；否则须有该轮 BidProject
 *  且评分标准完整（复用 ScoreStandardValidator，与发布/启动评标同口径）。 */
describe('updateStage 评分标准闸（SCORE_STANDARD_REQUIRED）', () => {
  // 构造器 11 参：prisma, gbCode, ai, llm, documentParser, storage, archiveScope,
  // archiveFlow, stageCompliance, notificationService, scoreStandardValidator（2026-09-24 新增末位）
  const mkService = (
    prisma: Record<string, any>,
    validator?: Partial<ScoreStandardValidator>,
  ) =>
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
      (validator ?? { assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) }) as never,
    );

  /** 全量放行链 mock：TENDER_DOCUMENT IN_PROGRESS → 完成推进 PUBLIC_ANNOUNCEMENT */
  const mkHappyPrisma = (opts: {
    procurementMethod: string;
    stageRound?: number;
    bidProject?: { id: string; evaluationMethod: string } | null;
    withBidProjectRound1?: boolean;
  }) => {
    const findFirstImpl = (args: any) => {
      // round 感知断言点：按调用 where.round 返回
      if (args?.where?.round === 1 && opts.withBidProjectRound1) {
        return { id: 'bp-r1', evaluationMethod: 'comprehensive' };
      }
      return opts.bidProject ?? null;
    };
    return {
      projectManagementStage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'st-td',
          stageKey: 'TENDER_DOCUMENT',
          stageOrder: 3,
          round: opts.stageRound ?? 1,
          status: 'IN_PROGRESS',
          projectManagementItemId: 'pmi-1',
        }),
        findMany: jest.fn().mockResolvedValue([
          { stageKey: 'PROCUREMENT_DEMAND', stageOrder: 1 },
          { stageKey: 'INITIATION', stageOrder: 2 },
          { stageKey: 'TENDER_DOCUMENT', stageOrder: 3 },
          { stageKey: 'PUBLIC_ANNOUNCEMENT', stageOrder: 4 },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'st-td', status: 'COMPLETED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      projectManagementItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pmi-1',
          title: '测试项目',
          currentStage: 'TENDER_DOCUMENT',
          procurementMethod: opts.procurementMethod,
          stages: [], // refreshProjectAnalysis 空摘要路径
        }),
        update: jest.fn().mockResolvedValue({ id: 'pmi-1' }),
      },
      bidProject: { findFirst: jest.fn().mockImplementation(findFirstImpl) },
    };
  };

  it('无 BP + 直接采购（推导 none）→ 放行且不触发 validator', async () => {
    const prisma = mkHappyPrisma({ procurementMethod: '直接采购', bidProject: null });
    const validator = { assertScoreStandardComplete: jest.fn() };
    const svc = mkService(prisma, validator);
    await expect(
      svc.updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED' } as never),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(validator.assertScoreStandardComplete).not.toHaveBeenCalled();
  });

  it('无 BP + 竞价采购（lowest_price）→ 拦截，指引含「发布公告并关联本项目」', async () => {
    const prisma = mkHappyPrisma({ procurementMethod: '竞价采购', bidProject: null });
    const svc = mkService(prisma);
    await expect(
      svc.updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED' } as never),
    ).rejects.toMatchObject({
      response: { code: 'SCORE_STANDARD_REQUIRED' },
    });
    // 只读链不落库推进
    expect(prisma.projectManagementStage.update).not.toHaveBeenCalled();
  });

  it('无 BP + 谈判采购 → 拦截，指引含「供应商邀请」分支文案', async () => {
    const prisma = mkHappyPrisma({ procurementMethod: '谈判采购', bidProject: null });
    const svc = mkService(prisma);
    const err: any = await svc
      .updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED' } as never)
      .then(() => null, (e: unknown) => e);
    expect(err?.response?.code).toBe('SCORE_STANDARD_REQUIRED');
    expect(String(err?.response?.error)).toContain('供应商邀请');
  });

  it('round 感知：完成 round=2 行时按 round:2 解析——round1 有 BP 也不能放行 round2', async () => {
    const prisma = mkHappyPrisma({
      procurementMethod: '竞价采购',
      stageRound: 2,
      bidProject: null, // round=2 查不到
      withBidProjectRound1: true, // round=1 有
    });
    const svc = mkService(prisma);
    // 契约（2026-09-24 I-1）：轮次由 dto.round 显式传入（前端传被点行轮次），缺省 currentRound
    await expect(
      svc.updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED', round: 2 } as never),
    ).rejects.toMatchObject({ response: { code: 'SCORE_STANDARD_REQUIRED' } });
    expect(prisma.bidProject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ round: 2 }) }),
    );
  });

  it('BP 存在 + validator 判 Σ≠100 → 拦截且透传明细文案', async () => {
    const prisma = mkHappyPrisma({
      procurementMethod: '竞价采购',
      bidProject: { id: 'bp-1', evaluationMethod: 'lowest_price' },
    });
    const svc = mkService(prisma, {
      // 真实 validator 对 Σ≠100 抛 ConflictException（MAX_SCORE_SUM_NOT_100）
      assertScoreStandardComplete: jest.fn().mockRejectedValue(
        new ConflictException({ error: '打分类满分合计须为 100,当前为 60', code: 'MAX_SCORE_SUM_NOT_100' }),
      ) as never,
    });
    const err: any = await svc
      .updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED' } as never)
      .then(() => null, (e: unknown) => e);
    expect(err?.response?.code).toBe('SCORE_STANDARD_REQUIRED');
    expect(String(err?.response?.error)).toContain('当前为 60');
  });

  it('BP 存在 + validator 通过 → 放行', async () => {
    const prisma = mkHappyPrisma({
      procurementMethod: '竞价采购',
      bidProject: { id: 'bp-1', evaluationMethod: 'lowest_price' },
    });
    const validator = { assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) };
    const svc = mkService(prisma, validator);
    await expect(
      svc.updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED' } as never),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(validator.assertScoreStandardComplete).toHaveBeenCalledWith('bp-1');
  });

  it('BP 办法=none → 免评分项校验（validator 不调用）', async () => {
    const prisma = mkHappyPrisma({
      procurementMethod: '公开招标',
      bidProject: { id: 'bp-1', evaluationMethod: 'none' },
    });
    const validator = { assertScoreStandardComplete: jest.fn() };
    const svc = mkService(prisma, validator);
    await expect(
      svc.updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED' } as never),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(validator.assertScoreStandardComplete).not.toHaveBeenCalled();
  });

  it('validator 抛非 HttpException（如 Prisma 连接错误）→ 原样上抛，不包装成 400 评分闸', async () => {
    const prisma = mkHappyPrisma({
      procurementMethod: '竞价采购',
      bidProject: { id: 'bp-1', evaluationMethod: 'lowest_price' },
    });
    const infraErr = new Error('P2021: table does not exist');
    const svc = mkService(prisma, {
      assertScoreStandardComplete: jest.fn().mockRejectedValue(infraErr) as never,
    });
    const err: any = await svc
      .updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED' } as never)
      .then(() => null, (e: unknown) => e);
    // 基础设施故障须保持 500 语义——包装成 SCORE_STANDARD_REQUIRED 会误导排障
    expect(err).toBe(infraErr);
  });

  it('stage 行解析 round 感知：dto.round=2 → stage 查询带 round:2（多轮不误读 round-1 行）', async () => {
    const prisma = mkHappyPrisma({ procurementMethod: '竞价采购', stageRound: 2, bidProject: null });
    const svc = mkService(prisma);
    await svc
      .updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED', round: 2 } as never)
      .then(() => null, () => undefined);
    expect(prisma.projectManagementStage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ stageKey: 'TENDER_DOCUMENT', round: 2 }) }),
    );
    expect(prisma.bidProject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ round: 2 }) }),
    );
  });

  it('stage 行解析 round 缺省 → 取 PMI.currentRound（不落回任意行）', async () => {
    const prisma = mkHappyPrisma({ procurementMethod: '竞价采购', stageRound: 2, bidProject: null });
    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pmi-1',
      title: '测试项目',
      currentStage: 'TENDER_DOCUMENT',
      currentRound: 2,
      procurementMethod: '竞价采购',
      stages: [],
    });
    const svc = mkService(prisma);
    await svc
      .updateStage('pmi-1', 'TENDER_DOCUMENT', { status: 'COMPLETED' } as never)
      .then(() => null, () => undefined);
    expect(prisma.projectManagementStage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ round: 2 }) }),
    );
  });
});

describe('listBidProjectRefs（只读解析，不创建）', () => {
  const mkService = (prisma: Record<string, any>) =>
    new ProjectManagementService(
      prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );

  it('findMany 按 pmiId 查、按 round 升序直返（无创建路径）', async () => {
    const refs = [
      { id: 'bp-1', round: 1, projectCode: 'SC-CG-1', stage: 'ARCHIVED' },
      { id: 'bp-2', round: 2, projectCode: 'SC-CG-2', stage: 'SUBMIT' },
    ];
    const findMany = jest.fn().mockResolvedValue(refs);
    const svc = mkService({ bidProject: { findMany } });
    await expect(svc.listBidProjectRefs('pmi-1')).resolves.toEqual(refs);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectManagementItemId: 'pmi-1' } }),
    );
  });
});
