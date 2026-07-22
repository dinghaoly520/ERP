import { Test, TestingModule } from '@nestjs/testing';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { LlmService } from '../local-ai/llm.service';

/**
 * ExpertExtractionAiService 单测：
 * 覆盖 chatJsonWithRetry 的重试/最终降级信号、analyzeAndScore 的 e0→真实 id 映射与未匹配过滤、
 * generateNotification 的占位符兜底与缓存去重。这些是"张冠李戴"与"降级链断裂"的高发点。
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
      chatJson: jest.fn(),
      chat: jest.fn(),
      getModel: jest.fn().mockReturnValue('test-model'),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExpertExtractionAiService, { provide: LlmService, useValue: llm }],
    }).compile();
    service = module.get<ExpertExtractionAiService>(ExpertExtractionAiService);
  });

  describe('analyzeAndScore — 重试与降级信号', () => {
    it('首次失败、第二次成功：应返回结果且 llmErrors=1', async () => {
      llm.chatJson
        .mockRejectedValueOnce(new Error('临时网络错误'))
        .mockResolvedValueOnce({
          analysis: 'ok',
          requiredSpecialties: [{ specialty: '施工', count: 1, reason: 'r' }],
          scoredExperts: [{ id: 'e0', matchScore: 80, fitSpecialty: '施工', reason: 'r' }],
        });
      const res = await service.analyzeAndScore(project, candidates, 1);
      expect(res.scoredExperts[0].id).toBe('realA');
      expect(service.getMetrics().llmErrors).toBe(1);
    });

    it('连续失败：应抛错（上层据此降级规则引擎），llmErrors 累计', async () => {
      llm.chatJson.mockRejectedValue(new Error('AI 持续不可用'));
      await expect(service.analyzeAndScore(project, candidates, 1)).rejects.toThrow('AI 抽取失败');
      expect(service.getMetrics().llmErrors).toBeGreaterThanOrEqual(2);
      expect(service.getMetrics().fallbackCount).toBe(0); // 降级计数由调用方记录
    });

    it('空结果应抛错（视为降级信号，而非返回垃圾）', async () => {
      llm.chatJson.mockResolvedValue({ analysis: '', requiredSpecialties: [], scoredExperts: [] });
      await expect(service.analyzeAndScore(project, candidates, 1)).rejects.toThrow();
    });
  });

  describe('analyzeAndScore — id 映射（张冠李戴回归）', () => {
    it('LLM 编号 e0/e1 必须映射回真实候选 id，未匹配项被过滤', async () => {
      llm.chatJson.mockResolvedValue({
        analysis: 'ok',
        requiredSpecialties: [{ specialty: '地质', count: 1, reason: 'r' }],
        scoredExperts: [
          { id: 'e1', matchScore: 88, fitSpecialty: '地质', reason: '匹配' },
          { id: 'e9', matchScore: 50, fitSpecialty: 'x', reason: 'y' }, // 无对应候选 → 过滤
        ],
      });
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
