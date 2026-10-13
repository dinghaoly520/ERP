import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { ExpertExtractionService } from './expert-extraction.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 履职评价·关联项目（真实参评）三件套：
 * listEvaluationProjects / getEvaluationProjectDetail / analyzeExpertBehavior。
 * 数据场景：两专家委员会（be-1 目标、be-2 同侪），
 *   S1 供应商：be-1 [40,40]=80、be-2 [50,40]=90 → 均分 85；官方结果均分 85.5（rank 1）
 *   S2 供应商：仅 be-1 [70] → 无共识、无官方结果（评标中）
 */
describe('ExpertAdminService — 履职评价关联项目与 AI 行为分析', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let llm: { chat: jest.Mock };

  const now = new Date('2026-10-01T09:00:00Z');

  const assignmentRow = {
    id: 'be-1', expertName: '刘苡池', major: '水工结构', expertRole: '正选', invitationStatus: 'confirmed',
    signedIn: true, identityVerified: true, avoidanceConfirmed: true, confidentialityAgreed: true,
    disciplineAgreed: true, roomVerifiedAt: now, progress: 100, totalScore: 150,
    reportConfirmed: false, reportConfirmedAt: null, signStatus: 'SIGNED',
    dissentingOpinion: null, isLead: false, reviewGroup: null, dutyRole: null, createdAt: now,
    project: { id: 'p1', name: '英雄项目', stage: 'EVALUATING', procurementMethod: '公开招标', openTime: now, deadline: now, evaluationDeadline: now },
  };
  const committeeRows = [
    { id: 'be-1', signedIn: true },
    { id: 'be-2', signedIn: true },
  ];
  const scoreRecords = [
    { expertId: 'be-1', supplierId: 'S1', scoreItemId: 'I1', score: 40, createdAt: now, updatedAt: now },
    { expertId: 'be-1', supplierId: 'S1', scoreItemId: 'I2', score: 40, createdAt: now, updatedAt: now },
    { expertId: 'be-2', supplierId: 'S1', scoreItemId: 'I1', score: 50, createdAt: now, updatedAt: now },
    { expertId: 'be-2', supplierId: 'S1', scoreItemId: 'I2', score: 40, createdAt: now, updatedAt: now },
    { expertId: 'be-1', supplierId: 'S2', scoreItemId: 'I3', score: 70, createdAt: now, updatedAt: now },
  ];
  const resultRows = [
    { supplierId: 'S1', supplierName: '蜀通岩土', totalScore: 175, averageScore: 85.5, rank: 1, recommended: true, disqualified: false, bidPrice: 980000, generatedAt: now },
  ];

  beforeEach(async () => {
    llm = { chat: jest.fn() };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', companyId: 'co-1', displayName: '刘苡池' }) },
      bidExpert: {
        findFirst: jest.fn().mockResolvedValue(assignmentRow),
        findMany: jest.fn().mockImplementation((args: any) => (args?.where?.userId ? [] : committeeRows)),
      },
      bidScoreRecord: { findMany: jest.fn().mockResolvedValue(scoreRecords) },
      bidScoreRecordHistory: { count: jest.fn().mockResolvedValue(3) },
      bidEvaluationResult: {
        findMany: jest.fn().mockResolvedValue(resultRows),
        groupBy: jest.fn().mockResolvedValue([{ projectId: 'p1' }]),
      },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([{ id: 'S2', supplierName: '中科院成都信息' }]) },
      expertEvaluation: { findMany: jest.fn().mockResolvedValue([{ overallGrade: 'B' }, { overallGrade: 'A' }]) },
      auditLog: { count: jest.fn().mockResolvedValue(0) },
    };
    const module = await Test.createTestingModule({
      providers: [
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertCrossConflictService, useValue: {} },
        { provide: ExpertExtractionAiService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: LlmService, useValue: llm },
        { provide: OcrService, useValue: {} },
        { provide: ExpertExtractionService, useValue: {} },
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), assertInScope: jest.fn() } },
      ],
    }).compile();
    service = module.get(ExpertAdminService);
  });

  const actor = { sub: 'staff-1', role: 'staff', displayName: '采购员' } as any;

  describe('listEvaluationProjects（真实参评列表）', () => {
    it('按 BidExpert 分配返回富化行，评标结果有无按 groupBy 标注', async () => {
      prisma.bidExpert.findMany.mockImplementation((args: any) => (args?.where?.userId ? [
        {
          projectId: 'p1', expertRole: '正选', invitationStatus: 'confirmed', signedIn: true, isLead: false,
          progress: 100, reportConfirmed: false, reviewGroup: null, dutyRole: null,
          project: { id: 'p1', name: '英雄项目', stage: 'EVALUATING', procurementMethod: '公开招标', openTime: now },
          _count: { scoreRecords: 3, expertMemos: 1 },
        },
        {
          projectId: 'p2', expertRole: '候补', invitationStatus: 'pending', signedIn: false, isLead: false,
          progress: 0, reportConfirmed: false, reviewGroup: null, dutyRole: null,
          project: { id: 'p2', name: '常规项目', stage: 'OPENING', procurementMethod: '公开招标', openTime: now },
          _count: { scoreRecords: 0, expertMemos: 0 },
        },
      ] : []));

      const rows = await service.listEvaluationProjects('u1', actor);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ projectId: 'p1', scoreCount: 3, memoCount: 1, resultsGenerated: true, signedIn: true });
      expect(rows[1]).toMatchObject({ projectId: 'p2', expertRole: '候补', resultsGenerated: false, scoreCount: 0 });
      // 公司隔离：scope 校验先行
      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
    });
  });

  describe('getEvaluationProjectDetail（评标结果窗口数据）', () => {
    it('未参与该项目 → 404 EXPERT_NOT_ON_PROJECT', async () => {
      prisma.bidExpert.findFirst.mockResolvedValue(null);
      await expect(service.getEvaluationProjectDetail('u1', 'pX', actor)).rejects.toMatchObject({
        response: { code: 'EXPERT_NOT_ON_PROJECT' },
      });
      await expect(service.getEvaluationProjectDetail('u1', 'pX', actor)).rejects.toThrow(NotFoundException);
    });

    it('官方结果行与专家已评未出结果行合并：均分/偏差/极值/逐项偏离口径', async () => {
      const d = await service.getEvaluationProjectDetail('u1', 'p1', actor);

      // 委员会：正选 2、签到 2、已交分 2（be-1/be-2 均有记录）
      expect(d.committee).toEqual({ size: 2, signedIn: 2, scored: 2 });
      expect(d.resultsGenerated).toBe(true);

      // S1：官方均分 85.5 为偏差基准 → 80 - 85.5 = -5.5；S2：无官方结果 → 委员会实时均分 70，偏差 0
      expect(d.rows[0]).toMatchObject({
        supplierName: '蜀通岩土', rank: 1, expertScore: 80, committeeMean: 85, officialAverage: 85.5,
        deviation: -5.5, recommended: true, bidPrice: 980000,
      });
      // S2 名称回查 BidSupplier；单专家评分 → 不计极值、无共识组
      expect(d.rows[1]).toMatchObject({
        supplierName: '中科院成都信息', rank: null, expertScore: 70, committeeMean: 70,
        deviation: 0, officialAverage: null, recommended: null,
      });
      expect(prisma.bidSupplier.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['S2'] } } }));

      // 行为统计：逐项偏离 (|40-45| + |40-40|)/2 = 2.5；be-1 对 S1 打出唯一最低分 → 极值 1 家
      expect(d.scoreStats).toMatchObject({
        itemCount: 3, supplierCount: 2, meanItemDeviation: 2.5, deviationSamples: 2,
        extremeSupplierCount: 1, editCount: 3,
      });
    });
  });

  describe('analyzeExpertBehavior（AI 行为分析）', () => {
    it('LLM 不可用 → 规则兜底：报告未确认计入发现，风险「关注」', async () => {
      llm.chat.mockRejectedValue(new Error('LLM down'));
      const res = await service.analyzeExpertBehavior('u1', 'p1', actor);
      expect(res.engine).toBe('rules');
      expect(res.riskLevel).toBe('关注');
      expect(res.findings).toContain('评分已提交但评标报告尚未确认');
      expect(res.analysis).toContain('完成 3 项评分');
      expect(res.suggestion).toBeTruthy();
    });

    it('LLM 正常 → ai 引擎 + 结构化结论；非法 riskLevel 回退「关注」', async () => {
      llm.chat.mockResolvedValue('{"riskLevel":"预警","findings":["对 S1 打分显著低于共识","评分修改 3 次"],"analysis":"综合分析…","suggestion":"建议约谈"}');
      const res = await service.analyzeExpertBehavior('u1', 'p1', actor);
      expect(res.engine).toBe('ai');
      expect(res.riskLevel).toBe('预警');
      expect(res.findings).toHaveLength(2);
      expect(res.suggestion).toBe('建议约谈');

      llm.chat.mockResolvedValue('{"riskLevel":"极高","findings":[],"analysis":"x","suggestion":"y"}');
      const fallbackLevel = await service.analyzeExpertBehavior('u1', 'p1', actor);
      expect(fallbackLevel.riskLevel).toBe('关注');
    });
  });
});
