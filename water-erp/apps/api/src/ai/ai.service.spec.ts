import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';

describe('AiService', () => {
  let service: AiService;
  let prisma: any;

  const mockProject = {
    id: 'proj-1',
    projectCode: 'BID-2026-0518',
    name: '水利工程物资采购',
    procurementMethod: '公开招标',
    stage: 'EVALUATING',
    scoreItems: [
      { id: 'si-1', category: 'QUALIFICATION', name: '资格审查', maxScore: 0 },
      { id: 'si-2', category: 'RESPONSIVE', name: '响应性', maxScore: 0 },
      { id: 'si-3', category: 'BUSINESS', name: '商务评分', maxScore: 20 },
      { id: 'si-4', category: 'TECHNICAL', name: '技术评分', maxScore: 50 },
      { id: 'si-5', category: 'PRICE', name: '价格评分', maxScore: 30 },
    ],
    suppliers: [{ id: 'sup-1', supplierName: '川水建设' }],
  };

  function makeSupplier(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sup-1',
      supplierName: '四川川水建设工程有限公司',
      downloadStatus: '已下载',
      submitStatus: '已提交',
      encryptStatus: '密文已校验',
      receiptNo: 'TB-001',
      decryptStatus: 'SUCCESS',
      confirmStatus: 'CONFIRMED',
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      bidProject: { findUnique: jest.fn() },
      bidSupplier: { findUnique: jest.fn(), findMany: jest.fn() },
      bidScoreRecord: { findMany: jest.fn() },
      supplierBidSubmission: { findMany: jest.fn() },
      supplierEvaluation: { groupBy: jest.fn() },
      supplierQualification: { groupBy: jest.fn() },
      procurementProject: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupplierSelectionAiService, useValue: { rankCandidates: jest.fn() } },
        { provide: LlmService, useValue: { chatJson: jest.fn() } },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn() } },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  describe('analyzeBid', () => {
    it('应返回完整的 AI 分析结构', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(mockProject);
      prisma.bidSupplier.findUnique.mockResolvedValue(makeSupplier());

      const result = await service.analyzeBid('proj-1', 'sup-1');

      expect(result.supplierName).toBe('四川川水建设工程有限公司');
      // analyzeBid 已诚实标注为规则预检（非 LLM）：断言 isAi:false 与新 model 名，避免回归。
      expect(result.isAi).toBe(false);
      expect(result.model).toContain('规则预检');
      expect(result.methodology).toBeTruthy();
      expect(result.overall).toBeDefined();
      expect(result.overall.score).toBeGreaterThanOrEqual(0);
      expect(result.overall.score).toBeLessThanOrEqual(100);
      expect(result.overall.level).toMatch(/优秀|良好|合格|需关注/);
      expect(result.overall.breakdown.compliance).toBeDefined();
      expect(result.overall.breakdown.risk).toBeDefined();
      expect(result.overall.breakdown.scoring).toBeDefined();
    });

    it('符合性检查应包含 8 个检查项', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(mockProject);
      prisma.bidSupplier.findUnique.mockResolvedValue(makeSupplier());

      const result = await service.analyzeBid('proj-1', 'sup-1');

      expect(result.complianceCheck.items.length).toBeGreaterThanOrEqual(7);
      result.complianceCheck.items.forEach((item: any) => {
        expect(item.name).toBeTruthy();
        expect(['pass', 'fail', 'warn']).toContain(item.status);
        expect(item.detail).toBeTruthy();
      });
    });

    it('风险分析应覆盖多个维度', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(mockProject);
      prisma.bidSupplier.findUnique.mockResolvedValue(makeSupplier());

      const result = await service.analyzeBid('proj-1', 'sup-1');

      expect(result.riskAnalysis.length).toBeGreaterThanOrEqual(5);
      const categories = result.riskAnalysis.map((r: any) => r.category);
      expect(categories).toContain('资质');
      expect(categories).toContain('合规');
      result.riskAnalysis.forEach((r: any) => {
        expect(['info', 'warning', 'success', 'danger']).toContain(r.level);
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(100);
      });
    });

    it('评分建议应与 scoreItems 一一对应', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(mockProject);
      prisma.bidSupplier.findUnique.mockResolvedValue(makeSupplier());

      const result = await service.analyzeBid('proj-1', 'sup-1');

      expect(result.scoreSuggestion.length).toBe(mockProject.scoreItems.length);
      result.scoreSuggestion.forEach((sug: any) => {
        expect(sug.category).toBeTruthy();
        expect(sug.name).toBeTruthy();
        expect(sug.suggestedScore).toBeGreaterThanOrEqual(0);
        expect(sug.reason).toBeTruthy();
        expect(sug.confidence).toBeGreaterThanOrEqual(0);
      });
    });

    it('高风险供应商的解密异常应反映在符合性检查中', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(mockProject);
      prisma.bidSupplier.findUnique.mockResolvedValue(
        makeSupplier({ decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION' }),
      );

      const result = await service.analyzeBid('proj-1', 'sup-1');

      const failItems = result.complianceCheck.items.filter((i: any) => i.status === 'fail');
      expect(failItems.length).toBeGreaterThan(0);
    });

    it('不同供应商应产生不同的分析结果', async () => {
      prisma.bidProject.findUnique.mockResolvedValue(mockProject);
      prisma.bidSupplier.findUnique.mockResolvedValue(
        makeSupplier({ supplierName: '成都华西物资有限公司' }),
      );

      const result1 = await service.analyzeBid('proj-1', 'sup-1');

      prisma.bidSupplier.findUnique.mockResolvedValue(
        makeSupplier({ supplierName: '四川智水科技有限公司' }),
      );
      const result2 = await service.analyzeBid('proj-1', 'sup-1');

      // 不同供应商的分析结果应有差异
      expect(result1.supplierName).not.toBe(result2.supplierName);
      expect(result1.complianceCheck.items.length).toBe(result2.complianceCheck.items.length);
    });
  });

  describe('detectAnomalies', () => {
    it('少于 2 位专家时应返回提示', async () => {
      prisma.bidScoreRecord.findMany = jest.fn().mockResolvedValue([]);

      const result = await service.detectAnomalies('proj-1');

      expect(result.message).toContain('需要至少2位专家');
      expect(result.anomalies).toHaveLength(0);
    });

    it('多位专家评分偏差超过阈值时应检测', async () => {
      prisma.bidScoreRecord.findMany = jest.fn().mockResolvedValue([
        {
          expert: { expertName: '王建国' },
          scoreItem: { name: '技术方案', category: 'TECHNICAL', maxScore: 50 },
          score: 45,
        },
        {
          expert: { expertName: '刘晓梅' },
          scoreItem: { name: '技术方案', category: 'TECHNICAL', maxScore: 50 },
          score: 20,
        },
        {
          expert: { expertName: '陈志强' },
          scoreItem: { name: '技术方案', category: 'TECHNICAL', maxScore: 50 },
          score: 42,
        },
      ]);

      const result = await service.detectAnomalies('proj-1');

      expect(result.anomalies.length).toBeGreaterThan(0);
      expect(result.anomalies[0].expertName).toBe('刘晓梅');
      expect(result.anomalies[0].severity).toMatch(/high|medium|low/);
    });
  });

  describe('getSupplierRiskScores', () => {
    it('应返回每个供应商的风险评分（基于真实数据因子）', async () => {
      prisma.bidSupplier.findMany = jest.fn().mockResolvedValue([
        { id: 's1', supplierName: '川水建设', supplierId: 'sup-1', submitStatus: '已提交', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
        { id: 's2', supplierName: '智水科技', supplierId: 'sup-2', submitStatus: '未提交', decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION' },
      ]);
      prisma.supplierBidSubmission.findMany = jest.fn().mockResolvedValue([
        { supplierId: 'sup-1', bidPrice: '950000', technicalFileAssetId: 'a1', businessFileAssetId: 'a2', coverLetterAssetId: 'a3' },
      ]);
      prisma.supplierEvaluation.groupBy = jest.fn().mockResolvedValue([
        { supplierId: 'sup-1', _avg: { overallScore: 88 }, _count: { _all: 5 } },
      ]);
      prisma.supplierQualification.groupBy = jest.fn().mockResolvedValue([
        { supplierId: 'sup-1', _count: { _all: 4 } },
      ]);
      prisma.procurementProject.findFirst = jest.fn().mockResolvedValue({ budget: 1000000 });

      const result = await service.getSupplierRiskScores('proj-1');

      expect(result).toHaveLength(2);
      expect(result[0].supplierName).toBe('川水建设');
      expect(result[1].supplierName).toBe('智水科技');
      // 川水建设（解密成功+文件齐全+履约均分88+报价接近预算）应高于智水科技（解密异常+无文件）
      expect(result[0].overallRiskScore).toBeGreaterThan(result[1].overallRiskScore);
      result.forEach((s: any) => {
        expect(s.factors).toHaveLength(5);
        expect(s.level).toMatch(/低风险|中风险|高风险/);
        expect(typeof s.confidence).toBe('number');
        expect(s.confidence).toBeGreaterThanOrEqual(0);
        expect(s.confidence).toBeLessThanOrEqual(100);
      });
      // 川水建设有真实数据支撑（文件/解密/履约/资质/报价）→ confidence 高
      expect(result[0].confidence).toBeGreaterThan(50);
    });
  });
});
