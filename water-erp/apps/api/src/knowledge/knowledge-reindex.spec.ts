import { KnowledgeService } from './knowledge.service';

/** 评审 I-3（2026-11-06）：reindex 是 indexed=false 徽章指引的补救动作——成功后必须复位
 *  indexed:true；嵌入/向量失败按文件降级（indexed:false 继续），不得中途 500（旧行为：
 *  全库向量已清光而循环中断）。 */
function mkHarness(opts?: {
  embedReject?: boolean;
  insertReject?: boolean;
  /** 这些文件在轮到时已被删除（预检 findFirst 返 null） */
  goneBefore?: string[];
  /** 这些文件的 update 撞 P2025（预检后残余竞态：刚被并发删除） */
  updateP2025?: string[];
}) {
  const update = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    if (opts?.updateP2025?.includes(where.id)) {
      const e: any = new Error(
        'An operation failed because it depends on one or more records that were required but not found.',
      );
      e.code = 'P2025';
      return Promise.reject(e);
    }
    return Promise.resolve(undefined);
  });
  const FILES = [
    { id: 'kf-a', fileName: 'a.pdf', content: '正文一'.repeat(60) },
    { id: 'kf-b', fileName: 'b.pdf', content: '正文二'.repeat(60) },
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
    embed: opts?.embedReject
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
    update,
    insertChunks: vectorSearch.insertChunks,
    embed: embedding.embed,
    deleteByFileId: vectorSearch.deleteByFileId,
  };
}

const user: any = { sub: 'u-1', role: 'leader' };

describe('KnowledgeService.reindex（indexed 复位 + 按文件降级）', () => {
  it('嵌入+向量全成功 → 每文件 update 写 chunkCount 与 indexed:true（徽章复位）', async () => {
    const h = mkHarness();
    await h.svc.reindex('kb-1', user);
    expect(h.update).toHaveBeenCalledTimes(2);
    for (const call of h.update.mock.calls) {
      expect(call[0].data).toMatchObject({ chunkCount: 1, indexed: true });
    }
  });

  it('嵌入失败 → 该文件 indexed:false、不插入向量、循环继续不抛（其余文件照常）', async () => {
    const h = mkHarness({ embedReject: true });
    await expect(h.svc.reindex('kb-1', user)).resolves.toBeTruthy();
    expect(h.insertChunks).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledTimes(2);
    for (const call of h.update.mock.calls) {
      expect(call[0].data).toMatchObject({ indexed: false });
    }
  });

  it('向量插入失败 → 该文件 indexed:false、不抛、循环继续', async () => {
    const h = mkHarness({ insertReject: true });
    await expect(h.svc.reindex('kb-1', user)).resolves.toBeTruthy();
    expect(h.update).toHaveBeenCalledTimes(2);
    for (const call of h.update.mock.calls) {
      expect(call[0].data).toMatchObject({ indexed: false });
    }
  });
});

describe('KnowledgeService.reindex（解析中删除文件的竞态，2026-11-09 生产实录）', () => {
  // 实录：嵌入慢（旧代码单文件可挂 300s）窗口内用户删文件 → 循环尾部 update 撞
  // P2025 → 整单 404 且后续文件向量已被清又未重建。同 d4e9ad00b 协作式取消语义。

  it('轮到时已被删除的文件 → 跳过（不嵌入、不插向量、不 update），其余文件照常', async () => {
    const h = mkHarness({ goneBefore: ['kf-a'] });
    const res = await h.svc.reindex('kb-1', user);
    expect(h.embed).toHaveBeenCalledTimes(1); // 只嵌了幸存的 kf-b
    expect(h.insertChunks).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0].where.id).toBe('kf-b');
    expect(res).toMatchObject({ reindexed: true, deletedSkipped: 1 });
  });

  it('预检后到 update 前被并发删除（P2025）→ 不抛、清该文件向量、循环继续', async () => {
    const h = mkHarness({ updateP2025: ['kf-a'] });
    const res = await h.svc.reindex('kb-1', user);
    expect(res).toBeTruthy();
    // kf-a 已插向量后才撞 P2025 → 必须回收本次插入，防孤儿向量泄漏检索
    expect(h.deleteByFileId).toHaveBeenCalledWith('kf-a');
    expect(h.update).toHaveBeenCalledTimes(2); // kf-b 照常落库
    expect(h.update.mock.calls[1][0].where.id).toBe('kf-b');
    expect(res.deletedSkipped).toBe(1);
  });
});
