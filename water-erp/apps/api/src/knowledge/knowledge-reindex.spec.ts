import { KnowledgeService } from './knowledge.service';

/** reindex 异步化（2026-11-11 生产实录）：同步版在 KB 含大文档（476 页 676 块嵌入 ~1h）时
 *  必然击穿门户 proxy 120s 代理窗（504 UPSTREAM_TIMEOUT），代理断开只影响浏览器侧、API 循环
 *  继续跑——用户以为失败反复重试。现改立即返回 + 后台逐文件重建：
 *  - 增量语义：默认跳过 indexed=true（只修降级文件；force=true 先 deleteByCollection 全量）
 *  - 防重入：同 kb 进行中 → { started:false, alreadyRunning:true }
 *  - 后台 promise 不得浮动 reject（2026-11-09 教训：unhandled rejection 崩进程）
 *  - 按文件降级（嵌入/向量失败 indexed:false 继续）与 2026-11-09 删除竞态语义原样保留 */
function mkHarness(opts?: {
  embedReject?: boolean;
  insertReject?: boolean;
  /** 手动门闩：首个 embed 挂起直至 resolve，放行后后续 embed 直通（防重入测试用） */
  embedGate?: { resolve?: () => void; released?: boolean };
  /** 这些文件在轮到时已被删除（预检 findFirst 返 null） */
  goneBefore?: string[];
  /** 这些文件的 update 撞 P2025（预检后残余竞态：刚被并发删除） */
  updateP2025?: string[];
  /** update 非删除竞态的硬错误（后台顶层兜底测试用） */
  updateHardReject?: boolean;
}) {
  const update = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    if (opts?.updateP2025?.includes(where.id)) {
      const e: any = new Error(
        'An operation failed because it depends on one or more records that were required but not found.',
      );
      e.code = 'P2025';
      return Promise.reject(e);
    }
    if (opts?.updateHardReject) return Promise.reject(new Error('db hard down'));
    return Promise.resolve(undefined);
  });
  const FILES = [
    { id: 'kf-a', fileName: 'a.pdf', content: '正文一'.repeat(60), indexed: false },
    { id: 'kf-b', fileName: 'b.pdf', content: '正文二'.repeat(60), indexed: false },
  ];
  const prisma: any = {
    knowledgeBase: {
      findUnique: jest.fn().mockResolvedValue({ id: 'kb-1', ownerId: 'u-1', files: FILES }),
    },
    knowledgeFile: {
      update,
      // 预检：goneBefore 名单里的文件返 null（已被 deleteFile 删除）
      findFirst: jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          opts?.goneBefore?.includes(where.id) ? null : { id: where.id },
        ),
      ),
    },
  };
  const vectorSearch: any = {
    deleteByCollection: jest.fn().mockResolvedValue(undefined),
    deleteByFileId: jest.fn().mockResolvedValue(undefined),
    insertChunks: opts?.insertReject
      ? jest.fn().mockRejectedValue(new Error('vector db down'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const embedding: any = {
    embed: opts?.embedGate
      ? jest.fn(
          () =>
            new Promise<number[][]>((resolve) => {
              if (opts.embedGate!.released) {
                resolve([[0.1]]);
                return;
              }
              opts.embedGate!.resolve = () => {
                opts.embedGate!.released = true;
                resolve([[0.1]]);
              };
            }),
        )
      : opts?.embedReject
        ? jest.fn().mockRejectedValue(new Error('503'))
        : jest.fn().mockResolvedValue([[0.1]]),
  };
  const svc = new KnowledgeService(
    prisma,
    {} as any, {} as any,
    { split: jest.fn().mockReturnValue([{ content: '块', startOffset: 0, metadata: {} }]) } as any,
    embedding,
    vectorSearch,
    { add: jest.fn() } as any,
  );
  return {
    svc,
    FILES,
    update,
    insertChunks: vectorSearch.insertChunks,
    embed: embedding.embed,
    deleteByFileId: vectorSearch.deleteByFileId,
    deleteByCollection: vectorSearch.deleteByCollection,
  };
}

const user: any = { sub: 'u-1', role: 'leader' };
/** 等后台重建跑完（立即返回契约下，断言前须 drain） */
const drain = async (h: ReturnType<typeof mkHarness>) => {
  await (h.svc as any).lastReindexRun;
  await new Promise((r) => setImmediate(r));
};

describe('KnowledgeService.reindex 异步化（立即返回 + 后台逐文件）', () => {
  it('立即返回 {started:true, pendingCount}；后台逐文件嵌入并复位 indexed:true', async () => {
    const h = mkHarness();
    const res = await h.svc.reindex('kb-1', user);
    expect(res).toMatchObject({ started: true, fileCount: 2, pendingCount: 2, skippedCount: 0 });
    await drain(h);
    expect(h.update).toHaveBeenCalledTimes(2);
    for (const call of h.update.mock.calls) {
      expect(call[0].data).toMatchObject({ chunkCount: 1, indexed: true });
    }
    expect(h.deleteByCollection).not.toHaveBeenCalled(); // 增量模式不整库清
  });

  it('增量跳过 indexed=true：只重建降级文件', async () => {
    const h = mkHarness();
    // 现场改快照：kf-a 已索引
    (h.svc as any).prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1', ownerId: 'u-1',
      files: [
        { id: 'kf-a', fileName: 'a.pdf', content: '正文一'.repeat(60), indexed: true },
        { id: 'kf-b', fileName: 'b.pdf', content: '正文二'.repeat(60), indexed: false },
      ],
    });
    const res = await h.svc.reindex('kb-1', user);
    expect(res).toMatchObject({ pendingCount: 1, skippedCount: 1 });
    await drain(h);
    expect(h.embed).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0].where.id).toBe('kf-b');
  });

  it('force=true：先 deleteByCollection 整库清，indexed=true 也重建', async () => {
    const h = mkHarness();
    (h.svc as any).prisma.knowledgeBase.findUnique.mockResolvedValue({
      id: 'kb-1', ownerId: 'u-1',
      files: [
        { id: 'kf-a', fileName: 'a.pdf', content: '正文一'.repeat(60), indexed: true },
        { id: 'kf-b', fileName: 'b.pdf', content: '正文二'.repeat(60), indexed: false },
      ],
    });
    const res = await h.svc.reindex('kb-1', user, true);
    expect(res).toMatchObject({ pendingCount: 2, skippedCount: 0 });
    await drain(h);
    expect(h.deleteByCollection).toHaveBeenCalledWith('kb-1');
    expect(h.embed).toHaveBeenCalledTimes(2);
  });

  it('防重入：进行中再点 → {started:false, alreadyRunning:true}，不重复嵌入', async () => {
    const gate: { resolve?: () => void } = {};
    const h = mkHarness({ embedGate: gate });
    const first = await h.svc.reindex('kb-1', user);
    expect(first).toMatchObject({ started: true });
    const second = await h.svc.reindex('kb-1', user); // 首轮 embed 仍挂起
    expect(second).toMatchObject({ started: false, alreadyRunning: true });
    gate.resolve!();
    await drain(h);
    // 两次点击只跑一轮：2 文件 = 2 次 embed，第二次点击零额外副作用
    expect(h.embed).toHaveBeenCalledTimes(2);
  });

  it('幂等替换：增量模式下每文件先 deleteByFileId 再插（无整库清时的双跑防孤儿/重复）', async () => {
    const h = mkHarness();
    await h.svc.reindex('kb-1', user);
    await drain(h);
    expect(h.deleteByFileId).toHaveBeenCalledWith('kf-a');
    expect(h.deleteByFileId).toHaveBeenCalledWith('kf-b');
    for (const id of ['kf-a', 'kf-b']) {
      const delIdx = h.deleteByFileId.mock.calls.findIndex((c) => c[0] === id);
      const insIdx = h.insertChunks.mock.calls.findIndex(
        (c) => c[0][0]?.fileId === id,
      );
      expect(delIdx).toBeGreaterThanOrEqual(0);
      expect(insIdx).toBeGreaterThanOrEqual(0);
      // 跨 mock 顺序：先删后插（invocationCallOrder 全局单调）
      expect(h.insertChunks.mock.invocationCallOrder[insIdx]).toBeGreaterThan(
        h.deleteByFileId.mock.invocationCallOrder[delIdx],
      );
    }
  });
});

