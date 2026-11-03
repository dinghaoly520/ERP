import { AssistantRagService } from './rag-retrieval.service';

describe('AssistantRagService（水叮当 RAG 检索，2026-11-03 设计 §4.1）', () => {
  const mk = (opts: {
    kbs?: any[]; searchHits?: any[]; embedReject?: boolean; searchReject?: boolean;
  }) => {
    const prisma: any = {
      knowledgeBase: { findMany: jest.fn().mockResolvedValue(opts.kbs ?? []) },
    };
    const embedding: any = { embed: opts.embedReject ? jest.fn().mockRejectedValue(new Error('503')) : jest.fn().mockResolvedValue([[0.1]]) };
    const vectorSearch: any = {
      search: opts.searchReject
        ? jest.fn().mockRejectedValue(new Error('vector down'))
        : jest.fn().mockResolvedValue(opts.searchHits ?? []),
    };
    return { svc: new AssistantRagService(prisma, embedding, vectorSearch), prisma, vectorSearch };
  };
  const me = { sub: 'u-1', role: 'leader' };

  it('检索集只含 自己∪共享（isActive）——where 断言，他人私有库不进', async () => {
    const { svc, prisma } = mk({ kbs: [{ id: 'kb-1' }] });
    await svc.buildContext('问句', me);
    expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, OR: [{ ownerId: 'u-1' }, { isShared: true }] },
    }));
  });

  it('命中 → block 含片段与来源文件名，fileNames 去重；跨库合并按 score 取 top5', async () => {
    const hits = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`, content: `片段${i}`, fileId: `f${i % 2}`,
      metadata: { fileName: i % 2 === 0 ? '制度.pdf' : '流程.docx' }, score: 1 - i * 0.1,
    }));
    const { svc } = mk({ kbs: [{ id: 'kb-1' }, { id: 'kb-2' }], searchHits: hits });
    const r = await svc.buildContext('问句', me);
    expect(r).not.toBeNull();
    expect(r!.block).toContain('【用户知识库资料');
    expect(r!.block).toContain('片段0');
    expect(r!.block).not.toContain('片段6'); // top5 截断
    expect(r!.fileNames.sort()).toEqual(['制度.pdf', '流程.docx']);
  });

  it('无库 / 无命中 → null', async () => {
    expect(await mk({}).svc.buildContext('问句', me)).toBeNull();
    expect(await mk({ kbs: [{ id: 'kb-1' }] }).svc.buildContext('问句', me)).toBeNull();
  });

  it('降级铁律：嵌入 503 / 检索异常 → 返回 null 绝不抛', async () => {
    expect(await mk({ kbs: [{ id: 'kb-1' }], embedReject: true }).svc.buildContext('问句', me)).toBeNull();
    expect(await mk({ kbs: [{ id: 'kb-1' }], searchReject: true }).svc.buildContext('问句', me)).toBeNull();
  });
});
