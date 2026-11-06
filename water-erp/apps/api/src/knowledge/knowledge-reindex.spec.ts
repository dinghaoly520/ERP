import { KnowledgeService } from './knowledge.service';

/** 评审 I-3（2026-11-06）：reindex 是 indexed=false 徽章指引的补救动作——成功后必须复位
 *  indexed:true；嵌入/向量失败按文件降级（indexed:false 继续），不得中途 500（旧行为：
 *  全库向量已清光而循环中断）。 */
function mkHarness(opts?: { embedReject?: boolean; insertReject?: boolean }) {
  const update = jest.fn().mockResolvedValue(undefined);
  const FILES = [
    { id: 'kf-a', fileName: 'a.pdf', content: '正文一'.repeat(60) },
    { id: 'kf-b', fileName: 'b.pdf', content: '正文二'.repeat(60) },
  ];
  const prisma: any = {
    knowledgeBase: {
      findUnique: jest.fn().mockResolvedValue({ id: 'kb-1', ownerId: 'u-1', files: FILES }),
    },
    knowledgeFile: { update },
  };
  const vectorSearch: any = {
    deleteByCollection: jest.fn().mockResolvedValue(undefined),
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
  return { svc, update, insertChunks: vectorSearch.insertChunks, embed: embedding.embed };
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
