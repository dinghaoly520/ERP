import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';

describe('ExpertAdminService', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let extractionAi: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      bidExpert: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      bidProject: {
        findUnique: jest.fn(),
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
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn() } },
        { provide: EmbeddingService, useValue: { embed: jest.fn().mockResolvedValue([]) } },
        { provide: LlmService, useValue: { chat: jest.fn(), chatJson: jest.fn(), getModel: jest.fn().mockReturnValue(null) } },
        { provide: OcrService, useValue: { isAvailable: jest.fn().mockResolvedValue(false), ocrImage: jest.fn() } },
      ],
    }).compile();

    service = module.get<ExpertAdminService>(ExpertAdminService);
  });

  describe('listExperts', () => {
    it('应返回专家列表含评审统计', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', displayName: '王建国', email: 'wang@test.com', department: { id: 'd1', name: '工程部' }, bidExperts: [{ id: 'e1', progress: 80, major: '水利工程', project: { name: '测试项目', stage: 'EVALUATING' } }] },
        { id: 'u2', displayName: '刘晓梅', email: 'liu@test.com', department: null, bidExperts: [] },
      ]);

      const result = await service.listExperts();
      expect(result).toHaveLength(2);
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

  describe('getRanking（排名 id 错位回归）', () => {
    it('排序后 expertUserId 必须与对应行一致，不张冠李戴', async () => {
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'userA', overallScore: 60, level: 'C', expertUser: { displayName: '专家甲', expertProfile: { specialty: '施工' } } },
        { expertUserId: 'userB', overallScore: 95, level: 'A', expertUser: { displayName: '专家乙', expertProfile: { specialty: '地质' } } },
      ]);
      const rows = await service.getRanking('all');
      expect(rows[0].rank).toBe(1);
      expect(rows[0].expertUserId).toBe('userB'); // 高分者居首且 id 对齐
      expect(rows[0].displayName).toBe('专家乙');
      expect(rows[0].avgScore).toBe(95); // 行内分数与 id 同源，杜绝张冠李戴
      expect(rows[1].expertUserId).toBe('userA');
      expect(rows[1].displayName).toBe('专家甲');
      expect(rows[1].avgScore).toBe(60);
    });

    it('完全并列应共享名次（竞赛排名 1,1）', async () => {
      prisma.expertEvaluation.findMany.mockResolvedValue([
        { expertUserId: 'uX', overallScore: 88, level: 'B', expertUser: { displayName: 'X', expertProfile: { specialty: '施工' } } },
        { expertUserId: 'uY', overallScore: 88, level: 'B', expertUser: { displayName: 'Y', expertProfile: { specialty: '地质' } } },
      ]);
      const rows = await service.getRanking('all');
      expect(rows[0].rank).toBe(1);
      expect(rows[1].rank).toBe(1);
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
        { id: 'u1', displayName: '甲', isActive: true, expertProfile: { specialty: '施工', availability: '可用', title: '高级工程师', employer: '川西分公司' }, bidExperts: [], _count: { bidExperts: 3 } },
        { id: 'u2', displayName: '乙', isActive: true, expertProfile: { specialty: '地质', availability: '可用', title: '工程师', employer: '设计院' }, bidExperts: [], _count: { bidExperts: 1 } },
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

    it('已分配本项目的专家被拒绝（EXPERT_ALREADY_ASSIGNED）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', suppliers: [] });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用' }, bidExperts: [{ id: 'be1' }] },
      ]);
      await expect(service.confirmExtraction('p1', dto(), 'op1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('工作单位关联投标供应商被回避拒绝（EXPERT_CONFLICT）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({
        id: 'p1', name: '项目',
        suppliers: [{ supplier: { name: '川西建设' }, supplierName: '川西建设' }],
      });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', employer: '川西建设公司' }, bidExperts: [] },
      ]);
      await expect(service.confirmExtraction('p1', dto(), 'op1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('成功抽取应写入 BidExpert 与审计日志（同一事务）', async () => {
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', name: '项目', suppliers: [] });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'bid_expert', isActive: true, expertProfile: { availability: '可用', employer: '设计院' }, bidExperts: [] },
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
  });

  describe('createEvaluation（项目归属校验 + 去重防刷 + 定级阈值）', () => {
    const evalDto = (over: any = {}) =>
      ({ expertUserId: 'u1', attendanceScore: 90, qualityScore: 90, disciplineScore: 90, ...over }) as any;

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

    it('等级阈值：90→A / 89→B / 60→C / 59→D', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.expertEvaluation.findFirst.mockResolvedValue(null);
      prisma.expertEvaluation.create.mockImplementation(async ({ data }: any) => ({ ...data, evaluator: { id: 'op1', displayName: '评' } }));
      const mk = (s: number) => service.createEvaluation('op1', evalDto({ attendanceScore: s, qualityScore: s, disciplineScore: s }));
      expect((await mk(90)).level).toBe('A');
      expect((await mk(89)).level).toBe('B');
      expect((await mk(60)).level).toBe('C');
      expect((await mk(59)).level).toBe('D');
    });

    it('同一评价者对同一专家重复评价应更新而非新增（防刷 D 级）', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      prisma.expertEvaluation.findFirst.mockResolvedValue({ id: 'ev1' });
      prisma.expertEvaluation.update.mockResolvedValue({ id: 'ev1', level: 'A' });
      await service.createEvaluation('op1', evalDto({ attendanceScore: 95, qualityScore: 95, disciplineScore: 95 }));
      expect(prisma.expertEvaluation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ev1' } }));
      expect(prisma.expertEvaluation.create).not.toHaveBeenCalled();
    });
  });
});