describe('KnowledgeService.reindex（按文件降级语义，异步版原样保留）', () => {
  it('嵌入失败 → 该文件 indexed:false、不插向量、循环继续不抛（后台 promise resolve）', async () => {
    const h = mkHarness({ embedReject: true });
    await expect(h.svc.reindex('kb-1', user)).resolves.toMatchObject({ started: true });
    await drain(h);
    expect(h.insertChunks).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledTimes(2);
    for (const call of h.update.mock.calls) {
      expect(call[0].data).toMatchObject({ indexed: false });
    }
  });

  it('向量插入失败 → 该文件 indexed:false、不抛、循环继续', async () => {
    const h = mkHarness({ insertReject: true });
    await h.svc.reindex('kb-1', user);
    await drain(h);
    expect(h.update).toHaveBeenCalledTimes(2);
    for (const call of h.update.mock.calls) {
      expect(call[0].data).toMatchObject({ indexed: false });
    }
  });

  it('update 非删除竞态硬错误 → 后台顶层兜底吞掉（不产生 unhandled rejection）', async () => {
    const h = mkHarness({ updateHardReject: true });
    await expect(h.svc.reindex('kb-1', user)).resolves.toMatchObject({ started: true });
    await expect(drain(h)).resolves.toBeUndefined();
  });
});

describe('KnowledgeService.reindex（解析中删除文件的竞态，2026-11-09 生产实录）', () => {
  it('轮到时已被删除的文件 → 跳过（不嵌入、不插向量、不 update），其余文件照常', async () => {
    const h = mkHarness({ goneBefore: ['kf-a'] });
    const res = await h.svc.reindex('kb-1', user);
    expect(res).toMatchObject({ started: true, pendingCount: 2 });
    await drain(h);
    expect(h.embed).toHaveBeenCalledTimes(1); // 只嵌了幸存的 kf-b
    expect(h.insertChunks).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0].where.id).toBe('kf-b');
  });

  it('预检后到 update 前被并发删除（P2025）→ 不抛、清该文件向量、循环继续', async () => {
    const h = mkHarness({ updateP2025: ['kf-a'] });
    await h.svc.reindex('kb-1', user);
    await drain(h);
    // kf-a 已插向量后才撞 P2025 → 必须回收本次插入，防孤儿向量泄漏检索
    expect(h.deleteByFileId).toHaveBeenCalledWith('kf-a');
    expect(h.update).toHaveBeenCalledTimes(2); // kf-b 照常落库
    expect(h.update.mock.calls[1][0].where.id).toBe('kf-b');
  });
});
