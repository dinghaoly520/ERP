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

  it('LLM 返回 seq 为字符串时被强制为数字（不丢弃）', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: '1', status: 'met', excerpt: '承诺工期 360 日历天', file: 'technical', page: 1, confidence: 0.9 },
    ] }) } as any;
    const out = await svcMatch(llm);
    expect(out).toHaveLength(1);                              // 被强制，不是丢弃
    expect(out[0].requirementId).toBe('STABLE_T1');          // 正确映射回 stableId
  });

  it('LLM 返回重复 seq → 按 requirementId 去重（保留首条）', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ responses: [
      { seq: 1, status: 'met', excerpt: 'first', file: 'technical', page: 1, confidence: 0.9 },
      { seq: 1, status: 'partial', excerpt: 'dup', file: 'technical', page: 2, confidence: 0.5 },
    ] }) } as any;
    const out = await svcMatch(llm);
    expect(out).toHaveLength(1);                              // 去重：只一条
    expect(out[0].excerpt).toBe('first');                    // 保留首条
  });

  // ── 分块匹配（2026-08-18）：33 条条款单次输出的 JSON 超 LLM 输出上限被截断（finish_reason=length），
  //    第十二地质大队 requirementResponses 曾因此为 0。分批（默认 11 条/批）防截断。──
  it('超过单批上限时分多批调用并合并结果', async () => {
    const manyReq: TenderRequirements = {
      ...req,
      technicalRequirements: Array.from({ length: 23 }, (_, i) => ({
        id: `T${i + 1}`, category: '技术', content: `要求${i + 1}`, isStarred: false, weight: 1,
      })),
    };
    const llm = {
      chatJson: jest.fn().mockImplementation((_sys: string, prompt: string) => {
        const seqs = [...prompt.matchAll(/"seq":(\d+)/g)].map((m) => Number(m[1]));
        return Promise.resolve({
          responses: seqs.map((seq) => ({
            seq, status: 'met', excerpt: `摘录${seq}`, file: 'technical', page: 1, confidence: 0.9,
          })),
        });
      }),
    } as any;
    const out = await new RequirementMatcherService(llm).match(
      manyReq, pages, { technical: 'fa-tech', business: 'fa-biz' }, 'task-1',
    );
    expect(llm.chatJson).toHaveBeenCalledTimes(3);           // 23 条 → 11+11+1 三批
    expect(out).toHaveLength(23);
    expect(out[22]).toMatchObject({ requirementId: 'T23', excerpt: '摘录23' });
    expect(out[0].requirementId).toBe('T1');
  });

  it('单批失败不拖垮其余批次（部分成功）', async () => {
    const manyReq: TenderRequirements = {
      ...req,
      technicalRequirements: Array.from({ length: 23 }, (_, i) => ({
        id: `T${i + 1}`, category: '技术', content: `要求${i + 1}`, isStarred: false, weight: 1,
      })),
    };
    let call = 0;
    const llm = {
      chatJson: jest.fn().mockImplementation((_sys: string, prompt: string) => {
        call++;
        if (call === 2) return Promise.reject(new Error('LLM 输出被截断（finish_reason=length）'));
        const seqs = [...prompt.matchAll(/"seq":(\d+)/g)].map((m) => Number(m[1]));
        return Promise.resolve({
          responses: seqs.map((seq) => ({
            seq, status: 'met', excerpt: `摘录${seq}`, file: 'technical', page: 1, confidence: 0.9,
          })),
        });
      }),
    } as any;
    const out = await new RequirementMatcherService(llm).match(
      manyReq, pages, { technical: 'fa-tech', business: 'fa-biz' }, 'task-1',
    );
    expect(out).toHaveLength(12);                            // 批1(11) + 批2失败 + 批3(1)
    expect(out[0].requirementId).toBe('T1');
    expect(out[out.length - 1].requirementId).toBe('T23');
  });

  async function svcMatch(llm: any) {
    return new RequirementMatcherService(llm).match(req, pages, { technical: 'fa-tech', business: 'fa-biz' }, 'task-1');
  }
});
