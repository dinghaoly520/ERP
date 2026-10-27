import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { ConfigService } from '@nestjs/config';
import { CompanyScopeService } from '../company/company-scope';
import { sealPii } from '../common/crypto/sm-field-crypto';

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
      supplier: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: PrismaService, useValue: prisma },
        { provide: SupplierSelectionAiService, useValue: { rankCandidates: jest.fn() } },
        { provide: LlmService, useValue: { chatJson: jest.fn(), chat: jest.fn() } },
        { provide: NotificationService, useValue: { create: jest.fn(), sendToRole: jest.fn() } },
        // AiService 构造器第 5 参（口径同 local-ai/llm.service.spec.ts）
        { provide: ConfigService, useValue: { get: (key: string, def?: string) => (process.env[key] as string | undefined) ?? def } },
        // AiService 构造器第 6 参：公司隔离引擎（recommendSuppliers 候选池限定归属公司）
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn(), filter: jest.fn() } },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  describe('recommendSuppliers', () => {
    it('候选池按公司隔离：APPROVED link 存在性注入 where（多公司归属换形 2026-10-16），禁止全库推荐', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      const companyScope = (service as any).companyScope;
      companyScope.resolveScope.mockResolvedValue({ all: false, companyIds: ['co-swhi'] });

      const res = await service.recommendSuppliers('水泵采购', { actor: { sub: 'u1', role: 'leader' } as any });

      expect(prisma.supplier.findMany).toHaveBeenCalledTimes(1);
      const where = prisma.supplier.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('APPROVED');
      expect(where.companyLinks).toEqual({ some: { companyId: { in: ['co-swhi'] }, status: 'APPROVED' } });
      // 空（隔离后）候选池 → 空推荐而非报错
      expect(res.recommendations).toEqual([]);
    });

    it('actor 与 companyId 透传 resolveScope（非 admin 传参忽略语义由 CompanyScopeService 保证）', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      const companyScope = (service as any).companyScope;
      companyScope.resolveScope.mockResolvedValue({ all: true });

      await service.recommendSuppliers('水泵采购', { actor: { sub: 'u2', role: 'admin' } as any, companyId: 'co-x' });

      expect(companyScope.resolveScope).toHaveBeenCalledWith({ sub: 'u2', role: 'admin' }, 'co-x');
    });

    it('联系人电话 PII 密文拆封为明文（邀请场景出口口径），sm1 密文不得直出确认页', async () => {
      const sealedPhone = sealPii('13812345678') as string;
      expect(sealedPhone.startsWith('sm1:')).toBe(true); // 前置：确系密态样本
      prisma.supplier.findMany.mockResolvedValue([{
        id: 'sup-pii', name: '测试供应商', enterpriseType: '有限责任公司', legalPerson: '张三',
        businessScope: '液压设备', tags: ['液压'], supplierNo: 'SUP-000001',
        classification: null, qualifications: [], evaluations: [], bidSuppliers: [],
        contacts: [{ name: '孟鹏宇', phone: sealedPhone, isPrimary: true }],
      }]);
      const companyScope = (service as any).companyScope;
      companyScope.resolveScope.mockResolvedValue({ all: true });
      // LLM 缺席走规则引擎轨：toRecommendation 逐家组装视图模型
      (service as any).selectionAi.rankCandidates.mockResolvedValue(undefined);

      const res = await service.recommendSuppliers('液压钻机采购', {});

      expect(res.recommendations.length).toBeGreaterThan(0);
      expect(res.recommendations[0].contacts?.[0].phone).toBe('13812345678');
    });
  });

  describe('generateOverviewSummary（概况残句防御，2026-10-16）', () => {
    it('LLM 输出为思维链耗尽预算后的断片（<40 字）→ 弃用，降级确定性拼接', async () => {
      (service as any).llm.chat.mockResolvedValue('为提升工程勘察院钻探装备能力，满足深孔、');
      const out = await (service as any).generateOverviewSummary('立项事由甲', '供方要求乙', '项目概况丙');
      expect(out).toBe('立项事由甲；供方要求乙；项目概况丙');
    });

    it('LLM 健康输出（≥40 字）→ 原样采用', async () => {
      const healthy =
        '本项目为提升工程勘察院钻探装备能力，满足深孔、超深孔岩心钻探任务需求，采购便携式全液压岩心钻机（800型）一台，含配套钻具与运输固定装置，供应商须具备同类设备供货业绩。';
      (service as any).llm.chat.mockResolvedValue(healthy);
      const out = await (service as any).generateOverviewSummary('立项事由', undefined, undefined);
      expect(out).toContain('岩心钻探任务需求');
    });
  });

  describe('generateNotificationContent（contentMode=template，2026-10-27 :3005 邀请第三步改版）', () => {
    it('跳过 LLM：固定语句骨架 + {rsvpLink} 占位符保留 + RSVP 行照常签发', async () => {
      prisma.invitationRsvp = { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 2 }), deleteMany: jest.fn(), update: jest.fn() };
      prisma.supplier.findMany.mockResolvedValue([{ id: 'sup-1', name: '四川川水建设工程有限公司' }, { id: 'sup-2', name: '中科院成都信息技术股份有限公司' }]);
      const llm = (service as any).llm;

      const res = await service.generateNotificationContent({
        contentMode: 'template',
        projectName: '水利信息化设备采购', projectCode: 'SWHI-TP-2026102701',
        procurementMethod: '竞争性谈判',
        supplierNames: ['四川川水建设工程有限公司', '中科院成都信息技术股份有限公司'],
        supplierIds: ['sup-1', 'sup-2'],
        projectId: null, validityDays: 1,
      });

      // LLM 零调用（模板模式核心诉求：确定性、无等待）
      expect(llm.chatJson).not.toHaveBeenCalled();
      expect(llm.chat).not.toHaveBeenCalled();
      // 固定语句骨架：归属公司兜底 + 项目要素 + {rsvpLink} 占位符原样保留（前端逐家替换）
      expect(res.body).toContain('四川省水利发展集团有限公司现就水利信息化设备采购采购项目（项目编号：SWHI-TP-2026102701）使用竞争性谈判。');
      expect(res.body).toContain('{rsvpLink}');
      expect(res.title).toBe('关于水利信息化设备采购采购项目候选供应商邀请的通知');
      // RSVP 签发机器照常：两家的 token 均返回且指向 /rsvp?t=
      expect(Object.keys(res.rsvpTokens).sort()).toEqual(['sup-1', 'sup-2']);
      expect(res.rsvpTokens['sup-1']).toMatch(/\/rsvp\?t=/);
      expect(prisma.invitationRsvp.createMany).toHaveBeenCalledTimes(1);
    });

    it('必要字段缺失直接 400 报错，不占位兜底（2026-10-27 用户口径）', async () => {
      prisma.invitationRsvp = { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn(), deleteMany: jest.fn(), update: jest.fn() };
      await expect(
        service.generateNotificationContent({
          contentMode: 'template',
          projectName: '水利信息化设备采购',
          supplierNames: ['四川川水建设工程有限公司'],
          supplierIds: ['sup-1'],
          projectId: null, validityDays: 1,
        }),
      ).rejects.toThrow(/模板模式缺少必要字段：projectCode（项目编号）、procurementMethod（采购方式）/);
      expect(prisma.invitationRsvp.createMany).not.toHaveBeenCalled();
    });
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

  describe('analyzeWorkArrangementDailyPlan（focusItems 去重，2026-10-19 双 key 告警实录）', () => {
    it('LLM 将同一任务 id 输出两次 → 去重保首，防前端 React key 冲突', async () => {
      (service as any).llm.chatJson.mockResolvedValue({
        overview: '今日共2项任务，全部待处理。上午处理甲，下午处理乙，核心策略是先急后缓。',
        headerGreeting: '今天有2项任务需要关注。',
        namePraise: '', dailyGreeting: '', riskSummary: '', aiSuggestion: '',
        projectBrief: '', completionAdvice: '', dailyQuote: '',
        focusItems: [
          { id: 'task-dup', title: '任务甲', priorityRank: 1, reason: '紧迫' },
          { id: 'task-unique', title: '任务乙', priorityRank: 2, reason: '重要' },
          { id: 'task-dup', title: '任务甲（重复）', priorityRank: 3, reason: 'LLM 重复输出' },
        ],
        timeBlocks: [], riskAlerts: [],
      });

      const res = await service.analyzeWorkArrangementDailyPlan({
        date: '2026-10-19T00:00:00.000Z',
        items: [
          { id: 'task-dup', title: '任务甲', status: 'TODO', urgency: 'HIGH' },
          { id: 'task-unique', title: '任务乙', status: 'TODO', urgency: 'MEDIUM' },
        ],
      });

      const ids = res.focusItems.map((f: any) => f.id);
      expect(ids).toEqual(['task-dup', 'task-unique']);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('focusItems 非数组/含非对象项 → 容错为安全数组', async () => {
      (service as any).llm.chatJson.mockResolvedValue({
        overview: '今日共1项任务。',
        headerGreeting: '今天有1项任务。',
        namePraise: '', dailyGreeting: '', riskSummary: '', aiSuggestion: '',
        projectBrief: '', completionAdvice: '', dailyQuote: '',
        focusItems: [{ id: 'a', title: '甲' }, null, 'garbage'],
        timeBlocks: [], riskAlerts: [],
      });

      const res = await service.analyzeWorkArrangementDailyPlan({ date: '2026-10-19T00:00:00.000Z', items: [] });

      expect(res.focusItems).toEqual([{ id: 'a', title: '甲' }]);
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
        { supplierId: 'sup-1', _count: { _all: 5 } },
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

describe('AiController — 供应商名称不允许 AI 生成（2026-10-16 用户裁定）', () => {
  it('fieldKey=supplierName → 400 SUPPLIER_NAME_NO_AI，不触达 AI service', async () => {
    // 构造 7 参（2026-10-22 补第 7 参 mobileBrief——加构造参须同步本 spec，历史实录 89d61a8c）
    const controller = new AiController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(
      controller.tenderFieldGenerate({ fieldKey: 'supplierName', fieldLabel: '供应商名称', currentValue: '', context: {} } as any),
    ).rejects.toMatchObject({ response: { code: 'SUPPLIER_NAME_NO_AI' } });
  });
});
