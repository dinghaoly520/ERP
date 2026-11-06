import { BadRequestException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

/** 知识库上传异步化（2026-11-06）：收件即建 PARSING 行+入队（不再内联解析）；
 *  同库 sha256 去重（PARSING/READY→复用返回、FAILED→重置重入队）；FAILED 可 retry。 */
function mkHarness(existing?: { id: string; status: string; objectKey?: string } | null) {
  const create = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: 'kf-new',
    ...data,
  }));
  const update = jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    fileName: 'x.pdf',
    ...data,
  }));
  const prisma: any = {
    knowledgeBase: { findUnique: jest.fn().mockResolvedValue({ id: 'kb-1', ownerId: 'u-1' }) },
    knowledgeFile: {
      // 语义化 mock：按 where.status（裸字符串或 in 数组）判断本查询是否命中（贴近真实 DB 过滤）
      findFirst: jest.fn(async ({ where }: any) => {
        const st = where?.status;
        const wanted: string[] = typeof st === 'string' ? [st] : st?.in ?? [];
        return existing && wanted.includes(existing.status) ? existing : null;
      }),
      findUnique: jest.fn(),
      create,
      update,
    },
  };
  const storage: any = {
    upload: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const svc = new KnowledgeService(
    prisma,
    storage,
    { parse: jest.fn() } as any,
    { split: jest.fn() } as any,
    { embed: jest.fn() } as any,
    { insertChunks: jest.fn(), deleteByFileId: jest.fn(), deleteByCollection: jest.fn() } as any,
    queue as any,
  );
  return { svc, prisma, storage, queue, create, update };
}

const file: any = { originalname: '制度.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x'), size: 10 };
const user: any = { sub: 'u-1', role: 'leader' };

