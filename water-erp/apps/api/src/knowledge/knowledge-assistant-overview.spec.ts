import { KnowledgeService } from './knowledge.service';

/** 2026-11-03 设计 §4.3：水叮当知识库面板取数——mine=本人库、shared=他人共享库；
 *  他人私有库与停用库不得进入任何一组（findMany where 语义由 mock 模拟）。 */
describe('KnowledgeService.assistantOverview（水叮当知识库面板取数）', () => {
  const mineKb = { id: 'kb-m', name: '我的库', isShared: false, ownerId: 'u-1', isActive: true, domain: 'assistant', files: [] };
  const mySharedKb = { id: 'kb-ms', name: '我的公开库', isShared: true, ownerId: 'u-1', isActive: true, domain: 'assistant', files: [] };
  const sharedKb = { id: 'kb-s', name: '同事共享', isShared: true, ownerId: 'u-2', isActive: true, domain: 'assistant', files: [] };
  const privateOther = { id: 'kb-x', name: '他人私有', isShared: false, ownerId: 'u-2', isActive: true, domain: 'assistant' };
  const inactive = { id: 'kb-i', name: '停用', isShared: true, ownerId: 'u-2', isActive: false, domain: 'assistant' };
  const tenderReviewKb = { id: 'kb-tr', name: '采购管理办法（审查域）', isShared: true, ownerId: 'u-3', isActive: true, domain: 'tender_review' };

  const mk = () => {
    const findMany = jest.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(
        [mineKb, mySharedKb, sharedKb, privateOther, inactive, tenderReviewKb].filter((kb: any) =>
          kb.isActive === where.isActive &&
          kb.domain === where.domain &&
          where.OR.some((o: any) => (o.ownerId ? o.ownerId === kb.ownerId : kb.isShared === true)),
        ),
      ));
    const prisma: any = {
      knowledgeBase: { findMany },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u-2', displayName: '同事', username: 'tongshi' }]) },
    };
    const svc: any = new KnowledgeService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, findMany };
  };

  it('文件 select 含解析状态字段（2026-11-06 异步化：前端徽章/轮询消费）', async () => {
    const { svc, findMany } = mk();
    await svc.assistantOverview({ sub: 'u-1', role: 'leader' });
    const sel = findMany.mock.calls[0][0].select.files.select;
    expect(sel).toEqual(expect.objectContaining({
      status: true, processedPages: true, totalPages: true, error: true, indexed: true,
    }));
  });

  it('where 恒为 assistant 域 + isActive +（自己的 ∪ 共享）——他人私有库、停用库、审查域库均不入（2026-11-03 域隔离）', async () => {
    const { svc, findMany } = mk();
    await svc.assistantOverview({ sub: 'u-1', role: 'leader' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, domain: 'assistant', OR: [{ ownerId: 'u-1' }, { isShared: true }] },
    }));
  });

  it('mine=本人库（含本人共享库），shared=他人共享库', async () => {
    const { svc } = mk();
    const r = await svc.assistantOverview({ sub: 'u-1', role: 'leader' });
    expect(r.mine.map((k: any) => k.id).sort()).toEqual(['kb-m', 'kb-ms']);
    expect(r.shared.map((k: any) => k.id)).toEqual(['kb-s']);
  });

  it('文件行含 fileName/fileSize/chunkCount/createdAt 透传；shared 组带创建者名', async () => {
    const withFile = [{ id: 'kb-m', name: '我的库', isShared: false, ownerId: 'u-1', isActive: true,
      files: [{ id: 'f-1', fileName: '制度.pdf', fileSize: 1024, chunkCount: 3, createdAt: new Date() }] }];
    const svc: any = new KnowledgeService(
      { knowledgeBase: { findMany: jest.fn().mockResolvedValue(withFile) },
        user: { findMany: jest.fn().mockResolvedValue([]) } } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const r = await svc.assistantOverview({ sub: 'u-1', role: 'leader' });
    expect(r.mine[0].files[0]).toMatchObject({ fileName: '制度.pdf', chunkCount: 3 });
    expect(r.mine[0].ownerName).toBe('我');
  });
});
