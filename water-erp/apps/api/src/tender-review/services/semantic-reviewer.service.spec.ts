import { SemanticReviewerService } from './semantic-reviewer.service';

describe('SemanticReviewerService 向量检索软兜底', () => {
  const rules = [
    {
      id: 'r1',
      name: '规则一',
      source: '测试制度',
      logicExpression: { description: '检查要求描述' },
    },
  ] as any;

  function make(vectorSearchOverrides: any) {
    const llm = {
      chatJson: jest.fn().mockResolvedValue({ results: [] }),
    } as any;
    const clauseParser = { parse: () => ({ clauses: [] }) } as any;
    const vectorSearch = {
      search: jest.fn(),
      ...vectorSearchOverrides,
    } as any;
    const svc = new SemanticReviewerService(llm, vectorSearch, clauseParser);
    return { svc, llm, vectorSearch };
  }

  it('向量检索抛错时 review() 不 reject，退化为无 RAG 上下文（提示词含「无相关检索结果」）', async () => {
    const { svc, llm } = make({
      search: jest
        .fn()
        .mockRejectedValue(new Error('column "embedding" does not exist')),
    });
    const out = await svc.review(rules, '第一章 总则\n文档内容', 'kb1');
    expect(out).toHaveLength(1);
    expect(llm.chatJson).toHaveBeenCalledTimes(1);
    const userPrompt = llm.chatJson.mock.calls[0][1] as string;
    expect(userPrompt).toContain('无相关检索结果');
  });

  it('向量检索正常时提示词携带 KB 段落', async () => {
    const { svc, llm } = make({
      search: jest.fn().mockResolvedValue([
        {
          id: 'c1',
          content: '制度原文片段甲',
          metadata: {},
          fileId: 'f1',
          score: 0.9,
        },
      ]),
    });
    await svc.review(rules, '第一章 总则\n文档内容', 'kb1');
    const userPrompt = llm.chatJson.mock.calls[0][1] as string;
    expect(userPrompt).toContain('制度原文片段甲');
  });

  it('软兜底不吞 AbortError：signal 已中止时上抛', async () => {
    const { svc } = make({
      search: jest
        .fn()
        .mockRejectedValue(new DOMException('Aborted', 'AbortError')),
    });
    const ac = new AbortController();
    ac.abort();
    await expect(
      svc.review(rules, '文档', 'kb1', ac.signal),
    ).rejects.toThrow('Aborted');
  });
});
