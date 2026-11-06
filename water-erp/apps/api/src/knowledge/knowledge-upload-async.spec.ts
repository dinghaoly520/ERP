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
      findFirst: jest.fn().mockResolvedValue(existing ?? null),
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

  it('并发竞争输家（唯一索引 P2002）→ 重查赢家行返回 deduplicated:true、清自己刚传的孤儿对象、不入队', async () => {
    // 评审 I-1：findFirst→create 窗口（含 118MB MinIO 上传，秒级宽）内并发重复上传，
    // partial unique index（kbId,sha256 WHERE status IN PARSING/READY）兜底——输家 create 抛 P2002
    const h = mkHarness(null);
    h.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    h.prisma.knowledgeFile.findFirst
      .mockResolvedValueOnce(null)                       // 首查 miss（竞争窗口）
      .mockResolvedValueOnce({ id: 'kf-winner', status: 'PARSING', objectKey: 'other' }); // 输家重查见赢家
    const res = await h.svc.uploadFile('kb-1', file, user);
    expect(res).toMatchObject({ id: 'kf-winner', deduplicated: true });
    expect(h.storage.delete).toHaveBeenCalledWith(expect.stringContaining('knowledge/kb-1/'));
    expect(h.queue.add).not.toHaveBeenCalled();
  });
});
