import { RequirementMatcherService } from './requirement-matcher.service';
import type { TenderRequirements } from '../types';

describe('RequirementMatcherService', () => {
  const req: TenderRequirements = {
    projectName: 'p', projectType: 't',
    technicalRequirements: [
      { id: 'STABLE_T1', category: '技术', content: '工期不超过365日历天', isStarred: true, weight: 10 },
    ],
    qualificationRequirements: [], commercialRequirements: [],
    priceEvaluationMethod: 'x',
    scoringRules: { technicalMax:0, commercialMax:0, priceMax:0, technicalWeights:{}, commercialWeights:{}, priceMethod:'', notes:'' },
  };
  const pages = [
    { file: 'technical', page: 1, text: '我司承诺工期 360 日历天完成全部施工。' },
  ];

  it('LLM 回填 seq，matcher 映射回 stableId（prompt 不含 hash id）', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: 1, status: 'met', excerpt: '承诺工期 360 日历天', file: 'technical', page: 1, confidence: 0.9 },
    ] }) } as any;
    const svc = new RequirementMatcherService(llm);
    const out = await svc.match(req, pages, { technical: 'fa-tech', business: 'fa-biz' }, 'task-1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      requirementId: 'STABLE_T1', status: 'met',   // seq=1 → stableId
      tenderContent: '工期不超过365日历天', isStarred: true,
      excerpt: '承诺工期 360 日历天',
      location: { fileId: 'fa-tech', page: 1 }, confidence: 0.9,
    });
    const calledPrompt = llm.chatJson.mock.calls[0][1] as string;
    expect(calledPrompt).not.toContain('STABLE_T1');   // hash id 不进 prompt
    expect(calledPrompt).toContain('"seq":1');
  });

  it('not_found 时 location 为 null', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: 1, status: 'not_found', excerpt: '', file: null, page: null, confidence: 0.3 },
    ] }) } as any;
    const out = await svcMatch(llm);
    expect(out[0].location).toBeNull();
  });

  it('缺页号/文件时 location 降级 null', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: 1, status: 'partial', excerpt: 'x', file: 'business', page: null, confidence: 0.5 },
    ] }) } as any;
    const out = await svcMatch(llm);
    expect(out[0].location).toBeNull(); // page 缺
  });

  it('LLM 回填未知 seq（越界）→ 该条丢弃不崩', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: 99, status: 'met', excerpt: 'x', file: 'technical', page: 1, confidence: 0.9 },
    ] }) } as any;
    const out = await svcMatch(llm);
    expect(out).toHaveLength(0);
  });

  async function svcMatch(llm: any) {
    return new RequirementMatcherService(llm).match(req, pages, { technical: 'fa-tech', business: 'fa-biz' }, 'task-1');
  }
});
