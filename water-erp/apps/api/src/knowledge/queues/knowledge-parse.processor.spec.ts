import type { Job } from 'bullmq';
import { KnowledgeParseProcessor } from './knowledge-parse.processor';
import type { TextChunk } from '../services/text-splitter.service';

/** 知识库解析异步化（2026-11-06）：PARSING→READY/FAILED 状态机 + 进度回写 + 降级语义。
 *  job mock 只带 attemptsMade/opts——processor 对 BullMQ 的全部依赖就这两处。 */
const mkJob = (fileId: string, attemptsMade = 1, attempts = 3): Job<{ fileId: string }> =>
  ({ data: { fileId }, attemptsMade, opts: { attempts } } as unknown as Job<{ fileId: string }>);

const CHUNKS: TextChunk[] = [
  { content: '块一', startOffset: 0, metadata: {} },
  { content: '块二', startOffset: 10, metadata: {} },
];

function mkHarness(opts?: {
  parseImpl?: (buf: Buffer, mime: string, name: string, onProgress?: (p: number, t: number) => void) => Promise<string>;
  embedReject?: boolean;
}) {
  const update = jest.fn().mockResolvedValue(undefined);
  const prisma: any = {
    knowledgeFile: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'kf-1',
        knowledgeBaseId: 'kb-1',
        objectKey: 'knowledge/kb-1/x.pdf',
        mimeType: 'application/pdf',
        fileName: 'x.pdf',
        status: 'PARSING',
      }),
      update,
    },
  };
  const storage: any = { download: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')) };
  const parse = opts?.parseImpl
    ? jest.fn(opts.parseImpl)
    : jest.fn(async (_b: Buffer, _m: string, _n: string, onProgress?: (p: number, t: number) => void) => {
        onProgress?.(40, 100);
        return '全文正文'.repeat(50);
      });
  const parser: any = { parse };
  const splitter: any = { split: jest.fn().mockReturnValue(CHUNKS) };
  const embedding: any = {
    embed: opts?.embedReject
      ? jest.fn().mockRejectedValue(new Error('503 嵌入服务不可用'))
      : jest.fn().mockResolvedValue([[0.1], [0.2]]),
  };
  const insertChunks = jest.fn().mockResolvedValue(undefined);
  const vectorSearch: any = { insertChunks, deleteByFileId: jest.fn() };
  const processor = new KnowledgeParseProcessor(
    prisma, storage, parser, splitter, embedding, vectorSearch,
  );
  return { processor, prisma, storage, parse, embedding, insertChunks, update };
}

describe('KnowledgeParseProcessor 状态机', () => {
  it('PARSING → READY：下载→解析→分块→嵌入→落 content/chunkCount/indexed:true → 插向量', async () => {
    const h = mkHarness();
    await h.processor.process(mkJob('kf-1'));
    expect(h.storage.download).toHaveBeenCalledWith('knowledge/kb-1/x.pdf');
    expect(h.parse).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf', 'x.pdf', expect.any(Function));
    const ready = h.update.mock.calls.map((c) => c[0].data).find((d) => d.status === 'READY');
    expect(ready).toMatchObject({ content: expect.stringContaining('全文正文'), chunkCount: 2, indexed: true });
    expect(h.insertChunks).toHaveBeenCalledTimes(1);
    const chunks = h.insertChunks.mock.calls[0][0];
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ collectionName: 'kb-1', fileId: 'kf-1', embedding: [0.1] });
  });

  it('嵌入失败 → READY + indexed:false（2026-11-03 降级语义，非 FAILED），分块不入向量（validateVector 不吃 undefined）', async () => {
    const h = mkHarness({ embedReject: true });
    await h.processor.process(mkJob('kf-1'));
    const ready = h.update.mock.calls.map((c) => c[0].data).find((d) => d.status === 'READY');
    expect(ready).toMatchObject({ indexed: false, chunkCount: 2 });
    expect(h.insertChunks).not.toHaveBeenCalled();
    const failed = h.update.mock.calls.map((c) => c[0].data).find((d) => d.status === 'FAILED');
    expect(failed).toBeUndefined();
  });

  it('progress 回调 → 回写 processedPages/totalPages（OCR 批次粒度）', async () => {
    const h = mkHarness();
    await h.processor.process(mkJob('kf-1'));
    const prog = h.update.mock.calls.map((c) => c[0].data).find((d) => d.processedPages === 40);
    expect(prog).toMatchObject({ processedPages: 40, totalPages: 100 });
  });

  it('行不存在（已删除）→ no-op：无 update、无 insert、不抛', async () => {
    const h = mkHarness();
    h.prisma.knowledgeFile.findUnique.mockResolvedValue(null);
    await expect(h.processor.process(mkJob('gone'))).resolves.toBeUndefined();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.insertChunks).not.toHaveBeenCalled();
  });

  it('行 status 非 PARSING（READY 旧 job 重放）→ no-op', async () => {
    const h = mkHarness();
    h.prisma.knowledgeFile.findUnique.mockResolvedValue({ id: 'kf-1', status: 'READY' });
    await expect(h.processor.process(mkJob('kf-1'))).resolves.toBeUndefined();
    expect(h.storage.download).not.toHaveBeenCalled();
  });

  it('解析抛错且非末次尝试(attemptsMade 1/3) → rethrow 原错误、不写 FAILED（BullMQ 退避重试）', async () => {
    const h = mkHarness({ parseImpl: async () => { throw new Error('OCR 炸了'); } });
    await expect(h.processor.process(mkJob('kf-1', 1, 3))).rejects.toThrow('OCR 炸了');
    const failed = h.update.mock.calls.map((c) => c[0].data).find((d) => d.status === 'FAILED');
    expect(failed).toBeUndefined();
  });

  it('解析抛错且末次尝试(attemptsMade 3/3) → 写 FAILED + error 消息、不 rethrow', async () => {
    const h = mkHarness({ parseImpl: async () => { throw new Error('OCR 持续不可用'); } });
    await expect(h.processor.process(mkJob('kf-1', 3, 3))).resolves.toBeUndefined();
    const failed = h.update.mock.calls.map((c) => c[0].data).find((d) => d.status === 'FAILED');
    expect(failed).toMatchObject({ status: 'FAILED', error: expect.stringContaining('OCR 持续不可用') });
    expect(h.insertChunks).not.toHaveBeenCalled();
  });
});
