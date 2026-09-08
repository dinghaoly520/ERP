import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ExpertExtractionService } from './expert-extraction.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';

describe('ExpertExtractionService', () => {
  let service: ExpertExtractionService;
  let prisma: any;
  let extractionAi: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      bidExpert: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      bidProject: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      bidRound: {
        count: jest.fn().mockResolvedValue(0),
      },
      expertEvaluation: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      expertProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      bidSupervisionLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      // 同时支持数组式（Promise.all）与函数式（执行回调）事务，使事务内逻辑真实运行
      $transaction: jest.fn().mockImplementation(async (arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    extractionAi = {
      analyzeAndScore: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({ llmCalls: 0, llmErrors: 0, fallbackCount: 0 }),
      recordFallback: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertExtractionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertExtractionAiService, useValue: extractionAi },
        { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue([]) } },
        { provide: ExpertCrossConflictService, useValue: { checkCrossConflicts: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get<ExpertExtractionService>(ExpertExtractionService);
  });

  describe('previewExtraction（AI 规则降级回归）', () => {
    it('AI 抛错时应降级规则引擎并返回 engine=rules，仍产出抽取结果', async () => {
      prisma.bidProject = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1', name: '测试项目', procurementMethod: '公开招标',
          scope: '水利枢纽施工', qualification: '', qualityRequirement: '', riskNote: '', budget: null,
          suppliers: [],
        }),
      };
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '甲', isActive: true, expertProfile: { specialty: '施工', availability: '可用', entryStatus: 'ACTIVE', title: '高级工程师', employer: '川西分公司' }, bidExperts: [], _count: { bidExperts: 3 } },
        { id: 'u2', displayName: '乙', isActive: true, expertProfile: { specialty: '地质', availability: '可用', entryStatus: 'ACTIVE', title: '工程师', employer: '设计院' }, bidExperts: [], _count: { bidExperts: 1 } },
      ]);
      prisma.expertEvaluation.groupBy = jest.fn().mockResolvedValue([]);
      prisma.expertEvaluation.findMany.mockResolvedValue([]);
      prisma.bidExpert.findMany.mockResolvedValue([]);
      prisma.bidScoreRecord = { findMany: jest.fn().mockResolvedValue([]) };
      extractionAi.analyzeAndScore.mockRejectedValue(new Error('AI 服务不可用'));

      const res = await service.previewExtraction('p1', { projectId: 'p1', totalNeeded: 2, alternatives: 1, extractMode: 'merit_best' });
      expect(res.engine).toBe('rules');
      expect(extractionAi.recordFallback).toHaveBeenCalled();
      expect(res.selected.length).toBeGreaterThan(0);
      expect(res.model).toContain('Rules Engine');
    });

    // A-129：配额区域/等级可选过滤——共享候选池 where 注入
    const setupA129 = () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '测试项目', procurementMethod: '公开招标',
        scope: '水利枢纽施工', qualification: '', qualityRequirement: '', riskNote: '', budget: null,
        suppliers: [],
      });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '甲', isActive: true, expertProfile: { specialty: '造价咨询', availability: '可用', entryStatus: 'ACTIVE', title: '高级工程师', employer: '川西分公司', regionCode: '510000', expertLevel: 'A' }, bidExperts: [], _count: { bidExperts: 3 } },
        { id: 'u2', displayName: '乙', isActive: true, expertProfile: { specialty: '地质', availability: '可用', entryStatus: 'ACTIVE', title: '工程师', employer: '设计院', regionCode: '510000', expertLevel: 'C' }, bidExperts: [], _count: { bidExperts: 1 } },
      ]);
      prisma.bidScoreRecord = { findMany: jest.fn().mockResolvedValue([]) };
      extractionAi.analyzeAndScore.mockResolvedValue({ analysis: 'ok', requiredSpecialties: [], scoredExperts: [] });
    };

    it('A-129：配额带 regionCode/expertLevel → 候选过滤 where 注入 expertProfile 两字段', async () => {
      setupA129();
      await service.previewExtraction('p1', { mode: 'manual', manualQuotas: [
        { specialty: '造价咨询', count: 3, regionCode: '510000', expertLevel: 'A,B' },
      ] } as any);
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ expertProfile: expect.objectContaining({
          regionCode: '510000', expertLevel: { in: ['A', 'B'] },
        }) }),
      }));
    });

    it('A-129：配额未带区域/等级 → where 不含两键（undefined 透传 prisma 即忽略，未填不过滤铁律）', async () => {
      setupA129();
      await service.previewExtraction('p1', { mode: 'manual', manualQuotas: [
        { specialty: '造价咨询', count: 3 },
      ] } as any);
      // D3a 精度：not.objectContaining({regionCode: expect.anything()}) 对 null/undefined 值漏放
      //（anything() 不匹配 null）——改断键整体不存在
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.expertProfile).not.toHaveProperty('regionCode');
      expect(where.expertProfile).not.toHaveProperty('expertLevel');
    });

    it('A-129：多配额区域/等级不一致 → 并集过滤（regionCode in 合并 + expertLevel in 并集），返回 quotaFiltersApplied 说明', async () => {
      setupA129();
      const res = await service.previewExtraction('p1', { mode: 'manual', manualQuotas: [
        { specialty: '造价咨询', count: 2, regionCode: '510000', expertLevel: 'A' },
        { specialty: '地质', count: 2, regionCode: '530000', expertLevel: 'C' },
      ] } as any);
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ expertProfile: expect.objectContaining({
          regionCode: { in: ['510000', '530000'] }, expertLevel: { in: ['A', 'C'] },
        }) }),
      }));
      expect(res.quotaFiltersApplied).toEqual({
        regionCode: ['510000', '530000'],
        expertLevel: ['A', 'C'],
        note: '多配额区域/等级值不一致，候选池已按并集过滤',
      });
    });
  });

  describe('confirmExtraction（抽取确认：越权/回避/审计原子性）', () => {
    const dto = (experts: any[] = [{ userId: 'u1', expertName: '甲', major: '施工', isLead: true }]) =>
      ({ projectId: 'p1', experts, candidates: [] }) as any;

    it('缺少操作人应拒绝，且不进入事务（绝不静默跳过审计）', async () => {
      await expect(service.confirmExtraction('p1', dto())).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('停用专家被资格复核拒绝（EXPERT_INELIGIBLE），不写审计', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', suppliers: [] });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: false, expertProfile: { availability: '停用' }, bidExperts: [] },
      ]);
      await expect(service.confirmExtraction('p1', dto(), 'op1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('已分配本项目的专家重复确认 → 替换式重写（非追加模式清旧写新，不拒绝）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', suppliers: [] });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', entryStatus: 'ACTIVE' }, bidExperts: [{ id: 'be1' }] },
      ]);
      const res = await service.confirmExtraction('p1', dto(), 'op1');
      expect(res.success).toBe(true);
      expect(prisma.bidExpert.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
      expect(prisma.bidExpert.upsert).toHaveBeenCalled();
    });

    it('工作单位关联投标供应商被回避拒绝（EXPERT_CONFLICT）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目',
        suppliers: [{ supplier: { name: '川西建设' }, supplierName: '川西建设', confirmStatus: 'CONFIRMED' }],
      });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', entryStatus: 'ACTIVE', employer: '川西建设公司' }, bidExperts: [] },
      ]);
      await expect(service.confirmExtraction('p1', dto(), 'op1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('P1-5：回避口径含「已投递但尚未确认开标」的供应商（开标前抽取不再空集）', async () => {
      // 已投递 / confirmStatus=PENDING——旧口径(confirmStatus===CONFIRMED)恒空集，回避形同虚设
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目',
        suppliers: [
          { supplier: { name: '川西建设' }, supplierName: '川西建设', submitStatus: '已提交', confirmStatus: 'PENDING' },
          { supplier: { name: '待投递公司' }, supplierName: '待投递公司', submitStatus: '待提交', confirmStatus: 'PENDING' },
        ],
      });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', entryStatus: 'ACTIVE', employer: '川西建设公司' }, bidExperts: [] },
      ]);
      await expect(service.confirmExtraction('p1', dto(), 'op1')).rejects.toMatchObject({
        response: { code: 'EXPERT_CONFLICT' },
      });
    });

    it('P1-7：isPurchaserRepresentative 标识随抽取确认持久化（默认 false）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', stage: 'SUBMIT', suppliers: [] });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', entryStatus: 'ACTIVE' }, bidExperts: [] },
      ]);
      await service.confirmExtraction('p1', {
        projectId: 'p1',
        experts: [{ userId: 'u1', expertName: '甲', major: '采购', isPurchaserRepresentative: true }],
      } as any, 'op1');
      expect(prisma.bidExpert.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ isPurchaserRepresentative: true }),
        update: expect.objectContaining({ isPurchaserRepresentative: true }),
      }));
    });

    it('P1-6：项目已进入评标阶段时禁非追加重抽（deleteMany 会摧毁评分/签字状态）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', stage: 'EVALUATING', suppliers: [] });
      await expect(service.confirmExtraction('p1', dto(), 'op1'))
        .rejects.toMatchObject({ response: { code: 'RE_EXTRACTION_LOCKED' } });
      expect(prisma.bidExpert.deleteMany).not.toHaveBeenCalled();
    });

    it('P1-6：评标阶段追加模式（append）仍放行补选', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', stage: 'EVALUATING', suppliers: [] });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', entryStatus: 'ACTIVE' }, bidExperts: [] },
      ]);
      const res = await service.confirmExtraction('p1', { projectId: 'p1', experts: [{ userId: 'u1', expertName: '甲', major: '造价' }], candidates: [], append: true } as any, 'op1');
      expect(res.success).toBe(true);
      expect(prisma.bidExpert.deleteMany).not.toHaveBeenCalled();
    });

    it('P1-6：SUBMIT 阶段整体重抽仍允许（正常补抽场景）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', stage: 'SUBMIT', suppliers: [] });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', entryStatus: 'ACTIVE' }, bidExperts: [] },
      ]);
      const res = await service.confirmExtraction('p1', dto(), 'op1');
      expect(res.success).toBe(true);
    });

    it('成功抽取应写入 BidExpert 与审计日志（同一事务）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', suppliers: [] });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', entryStatus: 'ACTIVE', employer: '设计院' }, bidExperts: [] },
      ]);
      const res = await service.confirmExtraction('p1', dto(), 'op1');
      expect(res.success).toBe(true);
      expect(prisma.bidExpert.upsert).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'op1', action: 'EXPERT_EXTRACTION_CONFIRMED', resourceId: 'p1' }),
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('P0-4：创建/更新的正选与候补专家 phoneVerified 均置 true（真实链路签到死锁止血）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', suppliers: [] });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', entryStatus: 'ACTIVE' }, bidExperts: [] },
        { id: 'u2', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', entryStatus: 'ACTIVE' }, bidExperts: [] },
      ]);
      const res = await service.confirmExtraction('p1', {
        projectId: 'p1',
        experts: [{ userId: 'u1', expertName: '甲', major: '造价' }],
        candidates: [{ userId: 'u2', expertName: '乙', major: '地质' }],
      } as any, 'op1');
      expect(res.success).toBe(true);
      expect(prisma.bidExpert.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId_userId: { projectId: 'p1', userId: 'u1' } },
        create: expect.objectContaining({ phoneVerified: true }),
        update: expect.objectContaining({ phoneVerified: true }),
      }));
      expect(prisma.bidExpert.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId_userId: { projectId: 'p1', userId: 'u2' } },
        create: expect.objectContaining({ expertRole: '候补', phoneVerified: true }),
        update: expect.objectContaining({ expertRole: '候补', phoneVerified: true }),
      }));
    });
  });
});
