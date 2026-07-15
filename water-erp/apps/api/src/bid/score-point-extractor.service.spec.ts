jest.mock('../ai-bid-analysis/utils/file-processor', () => ({
  processFile: jest.fn().mockResolvedValue({ text: 'mocked tender text' }),
}));

import { ScorePointExtractorService } from './score-point-extractor.service';

describe('ScorePointExtractorService', () => {
  let service: ScorePointExtractorService;
  const llm = { chatJson: jest.fn() };
  const validator = { retryChatJson: jest.fn() };
  const plaintextFetcher = { fetchTenderPlaintext: jest.fn() };
  const ocr = {};
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
});