describe('KnowledgeService 上传异步化', () => {
  it('上传 → 建 PARSING 行（sha256 落列）+ queue.add(fileId, jobId=fileId, attempts=3, removeOnFail) —— 不内联 parse/embed', async () => {
    const { svc, create, queue } = mkHarness();
    const res = await svc.uploadFile('kb-1', file, user);
    expect(res.status).toBe('PARSING');
    expect(res.sha256).toHaveLength(64);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({ knowledgeBaseId: 'kb-1', status: 'PARSING', fileName: '制度.pdf' });
    expect(queue.add).toHaveBeenCalledWith(
      'parse',
      { fileId: 'kf-new' },
      expect.objectContaining({ jobId: 'kf-new', attempts: 3, removeOnFail: true }),
    );
  });

  it('同库同 sha256 已 PARSING → 返回既有行 deduplicated:true，不建行不入队', async () => {
    const { svc, create, queue } = mkHarness({ id: 'kf-old', status: 'PARSING' });
    const res = await svc.uploadFile('kb-1', file, user);
    expect(res).toMatchObject({ id: 'kf-old', deduplicated: true });
    expect(create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('同库同 sha256 已 READY → 同上复用', async () => {
    const { svc, create, queue } = mkHarness({ id: 'kf-ready', status: 'READY' });
    const res = await svc.uploadFile('kb-1', file, user);
    expect(res).toMatchObject({ id: 'kf-ready', deduplicated: true });
    expect(create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('同库同 sha256 已 FAILED → 复用该行重置 PARSING 并重新入队（不建新行，best-effort 清旧对象）', async () => {
    const { svc, create, update, queue, storage } = mkHarness({ id: 'kf-failed', status: 'FAILED', objectKey: 'knowledge/kb-1/old.pdf' });
    const res = await svc.uploadFile('kb-1', file, user);
    expect(res.id).toBe('kf-failed');
    expect(res.status).toBe('PARSING');
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      { where: { id: 'kf-failed' }, data: expect.objectContaining({ status: 'PARSING', error: null, processedPages: 0 }) },
    );
    expect(queue.add).toHaveBeenCalledWith('parse', { fileId: 'kf-failed' }, expect.objectContaining({ jobId: 'kf-failed' }));
    expect(storage.delete).toHaveBeenCalledWith('knowledge/kb-1/old.pdf');
  });

  it('retryFile：FAILED 行 → 重置+入队；READY 行 → BadRequest', async () => {
    const h = mkHarness({ id: 'kf-1', status: 'FAILED' });
    h.prisma.knowledgeFile.findFirst
      .mockResolvedValueOnce({ id: 'kf-1', status: 'FAILED' })
      .mockResolvedValueOnce({ id: 'kf-2', status: 'READY' });
    const res = await h.svc.retryFile('kb-1', 'kf-1', user);
    expect(res.status).toBe('PARSING');
    expect(h.queue.add).toHaveBeenCalledWith('parse', { fileId: 'kf-1' }, expect.objectContaining({ jobId: 'kf-1' }));
    await expect(h.svc.retryFile('kb-1', 'kf-2', user)).rejects.toThrow(BadRequestException);
  });

  it('M-3 retry 双击幂等：PARSING 行 → 返回当前行（不 400、不重复入队——job 已在跑）', async () => {
    const h = mkHarness(null);
    h.prisma.knowledgeFile.findFirst.mockResolvedValueOnce({ id: 'kf-run', status: 'PARSING', fileName: 'x.pdf' });
    const res = await h.svc.retryFile('kb-1', 'kf-run', user);
    expect(res).toMatchObject({ id: 'kf-run', status: 'PARSING' });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.queue.add).not.toHaveBeenCalled();
  });

  it('并发竞争输家（唯一索引 P2002）→ 重查赢家行返回 deduplicated:true、清自己刚传的孤儿对象、不入队', async () => {
    // 评审 I-1：findFirst→create 窗口（含 118MB MinIO 上传，秒级宽）内并发重复上传，
    // partial unique index（kbId,sha256 WHERE status IN PARSING/READY）兜底——输家 create 抛 P2002
    const h = mkHarness(null);
    let winnerRow: any = null;
    h.prisma.knowledgeFile.findFirst.mockImplementation(async ({ where }: any) =>
      where?.status?.in?.includes('PARSING') ? winnerRow : null);
    h.create.mockImplementation(async () => {
      if (winnerRow) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      winnerRow = { id: 'kf-winner', status: 'PARSING', objectKey: 'other' };
      throw Object.assign(new Error('模拟：首建者胜出后，本输家的 create 撞唯一索引'), { code: 'P2002' });
    });
    const res = await h.svc.uploadFile('kb-1', file, user);
    expect(res).toMatchObject({ id: 'kf-winner', deduplicated: true });
    expect(h.storage.delete).toHaveBeenCalledWith(expect.stringContaining('knowledge/kb-1/'));
    expect(h.queue.add).not.toHaveBeenCalled();
  });

  it('M-5 建行抛错（非 P2002）→ best-effort 清刚传的 MinIO 对象后 rethrow（不留孤儿）', async () => {
    const h = mkHarness(null);
    h.create.mockRejectedValueOnce(new Error('db down'));
    await expect(h.svc.uploadFile('kb-1', file, user)).rejects.toThrow('db down');
    expect(h.storage.delete).toHaveBeenCalledWith(expect.stringContaining('knowledge/kb-1/'));
    expect(h.queue.add).not.toHaveBeenCalled();
  });

  it('M-7 并发窗口钉子：双方都过了去重查询（A 挂在 MinIO 上传、B 全程跑完建行）→ A 的 create 撞唯一索引兜底返回 B 的行', async () => {
    const h = mkHarness(null);
    let winnerRow: any = null;
    // 模拟 DB 语义：active 去重查询返回「当刻」已存在的赢家；FAILED 复用查询恒空
    h.prisma.knowledgeFile.findFirst.mockImplementation(async ({ where }: any) =>
      where?.status?.in?.includes('PARSING') ? winnerRow : null);
    h.create.mockImplementation(async ({ data }: any) => {
      if (winnerRow) throw Object.assign(new Error('Unique constraint failed on KnowledgeFile_kb_sha_active_uniq'), { code: 'P2002' });
      winnerRow = { id: 'kf-B', ...data };
      return winnerRow;
    });
    // A 的存储上传被闸住（118MB 慢传＝天然竞争窗），B 不受闸先跑完全链
    let releaseA!: () => void;
    const gate = new Promise<void>(r => { releaseA = r; });
    let uploadCalls = 0;
    h.storage.upload.mockImplementation(async () => { if (++uploadCalls === 1) await gate; });

    const pa = h.svc.uploadFile('kb-1', file, user);
    const pb = h.svc.uploadFile('kb-1', file, user);
    await new Promise(r => setImmediate(r)); // B 建成赢家行
    releaseA();                              // A 恢复：create 撞唯一索引
    const [a, b] = await Promise.all([pa, pb]);

    expect(b).toMatchObject({ id: 'kf-B' });
    expect(b.deduplicated).toBeUndefined();
    expect(a).toMatchObject({ id: 'kf-B', deduplicated: true }); // 输家复用赢家行
    // 建行尝试 2 次（B 成功 + A 撞唯一索引），但落库仅一行——两响应同 id 即单行契约
    expect(h.create).toHaveBeenCalledTimes(2);
    expect(a.id).toBe(b.id);
  });
});
