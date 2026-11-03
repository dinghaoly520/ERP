import { KnowledgeService } from './knowledge.service';

/** 2026-11-03 设计 §4.2：嵌入失败不再整体报错——文件/分块照存（向量列空），
 *  返回 indexed:false 提示重建索引；检索天然不命中无向量分块。 */
describe('KnowledgeService 上传嵌入失败降级', () => {
  const mkSvc = (embedReject: boolean) => {
    const prisma: any = {
      knowledgeFile: { create: jest.fn().mockResolvedValue({ id: 'kf-1', fileName: 'a.pdf' }) },
      knowledgeBase: { findUnique: jest.fn().mockResolvedValue({ id: 'kb-1', ownerId: 'u-1' }) },
    };
    const embedding: any = { embed: embedReject ? jest.fn().mockRejectedValue(new Error('503')) : jest.fn().mockResolvedValue([[0.1, 0.2]]) };
    const svc = new KnowledgeService(
      prisma,
      { upload: jest.fn().mockResolvedValue(undefined) } as any,   // storage
      { parse: jest.fn().mockResolvedValue('正文内容'.repeat(50)) } as any, // parser
      { split: jest.fn().mockReturnValue([{ content: '块一', startOffset: 0 }]) } as any, // splitter
      embedding,
      { insertChunks: jest.fn().mockResolvedValue(undefined), deleteByFileId: jest.fn(), deleteByCollection: jest.fn() } as any, // vectorSearch
    );
    return { svc, prisma, embedding };
  };
  const file: any = { originalname: '制度.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x'), size: 10 };
  const user: any = { sub: 'u-1', role: 'leader' };

  it('嵌入失败 → 不抛错，文件照存，返回 indexed:false', async () => {
    const { svc, prisma } = mkSvc(true);
    const res = await svc.uploadFile('kb-1', file, user);
    expect(res.indexed).toBe(false);
    expect(prisma.knowledgeFile.create).toHaveBeenCalledTimes(1);
  });

  it('嵌入成功 → indexed:true', async () => {
    const { svc } = mkSvc(false);
    const res = await svc.uploadFile('kb-1', file, user);
    expect(res.indexed).toBe(true);
  });
});
