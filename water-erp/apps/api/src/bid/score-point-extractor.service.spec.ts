jest.mock('../ai-bid-analysis/utils/file-processor', () => ({
  processFile: jest.fn().mockImplementation(async (_ocr: unknown, buffer: Buffer) => ({ text: buffer.toString('utf-8') })),
}));

// PMI 附件本地盘读取（resolveTenderAttachment）——单测 mock 真实 fs
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('tender-text')),
}));

import { ScorePointExtractorService } from './score-point-extractor.service';

describe('ScorePointExtractorService', () => {
  let service: ScorePointExtractorService;
  const llm = { chatJson: jest.fn() };
  const validator = { retryChatJson: jest.fn() };
  const ocr = {};
  const embedding = { embed: jest.fn() };
  const prisma = {
    bidScoreItem: { findFirst: jest.fn(), findMany: jest.fn() },
    bidProject: { findUnique: jest.fn() },
    attachment: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    projectManagementStage: { findUnique: jest.fn() },
  };

  /** 源解析链 mock 快捷方式：BP→PMI、03 阶段最新附件、本地盘读到 tender-text */
  function mockAutoSource(text = 'fake-tender') {
    prisma.bidProject.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', round: 1 });
    prisma.attachment.findFirst.mockResolvedValue({
      id: 'att-1',
      fileName: '采购文件.docx',
      objectKey: 'project-management/t.docx',
      extractedText: null,
      projectManagementStageId: 'stage-1',
    });
    (require('node:fs/promises').readFile as jest.Mock).mockResolvedValue(Buffer.from(text));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.attachment.update.mockResolvedValue({});
    service = new ScorePointExtractorService(
      llm as any,
      validator as any,
      ocr as any,
      embedding as any,
      prisma as any,
    );
  });

  it('评分项不存在抛 NOT_FOUND', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue(null);
    await expect(service.extractScorePoints('p1', 'iX')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });

  it('PRICE 项不再跳过——与打分类同样走提取（2026-09-26 裁定：03 即配得分要点，采购文件含价格项则提取）', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i-price', projectId: 'p1', category: 'PRICE', name: '价格评分', maxScore: 30, points: [] });
    mockAutoSource();
    validator.retryChatJson.mockResolvedValue({ items: [{ name: '报价合理性', fullScore: 30 }] });
    const out = await service.extractScorePoints('p1', 'i-price');
    expect(out.length).toBe(1); // 不再返回 []
    expect(validator.retryChatJson).toHaveBeenCalled();
  });

  it('自动解析：取该轮 03 阶段最新附件（不限类型）', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 40, points: [] });
    mockAutoSource('pmi-tender-text');
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractScorePoints('p1', 'i1');
    // 03 阶段查询带 round；processFile 收到附件真实文件名
    const where = prisma.attachment.findFirst.mock.calls[0][0].where.projectManagementStage;
    expect(where.stageKey).toBe('TENDER_DOCUMENT');
    expect(where.round).toBe(1);
  });

  it('03 阶段无附件 → 抛 TENDER_NOT_READY（公告链兜底已撤，2026-09-26 用户裁定）', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 40, points: [] });
    prisma.bidProject.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', round: 1 });
    prisma.attachment.findFirst.mockResolvedValue(null);
    await expect(service.extractScorePoints('p1', 'i1'))
      .rejects.toMatchObject({ response: { code: 'TENDER_NOT_READY' } });
  });

  it('显式指定源：读该附件并校验归属本项目 03 步骤', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    prisma.bidProject.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', round: 1 });
    prisma.attachment.findUnique.mockResolvedValue({
      id: 'att-official',
      fileName: '采购文件-盖章版.pdf',
      objectKey: 'project-management/official.pdf',
      extractedText: null,
      projectManagementStageId: 'stage-1',
    });
    prisma.projectManagementStage.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', stageKey: 'TENDER_DOCUMENT' });
    (require('node:fs/promises').readFile as jest.Mock).mockResolvedValue(Buffer.from('official-text'));
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractScorePoints('p1', 'i1', 'att-official');
    expect(prisma.attachment.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'att-official' } }),
    );
  });

  it('显式指定源不属于本项目 03 步骤 → SOURCE_INVALID', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    prisma.bidProject.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', round: 1 });
    prisma.attachment.findUnique.mockResolvedValue({
      id: 'att-x',
      fileName: '别的文件.pdf',
      objectKey: 'project-management/x.pdf',
      extractedText: null,
      projectManagementStageId: 'stage-x',
    });
    prisma.projectManagementStage.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-OTHER', stageKey: 'TENDER_DOCUMENT' });
    await expect(service.extractScorePoints('p1', 'i1', 'att-x'))
      .rejects.toMatchObject({ response: { code: 'SOURCE_INVALID' } });
  });

  it('显式指定源无阶段归属（项目级附件，projectManagementStageId=null）→ SOURCE_INVALID（审查修复：初版静默放行）', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    prisma.bidProject.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', round: 1 });
    prisma.attachment.findUnique.mockResolvedValue({
      id: 'att-no-stage',
      fileName: '项目级附件.pdf',
      objectKey: 'project-management/no-stage.pdf',
      extractedText: null,
      projectManagementStageId: null,
    });
    await expect(service.extractScorePoints('p1', 'i1', 'att-no-stage'))
      .rejects.toMatchObject({ response: { code: 'SOURCE_INVALID' } });
  });

  it('extractedText 懒缓存直读：不跑 processFile、不写缓存', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    prisma.bidProject.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', round: 1 });
    prisma.attachment.findFirst.mockResolvedValue({
      id: 'att-1',
      fileName: '采购文件-盖章扫描件.pdf',
      objectKey: 'project-management/scan.pdf',
      extractedText: '此前 OCR 的全文',
      projectManagementStageId: 'stage-1',
    });
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractScorePoints('p1', 'i1');
    const { processFile } = require('../ai-bid-analysis/utils/file-processor');
    expect(processFile).not.toHaveBeenCalled();
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });

  it('首次提取后 extractedText 落库懒缓存', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    mockAutoSource('fresh-ocr-text');
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractScorePoints('p1', 'i1');
    await Promise.resolve(); // fire-and-forget 落库
    expect(prisma.attachment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'att-1' }, data: expect.objectContaining({ extractedText: 'fresh-ocr-text' }) }),
    );
  });

  it('返回 LLM 提取的建议数组（不落库）', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [{ name: '已有项' }] });
    mockAutoSource();
    validator.retryChatJson.mockResolvedValue({
      items: [
        { name: '施工组织设计', fullScore: 15, evidenceHint: '技术标施工组织章节', objective: true },
      ],
    });
    const r = await service.extractScorePoints('p1', 'i1');
    expect(r).toEqual([{ name: '施工组织设计', fullScore: 15, evidenceHint: '技术标施工组织章节', objective: true }]);
    expect(validator.retryChatJson).toHaveBeenCalledTimes(1);
  });

  it('源文本缓存命中：第二次不重新解析附件', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    mockAutoSource();
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractScorePoints('p1', 'i1');
    await service.extractScorePoints('p1', 'i1');
    expect(prisma.attachment.findFirst).toHaveBeenCalledTimes(1);
  });

  // E2: fullScore 归一化
  it('E2: fullScore 合计超过满分时等比缩放', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 40, points: [] });
    mockAutoSource();
    // embedding 不需要（正则优先命中无章节标题 → 回退截断）
    validator.retryChatJson.mockResolvedValue({
      items: [
        { name: 'A', fullScore: 30, evidenceHint: '', objective: true },
        { name: 'B', fullScore: 30, evidenceHint: '', objective: true },
      ],
    });
    const r = await service.extractScorePoints('p1', 'i1');
    expect(r[0].fullScore).toBe(20);
    expect(r[1].fullScore).toBe(20);
    expect(r[0].adjusted).toBe(true);
    expect(r[1].adjusted).toBe(true);
  });

  it('E2: 合计未超满分时不调整', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    mockAutoSource();
    validator.retryChatJson.mockResolvedValue({
      items: [{ name: 'A', fullScore: 15, evidenceHint: '', objective: true }],
    });
    const r = await service.extractScorePoints('p1', 'i1');
    expect(r[0].fullScore).toBe(15);
    expect(r[0].adjusted).toBeUndefined();
  });

  // E1: 正则命中章节
  it('E1: 正则命中评标办法章节时返回该章文本', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    const tenderWithChapter = '第一章 总则\n无关内容\n第二章 评标办法\n评分细则测试文本\n包含评分标准内容\n需要足够长才能通过 100 字校验所以多写一些\n'.repeat(3);
    mockAutoSource(tenderWithChapter);
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractScorePoints('p1', 'i1');
    // 验证 LLM 收到的 prompt 包含章节文本
    const promptArg = validator.retryChatJson.mock.calls[0][2] as string;
    expect(promptArg).toContain('评分细则测试文本');
  });

  // E5 已撤除（2026-09-26 裁定）：PRICE 同样提取——由上方「PRICE 项不再跳过」用例守门

  // E6: LLM 故障降级,不抛 500
  it('E6: LLM 故障返回空数组不抛异常', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    mockAutoSource();
    validator.retryChatJson.mockRejectedValue(new Error('LLM down'));
    const r = await service.extractScorePoints('p1', 'i1');
    expect(r).toEqual([]);
  });

  // E4: 去重
  it('E4: 与已有得分点名称高度相似时标 duplicate', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [{ name: '施工组织设计' }] });
    mockAutoSource();
    validator.retryChatJson.mockResolvedValue({
      items: [
        { name: '施工组织设计方案', fullScore: 15, evidenceHint: '', objective: true },
        { name: '完全不同的新项', fullScore: 10, evidenceHint: '', objective: true },
      ],
    });
    const r = await service.extractScorePoints('p1', 'i1');
    expect(r[0].duplicate).toBe(true);   // 与已有「施工组织设计」高度相似
    expect(r[1].duplicate).toBeUndefined();
  });

  // ── extractAllScorePoints：一键提取全部评分项 ──

  it('一键提取：含 PRICE 项一并分组返回（E5 撤除，2026-09-26）', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 't1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
      { id: 'pr1', projectId: 'p1', category: 'PRICE', name: '价格评分', maxScore: 30, points: [] },
    ]);
    mockAutoSource();
    validator.retryChatJson.mockResolvedValue({
      items: [{ name: '施工组织设计', fullScore: 10, evidenceHint: '', objective: true }],
    });
    const r = await service.extractAllScorePoints('p1');
    expect(r.map((g) => g.itemId)).toEqual(['t1', 'pr1']); // findMany mock 返回序
    expect(r[0]).toMatchObject({ itemName: '技术评分', category: 'TECHNICAL', maxScore: 50 });
    expect(r[0].suggestions).toHaveLength(1);
  });

  it('一键提取：逐项聚合且保留空建议组，源文件只解析一次（缓存）', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 't1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
      { id: 'b1', projectId: 'p1', category: 'BUSINESS', name: '商务评分', maxScore: 20, points: [] },
    ]);
    mockAutoSource();
    validator.retryChatJson
      .mockResolvedValueOnce({ items: [{ name: 'A', fullScore: 10, evidenceHint: '', objective: true }] })
      .mockResolvedValueOnce({ items: [] });
    const r = await service.extractAllScorePoints('p1');
    expect(r).toHaveLength(2);
    expect(r[0].suggestions).toHaveLength(1);
    expect(r[1]).toMatchObject({ itemId: 'b1', suggestions: [] });
    expect(prisma.attachment.findFirst).toHaveBeenCalledTimes(1);
  });

  it('一键提取：指定正式盖章版源——全部项走同一 sourceAttachmentId', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 't1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
    ]);
    prisma.bidProject.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', round: 1 });
    prisma.attachment.findUnique.mockResolvedValue({
      id: 'att-official',
      fileName: '采购文件-盖章版.pdf',
      objectKey: 'project-management/official.pdf',
      extractedText: null,
      projectManagementStageId: 'stage-1',
    });
    prisma.projectManagementStage.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', stageKey: 'TENDER_DOCUMENT' });
    (require('node:fs/promises').readFile as jest.Mock).mockResolvedValue(Buffer.from('official-text'));
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractAllScorePoints('p1', 'att-official');
    // 显式源走 findUnique（不走 findFirst 自动解析）
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
    expect(prisma.attachment.findUnique).toHaveBeenCalledTimes(1);
  });

  it('一键提取：采购文件未就绪抛 TENDER_NOT_READY', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 't1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
    ]);
    prisma.bidProject.findUnique.mockResolvedValue({ projectManagementItemId: 'pmi-1', round: 1 });
    prisma.attachment.findFirst.mockResolvedValue(null);
    await expect(service.extractAllScorePoints('p1')).rejects.toMatchObject({
      response: { code: 'TENDER_NOT_READY' },
    });
  });

  it('一键提取：单项 LLM 失败该组为空，不中断整批', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([
      { id: 't1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] },
      { id: 'b1', projectId: 'p1', category: 'BUSINESS', name: '商务评分', maxScore: 20, points: [] },
    ]);
    mockAutoSource();
    validator.retryChatJson
      .mockRejectedValueOnce(new Error('llm down'))
      .mockResolvedValueOnce({ items: [{ name: 'B', fullScore: 5, evidenceHint: '', objective: true }] });
    const r = await service.extractAllScorePoints('p1');
    expect(r[0].suggestions).toEqual([]);
    expect(r[1].suggestions).toHaveLength(1);
  });

  it('一键提取：无评分项返回空数组且不解析采购文件', async () => {
    prisma.bidScoreItem.findMany.mockResolvedValue([]);
    await expect(service.extractAllScorePoints('p1')).resolves.toEqual([]);
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
  });
});
