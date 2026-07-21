import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
        update: jest.fn().mockResolvedValue({}),
      },
      bidExpert: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      expertEvaluation: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      expertProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
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
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', displayName: '王建国', username: 'wangjg' });
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
      expect(rows[1].expertUserId).toBe('userA');
      expect(rows[1].displayName).toBe('专家甲');
    });
  });

  describe('setAvailability（越权防护回归）', () => {
    it('非专家角色应被拒绝（防止越权封号 admin/员工）', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u9', role: 'admin' });
      await expect(service.setAvailability('u9', false)).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
    it('专家角色正常启停', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'bid_expert' });
      await expect(service.setAvailability('u1', false)).resolves.toEqual({ success: true });
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
});
