import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';

describe('ExpertAdminService', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let extractionAi: any;
  let notification: any;

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
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertExtractionAiService, useValue: extractionAi },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn(), sendToUser: jest.fn().mockResolvedValue({}) } },
        { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue([]) } },
        { provide: LlmService, useValue: { chat: jest.fn(), chatJson: jest.fn(), getModel: jest.fn().mockReturnValue(null) } },
        { provide: OcrService, useValue: { isAvailable: jest.fn().mockResolvedValue(false), ocrImage: jest.fn() } },
        { provide: ExpertCrossConflictService, useValue: { checkCrossConflicts: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get<ExpertAdminService>(ExpertAdminService);
    notification = module.get(NotificationService);
  });

  describe('listExperts', () => {
    it('应返回专家列表含评审统计', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '王建国', email: 'wang@test.com', department: { id: 'd1', name: '工程部' }, bidExperts: [{ id: 'e1', progress: 80, major: '水利工程', project: { name: '测试项目', stage: 'EVALUATING' } }] },
        { id: 'u2', displayName: '刘晓梅', email: 'liu@test.com', department: null, bidExperts: [] },
      ]);

      const result = await service.listExperts();
      expect(result.items).toHaveLength(2);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ role: 'bid_expert' }) }),
      );
    });

    it('应支持搜索（姓名/专业/单位/部门 OR 模糊）', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.listExperts('王');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ displayName: { contains: '王', mode: 'insensitive' } }),
            ]),
          }),
        }),
      );
    });

    it('只传专业不传公司时专业筛选不丢失（专业配额行人数按专业计数）', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(3);
      await service.listExperts(undefined, '地质');
      expect(prisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ expertProfile: { specialty: '地质' } }) }),
      );
    });

    it('专业与公司同时传入时两者都生效', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.listExperts(undefined, '地质', '设计院');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ expertProfile: { specialty: '地质', employer: '设计院' } }) }),
      );
    });
  });

  describe('getExpert', () => {
    it('应返回专家详情含统计', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', displayName: '王建国', username: 'wangjg', role: 'bid_expert' });
      prisma.bidExpert.findMany.mockResolvedValue([
        { progress: 100, signedIn: true, project: { name: '项目A' }, scoreRecords: [] },
        { progress: 50, signedIn: false, project: { name: '项目B' }, scoreRecords: [] },
      ]);
      prisma.expertEvaluation.findMany.mockResolvedValue([]);

      const result = await service.getExpert('u1');
      expect(result.statistics.totalProjects).toBe(2);
      expect(result.statistics.completedProjects).toBe(1);
      expect(result.statistics.signedInProjects).toBe(1);
    });

    it('用户不存在应抛 NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getExpert('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listExpertProjects', () => {
    it('应返回专家参与的项目列表', async () => {
      prisma.bidExpert.findMany.mockResolvedValue([
        { id: 'e1', project: { id: 'p1', name: '项目A', stage: 'EVALUATING' } },
      ]);

      const result = await service.listExpertProjects('u1');
      expect(result).toHaveLength(1);
      expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });
  });

  describe('getRanking（排名 id 错位回归 · 按 A 级数降序）', () => {
    it('排序后 expertUserId 必须与对应行一致，不张冠李戴', async () => {
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'userA', overallGrade: 'C', expertUser: { displayName: '专家甲', expertProfile: { specialty: '施工' } } },
        { expertUserId: 'userB', overallGrade: 'A', expertUser: { displayName: '专家乙', expertProfile: { specialty: '地质' } } },
      ]);
      const rows = await service.getRanking('all');
      expect(rows[0].rank).toBe(1);
      expect(rows[0].expertUserId).toBe('userB'); // A 级数多者居首且 id 对齐
      expect(rows[0].displayName).toBe('专家乙');
      expect(rows[0].aCount).toBe(1); // 行内等级统计与 id 同源，杜绝张冠李戴
      expect(rows[0].gradeCounts).toEqual({ A: 1, B: 0, C: 0, D: 0, E: 0 });
      expect(rows[1].expertUserId).toBe('userA');
      expect(rows[1].displayName).toBe('专家甲');
      expect(rows[1].aCount).toBe(0);
      expect(rows[1].gradeCounts).toEqual({ A: 0, B: 0, C: 1, D: 0, E: 0 });
    });

    it('完全并列应共享名次（竞赛排名 1,1）', async () => {
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'uX', overallGrade: 'B', expertUser: { displayName: 'X', expertProfile: { specialty: '施工' } } },
        { expertUserId: 'uY', overallGrade: 'B', expertUser: { displayName: 'Y', expertProfile: { specialty: '地质' } } },
      ]);
      const rows = await service.getRanking('all');
      expect(rows[0].rank).toBe(1);
      expect(rows[1].rank).toBe(1);
      expect(rows[0].aCount).toBe(0); // 并列键 = aCount|evalCount，两者均为 0|1
      expect(rows[0].evalCount).toBe(1);
    });
  });

  describe('setAvailability（越权防护回归）', () => {
    it('非专家角色应被拒绝（防止越权封号 admin/员工）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u9', role: 'admin' });
      await expect(service.setAvailability('u9', false)).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it('专家角色正常启停（停用须真写 isActive=false 与 availability）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      await expect(service.setAvailability('u1', false)).resolves.toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: { isActive: false } }),
      );
      expect(prisma.expertProfile.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' }, data: { availability: '停用' } }),
      );
    });
  });

  describe('confirmRetire / updateProfile（越权防护回归）', () => {
    it('confirmRetire 拒绝非专家', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u9', role: 'leader' });
      await expect(service.confirmRetire('u9', '测试')).rejects.toThrow(NotFoundException);
    });
    it('updateProfile 拒绝非专家', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u9', role: 'staff' });
      await expect(service.updateProfile('u9', { displayName: 'x' })).rejects.toThrow(NotFoundException);
    });
    it('A-129：regionCode/expertLevel 随管理端编辑落 expertProfile（update 与 create 两分支都带）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      await service.updateProfile('u1', { regionCode: '510000', expertLevel: 'B' });
      expect(prisma.expertProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          update: expect.objectContaining({ regionCode: '510000', expertLevel: 'B' }),
          create: expect.objectContaining({ regionCode: '510000', expertLevel: 'B' }),
        }),
      );
    });
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
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          expertProfile: expect.not.objectContaining({ regionCode: expect.anything() }),
        }),
      }));
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          expertProfile: expect.not.objectContaining({ expertLevel: expect.anything() }),
        }),
      }));
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

  describe('setLeader（P1-7 采购人代表禁任组长）', () => {
    it('采购人代表被拒绝担任组长', async () => {
      prisma.bidExpert.findUnique.mockResolvedValue({ projectId: 'p1', userId: 'u1', expertRole: '正选', isPurchaserRepresentative: true });
      await expect(service.setLeader('p1', 'u1')).rejects.toThrow('采购人代表不得担任评审组长');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('非代表的正选专家可正常设为组长', async () => {
      prisma.bidExpert.findUnique.mockResolvedValue({ projectId: 'p1', userId: 'u1', expertRole: '正选', isPurchaserRepresentative: false });
      prisma.bidExpert.updateMany.mockResolvedValue({ count: 0 });
      prisma.bidExpert.update.mockResolvedValue({});
      const r = await service.setLeader('p1', 'u1');
      expect(r.success).toBe(true);
    });
  });

  describe('createEvaluation（项目归属校验 + 去重防刷 + 综合等级计算）', () => {
    const evalDto = (over: any = {}) =>
      ({ expertUserId: 'u1', attendanceGrade: 'A', qualityGrade: 'A', disciplineGrade: 'A', ...over }) as any;

    it('projectId 指向不存在的项目应拒绝', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.bidProject.findUnique.mockResolvedValue(null);
      await expect(service.createEvaluation('op1', evalDto({ projectId: 'ghost' }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('专家未参与该项目应拒绝评价', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.createEvaluation('op1', evalDto({ projectId: 'p1' }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('综合等级：三维同等级直接映射（A/B/C/D/E → overallGrade 同级）', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.expertEvaluation.findFirst.mockResolvedValue(null);
      prisma.expertEvaluation.create.mockImplementation(async ({ data }: any) => ({ ...data, evaluator: { id: 'op1', displayName: '评' } }));
      const mk = (g: string) => service.createEvaluation('op1', evalDto({ attendanceGrade: g, qualityGrade: g, disciplineGrade: g }));
      expect((await mk('A')).overallGrade).toBe('A');
      expect((await mk('B')).overallGrade).toBe('B');
      expect((await mk('C')).overallGrade).toBe('C');
      expect((await mk('D')).overallGrade).toBe('D');
      expect((await mk('E')).overallGrade).toBe('E');
    });

    it('综合等级：加权 quality×0.5 + discipline×0.3 + attendance×0.2（四舍五入映射回等级）', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.expertEvaluation.findFirst.mockResolvedValue(null);
      prisma.expertEvaluation.create.mockImplementation(async ({ data }: any) => ({ ...data, evaluator: { id: 'op1', displayName: '评' } }));
      const mk = (q: string, d: string, a: string) =>
        service.createEvaluation('op1', evalDto({ qualityGrade: q, disciplineGrade: d, attendanceGrade: a }));
      // 5×0.5 + 4×0.3 + 3×0.2 = 4.3 → round 4 → B
      expect((await mk('A', 'B', 'C')).overallGrade).toBe('B');
      // 5×0.5 + 4×0.3 + 4×0.2 = 4.5 → round 5 → A（0.5 进位）
      expect((await mk('A', 'B', 'B')).overallGrade).toBe('A');
      // 4×0.5 + 3×0.3 + 2×0.2 = 3.3 → round 3 → C
      expect((await mk('B', 'C', 'D')).overallGrade).toBe('C');
      // 1×0.5 + 1×0.3 + 2×0.2 = 1.2 → round 1 → E
      expect((await mk('E', 'E', 'D')).overallGrade).toBe('E');
    });

    it('同一评价者对同一专家重复评价应更新而非新增（防刷 E 级）', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.expertEvaluation.findFirst.mockResolvedValue({ id: 'ev1' });
      prisma.expertEvaluation.update.mockResolvedValue({ id: 'ev1', overallGrade: 'A' });
      await service.createEvaluation('op1', evalDto({ attendanceGrade: 'A', qualityGrade: 'A', disciplineGrade: 'A' }));
      expect(prisma.expertEvaluation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ev1' },
          // 三维等级与综合等级一并落库
          data: expect.objectContaining({
            attendanceGrade: 'A', qualityGrade: 'A', disciplineGrade: 'A', overallGrade: 'A',
          }),
        }),
      );
      expect(prisma.expertEvaluation.create).not.toHaveBeenCalled();
    });
  });

  describe('unconfirmReport（谈判采购报价轮冻结闸门）', () => {
    it('谈判采购且已有报价轮 → ROUNDS_STARTED_LOCKED，且不清理末签/不撤销确认', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', leaderCoSigned: true, procurementMethod: '谈判采购' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1', projectId: 'p1', expertName: '王工', reportConfirmed: true });
      prisma.bidRound.count.mockResolvedValue(1);

      await expect(service.unconfirmReport('p1', 'e1', '需改分', 'u1'))
        .rejects.toMatchObject({ response: { code: 'ROUNDS_STARTED_LOCKED' } });
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
      expect(prisma.bidExpert.update).not.toHaveBeenCalled();
    });

    it('谈判采购无报价轮 → 正常撤销（清组长末签 + 取消确认 + 监督日志）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', leaderCoSigned: true, procurementMethod: '谈判采购' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1', projectId: 'p1', expertName: '王工', reportConfirmed: true });
      prisma.bidRound.count.mockResolvedValue(0);

      const result = await service.unconfirmReport('p1', 'e1', '需改分', 'u1');

      expect(result).toEqual({ success: true });
      expect(prisma.bidProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({ leaderCoSigned: false }),
        }),
      );
      expect(prisma.bidExpert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1' },
          data: expect.objectContaining({ reportConfirmed: false }),
        }),
      );
      expect(prisma.bidSupervisionLog.create).toHaveBeenCalled();
    });

    it('竞价采购已有报价轮 → 闸门不生效，正常撤销', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'EVALUATING', leaderCoSigned: false, procurementMethod: '竞价采购' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1', projectId: 'p1', expertName: '王工', reportConfirmed: true });
      prisma.bidRound.count.mockResolvedValue(1); // 应被忽略

      const result = await service.unconfirmReport('p1', 'e1', '需改分', 'u1');

      expect(result).toEqual({ success: true });
      expect(prisma.bidExpert.update).toHaveBeenCalled();
      expect(prisma.bidProject.update).not.toHaveBeenCalled(); // 未末签，无需清理
    });
  });

  describe('sendExtractionNotify — N6 补漏：追加链接文案与实际 TTL 一致', () => {
    afterEach(() => {
      delete process.env.EXPERT_RSVP_TTL_HOURS;
    });

    const setupNotify = () => {
      prisma.bidProject.findUnique.mockResolvedValue({ name: '测试项目', projectCode: 'BID-1' });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '专家A', expertProfile: { phone: '13800000000' } },
      ]);
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', rsvpToken: 'tok-1' });
    };

    it('无 {RSVP_LINK} 占位符时追加「确认链接（2小时内有效）」（默认 TTL，不再写死 15分钟）', async () => {
      delete process.env.EXPERT_RSVP_TTL_HOURS;
      setupNotify();

      await service.sendExtractionNotify('p1', ['u1'], ['in_app'], '');

      expect(notification.sendToUser).toHaveBeenCalledTimes(1);
      const content = notification.sendToUser.mock.calls[0][2].content;
      expect(content).toContain('确认链接（2小时内有效）');
      expect(content).not.toContain('15分钟');
    });

    it('EXPERT_RSVP_TTL_HOURS=6 时追加文案同步为「6小时内有效」', async () => {
      process.env.EXPERT_RSVP_TTL_HOURS = '6';
      setupNotify();

      await service.sendExtractionNotify('p1', ['u1'], ['in_app'], '');

      const content = notification.sendToUser.mock.calls[0][2].content;
      expect(content).toContain('确认链接（6小时内有效）');
    });
  });

  describe('N6 收尾：rsvpTtlMs 真单源（非法 env 回退 2 小时）', () => {
    // rsvpTtlMs 是类字段，实例化时取 env——须在编译模块前置 env（外层 beforeEach 已编译默认实例）
    const buildSvc = async () => {
      const mod = await Test.createTestingModule({
        providers: [
          ExpertAdminService,
          { provide: PrismaService, useValue: prisma },
          { provide: ExpertExtractionAiService, useValue: extractionAi },
          { provide: NotificationService, useValue: notification },
          { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue([]) } },
          { provide: LlmService, useValue: { chat: jest.fn(), chatJson: jest.fn(), getModel: jest.fn().mockReturnValue(null) } },
          { provide: OcrService, useValue: { isAvailable: jest.fn().mockResolvedValue(false), ocrImage: jest.fn() } },
          { provide: ExpertCrossConflictService, useValue: { checkCrossConflicts: jest.fn().mockResolvedValue([]) } },
        ],
      }).compile();
      return mod.get(ExpertAdminService);
    };

    afterEach(() => {
      delete process.env.EXPERT_RSVP_TTL_HOURS;
    });

    it.each(['abc', '0'])('EXPERT_RSVP_TTL_HOURS=%s → rsvpTtlMs 回退 2 小时（7200000ms）', async (v) => {
      process.env.EXPERT_RSVP_TTL_HOURS = v;
      const svc = await buildSvc();
      expect(svc['rsvpTtlMs']).toBe(2 * 60 * 60 * 1000);
    });

    it('EXPERT_RSVP_TTL_HOURS=6 → rsvpTtlMs=6 小时（与文案同源）', async () => {
      process.env.EXPERT_RSVP_TTL_HOURS = '6';
      const svc = await buildSvc();
      expect(svc['rsvpTtlMs']).toBe(6 * 60 * 60 * 1000);
    });
  });

  describe('N7 婉拒/过期递补统一', () => {
    it('admin declineInvitation 触发 autoPromoteCandidate 并回传 promoted', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', invitationStatus: 'pending', expertRole: '正选' });
      prisma.bidExpert.update.mockResolvedValue({});
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue({ userId: 'u9', expertName: '候补A', major: '技术' });
      const res = await service.declineInvitation('p1', 'u1');
      expect((service as any).autoPromoteCandidate).toHaveBeenCalledWith('p1');
      expect(res.promoted).toMatchObject({ expertName: '候补A' });
    });

    it('D7：候补 declineInvitation 不递补——无正选空缺，promoted=null（防超编转正+徒耗候补席）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-2', invitationStatus: 'pending', expertRole: '候补' });
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue({ userId: 'u9', expertName: '候补A' });
      const res = await service.declineInvitation('p1', 'u1');
      expect((service as any).autoPromoteCandidate).not.toHaveBeenCalled();
      expect(res).toEqual({ success: true, status: 'declined', promoted: null });
    });

    it('declineInvitation 递补失败时静默——婉拒仍成功，promoted=null（与 RSVP 链接路径同款 catch）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
      prisma.bidExpert.findFirst.mockResolvedValue({ id: 'be-1', invitationStatus: 'pending', expertRole: '正选' });
      (service as any).autoPromoteCandidate = jest.fn().mockRejectedValue(new Error('DB 抖动'));
      const res = await service.declineInvitation('p1', 'u1');
      expect(res).toEqual({ success: true, status: 'declined', promoted: null });
    });

    it('getProjectInvitations 过期清扫含正选时触发一次递补', async () => {
      prisma.bidExpert.findMany
        .mockResolvedValueOnce([{ id: 'be-1', expertRole: '正选' }])   // 过期查询
        .mockResolvedValue([]);                                        // 列表查询
      prisma.bidExpert.updateMany.mockResolvedValue({ count: 1 });
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue(null);
      await service.getProjectInvitations('p1');
      expect((service as any).autoPromoteCandidate).toHaveBeenCalledWith('p1');
      expect((service as any).autoPromoteCandidate).toHaveBeenCalledTimes(1);
    });

    it('过期行全是候补时不递补（避免误替换仍待命的正选）', async () => {
      prisma.bidExpert.findMany
        .mockResolvedValueOnce([{ id: 'be-1', expertRole: '候补' }])   // 过期查询
        .mockResolvedValue([]);                                        // 列表查询
      prisma.bidExpert.updateMany.mockResolvedValue({ count: 1 });
      (service as any).autoPromoteCandidate = jest.fn().mockResolvedValue(null);
      await service.getProjectInvitations('p1');
      expect((service as any).autoPromoteCandidate).not.toHaveBeenCalled();
    });
  });
});
