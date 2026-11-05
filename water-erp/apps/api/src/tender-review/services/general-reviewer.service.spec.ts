import { GeneralReviewerService } from './general-reviewer.service';

/**
 * 预算契约（2026-11-05）：deepseek-flash 为推理模型，思维链与正文共享 max_tokens——
 * 通用审查曾以默认 16384 调用，「询比采购邀请」章节思维链独占预算
 * （finish_reason=length、content 空，3 发全截断）。契约：显式 maxTokens=32768
 * （直连探针已验证 API 接受），截断时另由 LlmService 重试外壳继续升级兜底。
 */
describe('GeneralReviewerService', () => {
  it('chatJson 以 maxTokens=65536 + timeoutMs=300s 调用（推理模型思维链共享预算，16k 曾被吃满）', async () => {
    const chatJson = jest.fn().mockResolvedValue({ issues: [] });
    const vectorSearch = { search: jest.fn().mockResolvedValue([]) };
    // 走 detectChapters 轨道（splitIntoLargeChunks 兜底有 >100 字符门槛）
    const clauseParser = {
      detectChapters: jest
        .fn()
        .mockReturnValue([{ name: '第一章 询比采购邀请', offset: 0 }]),
      parse: jest.fn().mockReturnValue({ clauses: [] }),
    };
    const service = new GeneralReviewerService(
      { chatJson } as any,
      vectorSearch as any,
      clauseParser as any,
    );
    await service.review('第一章 询比采购邀请\n正文内容', 'kb-1');
    expect(chatJson).toHaveBeenCalledTimes(1);
    expect(chatJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('询比采购邀请'),
      0,
      undefined,
      undefined,
      { maxTokens: 65536, timeoutMs: 300_000 },
    );
  });
});
