import { Test, TestingModule } from '@nestjs/testing';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { LlmService } from '../local-ai/llm.service';

/**
 * ExpertExtractionAiService 单测：
 * 覆盖 analyzeAndScore 的 chat 纯文本 JSON 提取/失败信号（llmErrors 计数，上层据此降级规则引擎）、
 * e0→真实 id 映射与未匹配过滤、generateNotification 的占位符兜底与缓存去重。
 * 这些是"张冠李戴"与"降级链断裂"的高发点。
 */
describe('ExpertExtractionAiService', () => {
  let service: ExpertExtractionAiService;
  let llm: any;

  const project = { name: '测试项目', procurementMethod: '公开招标', scope: '水利枢纽施工' };
  const candidates = [
    { id: 'realA', displayName: '甲', specialty: '施工', pastProjects: 3, pastAvgScore: 80 },
    { id: 'realB', displayName: '乙', specialty: '地质', pastProjects: 1, pastAvgScore: 70 },
  ] as any[];

  beforeEach(async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    llm = {
      chat: jest.fn(),
      getModel: jest.fn().mockReturnValue('test-model'),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExpertExtractionAiService, { provide: LlmService, useValue: llm }],
    }).compile();
    service = module.get<ExpertExtractionAiService>(ExpertExtractionAiService);
  });

  describe('analyzeAndScore — 纯文本 JSON 提取与降级信号', () => {
    it('chat 返回带代码围栏的 JSON 文本 → 解析成功且 llmCalls=1、llmErrors=0', async () => {
      llm.chat.mockResolvedValue(
        '```json\n' + JSON.stringify({
          analysis: 'ok',
          requiredSpecialties: [{ specialty: '施工', count: 1, reason: 'r' }],
          scoredExperts: [{ id: 'e0', matchScore: 80, fitSpecialty: '施工', reason: 'r' }],
        }) + '\n```',
      );
      const res = await service.analyzeAndScore(project, candidates, 1);
      expect(res.scoredExperts[0].id).toBe('realA');
      expect(service.getMetrics().llmCalls).toBe(1);
      expect(service.getMetrics().llmErrors).toBe(0);
    });

    it('chat 失败：应抛错（上层据此降级规则引擎），llmErrors=1', async () => {
      llm.chat.mockRejectedValue(new Error('AI 持续不可用'));
      await expect(service.analyzeAndScore(project, candidates, 1)).rejects.toThrow('AI 抽取失败');
      expect(service.getMetrics().llmErrors).toBe(1);
      expect(service.getMetrics().fallbackCount).toBe(0); // 降级计数由调用方记录
    });

    it('空结果应抛错（视为降级信号，而非返回垃圾）', async () => {
      llm.chat.mockResolvedValue(JSON.stringify({ analysis: '', requiredSpecialties: [], scoredExperts: [] }));
      await expect(service.analyzeAndScore(project, candidates, 1)).rejects.toThrow('AI 未返回有效评分数据');
    });
  });

  describe('analyzeAndScore — id 映射（张冠李戴回归）', () => {
    it('LLM 编号 e0/e1 必须映射回真实候选 id，未匹配项被过滤', async () => {
      llm.chat.mockResolvedValue(JSON.stringify({
        analysis: 'ok',
        requiredSpecialties: [{ specialty: '地质', count: 1, reason: 'r' }],
        scoredExperts: [
          { id: 'e1', matchScore: 88, fitSpecialty: '地质', reason: '匹配' },
          { id: 'e9', matchScore: 50, fitSpecialty: 'x', reason: 'y' }, // 无对应候选 → 过滤
        ],
      }));
      const res = await service.analyzeAndScore(project, candidates, 1);
      expect(res.scoredExperts).toHaveLength(1);
      expect(res.scoredExperts[0].id).toBe('realB'); // e1 → 第二个候选，绝不能错位
    });
  });

  describe('generateNotification — 占位符兜底与缓存', () => {
    const params = {
      projectName: '测试项目', expertName: '甲', isLead: false,
      totalExperts: 3, extractMode: 'specialty_match', openTime: '2026-08-01 09:00',
    };

    it('模型漏掉 [[专家姓名]] 占位符时应自动补抬头', async () => {
      llm.chat.mockResolvedValue('诚邀您参加评审，请准时出席。');
      const content = await service.generateNotification(params);
      expect(content).toContain('[[专家姓名]]');
      expect(content!.startsWith('[[专家姓名]]专家您好！')).toBe(true);
    });

    it('同项目同角色二次生成应命中缓存，仅调用一次 LLM', async () => {
      llm.chat.mockResolvedValue('[[专家姓名]]专家您好！诚邀您参加评审。');
      await service.generateNotification(params);
      await service.generateNotification({ ...params, expertName: '乙' }); // 仅专家名不同 → 同缓存 key
      expect(llm.chat).toHaveBeenCalledTimes(1);
    });
  });
});

describe('P1-9 — LLM 输入脱敏出境', () => {
  let svc: any;
  let llm: any;

  beforeEach(async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const { ExpertExtractionAiService } = await import('./expert-extraction-ai.service');
    const instance: any = Object.create(ExpertExtractionAiService.prototype);
    llm = { chat: jest.fn().mockResolvedValue('{"analysis":"ok","scoredExperts":[{"id":"e0","matchScore":90,"fitSpecialty":"水利工程","reason":"r"}]}'), getModel: jest.fn().mockReturnValue('mock-model') };
    instance.llm = llm;
    instance.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    instance.metrics = { llmErrors: 0, llmLatencyMs: 0, llmCalls: 0 };
    svc = instance;
  });
  afterEach(() => { delete process.env.DEEPSEEK_API_KEY; });

  it('候选行不含姓名/单位（脱敏出境，条例第46条名单保密）', async () => {
    const candidates = [
      { id: 'u1', displayName: '王建国', specialty: '水利工程', title: '正高级', employer: '四川省水利院', evaluationLevel: 'A', scoreDeviation: 1, currentLoadStatus: '低', pastProjects: 12 },
    ];
    await svc.analyzeAndScore(
      { name: 'P', procurementMethod: '公开招标', scope: 's' },
      candidates, 1, 'specialty_match', undefined,
    );
    const userPrompt = llm.chat.mock.calls[0][1] as string;
    expect(userPrompt).not.toContain('王建国');
    expect(userPrompt).not.toContain('四川省水利院');
    expect(userPrompt).toContain('专业:水利工程');
    expect(userPrompt).toContain('职称:正高级');
    expect(userPrompt).toMatch(/候选\(编号\|专业\|职称\|履职/);
  });
});
