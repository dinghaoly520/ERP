jest.mock('../ai-bid-analysis/utils/file-processor', () => ({
  processFile: jest.fn().mockImplementation(async (_ocr: unknown, buffer: Buffer) => ({ text: buffer.toString('utf-8') })),
}));

import { ScorePointExtractorService } from './score-point-extractor.service';

describe('ScorePointExtractorService', () => {
  let service: ScorePointExtractorService;
  const llm = { chatJson: jest.fn() };
  const validator = { retryChatJson: jest.fn() };
  const plaintextFetcher = { fetchTenderPlaintext: jest.fn() };
  const ocr = {};
  const embedding = { embed: jest.fn() };
  const prisma = {
    bidScoreItem: { findFirst: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScorePointExtractorService(
      llm as any,
      validator as any,
      plaintextFetcher as any,
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

  it('招标文件未就绪（fetchTenderPlaintext 返回 null）抛 TENDER_NOT_READY', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(null);
    await expect(service.extractScorePoints('p1', 'i1')).rejects.toMatchObject({
      response: { code: 'TENDER_NOT_READY' },
    });
  });

  it('返回 LLM 提取的建议数组（不落库）', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [{ name: '已有项' }] });
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
    // processFile 是模块级函数，需 mock —— 见 Step 3 实现里将其作为可注入依赖或 jest.mock
    validator.retryChatJson.mockResolvedValue({
      items: [
        { name: '施工组织设计', fullScore: 15, evidenceHint: '技术标施工组织章节', objective: true },
      ],
    });
    const r = await service.extractScorePoints('p1', 'i1');
    expect(r).toEqual([{ name: '施工组织设计', fullScore: 15, evidenceHint: '技术标施工组织章节', objective: true }]);
    expect(validator.retryChatJson).toHaveBeenCalledTimes(1);
  });

  it('招标文本缓存命中：第二次不重新 fetch', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractScorePoints('p1', 'i1');
    await service.extractScorePoints('p1', 'i1');
    expect(plaintextFetcher.fetchTenderPlaintext).toHaveBeenCalledTimes(1);
  });

  // E2: fullScore 归一化
  it('E2: fullScore 合计超过满分时等比缩放', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 40, points: [] });
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
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
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
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
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from(tenderWithChapter));
    validator.retryChatJson.mockResolvedValue({ items: [] });
    await service.extractScorePoints('p1', 'i1');
    // 验证 LLM 收到的 prompt 包含章节文本
    const promptArg = validator.retryChatJson.mock.calls[0][2] as string;
    expect(promptArg).toContain('评分细则测试文本');
    expect(plaintextFetcher.fetchTenderPlaintext).toHaveBeenCalledTimes(1);
  });

  // E5: PRICE 类别直接返回空数组,不调 LLM
  it('E5: PRICE 类别直接返回空数组,不调 LLM', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'PRICE', name: '价格评分', maxScore: 30, points: [] });
    const r = await service.extractScorePoints('p1', 'i1');
    expect(r).toEqual([]);
    expect(plaintextFetcher.fetchTenderPlaintext).not.toHaveBeenCalled();
  });

  // E6: LLM 故障降级,不抛 500
  it('E6: LLM 故障返回空数组不抛异常', async () => {
    prisma.bidScoreItem.findFirst.mockResolvedValue({ id: 'i1', projectId: 'p1', category: 'TECHNICAL', name: '技术评分', maxScore: 50, points: [] });
    plaintextFetcher.fetchTenderPlaintext.mockResolvedValue(Buffer.from('fake-tender'));
    validator.retryChatJson.mockRejectedValue(new Error('LLM down'));
    const r = await service.extractScorePoints('p1', 'i1');
    expect(r).toEqual([]);
  });
});
