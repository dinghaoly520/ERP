import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';

/** 2026-11-09 生产实录：llama.cpp 版 bge-m3 单批 32 条×~700token 需 220-240s，
 *  叠加并发分抢 slot 后打穿 undici 默认 headersTimeout(300s) → UND_ERR_HEADERS_TIMEOUT
 *  → 一次失败整单降级。修：批 32→4（单批 ~15-30s）+ 单批 120s 显式超时 + 失败重试×2。 */
function makeService() {
  const config = {
    get: (key: string, def?: string) => def ?? '',
  } as unknown as ConfigService;
  return new EmbeddingService(config as never, { isEmbeddingAvailable: () => true } as never);
}

const fakeVec = (n: number) => Array.from({ length: 3 }, (_, i) => n * 10 + i);
const okResponse = (n: number) => ({
  ok: true,
  json: async () => ({ data: Array.from({ length: n }, (_, i) => ({ embedding: fakeVec(i) })) }),
});

describe('EmbeddingService 小批+超时+重试（2026-11-09 生产实录修复）', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('分批粒度为 4：9 条输入 → 3 次请求（4+4+1）', async () => {
    const svc = makeService();
    const calls: number[][] = [];
    (global as any).fetch = jest.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(body.input);
      return okResponse(body.input.length);
    });
    const out = await svc.embed(Array.from({ length: 9 }, (_, i) => `t${i}`));
    expect((global as any).fetch).toHaveBeenCalledTimes(3);
    expect(calls.map((c) => c.length)).toEqual([4, 4, 1]);
    expect(out).toHaveLength(9);
    expect(out[8]).toEqual(fakeVec(0)); // 末批第 1 条
  });

  it('连接层失败自动重试：首两次 fetch failed，第三次成功', async () => {
    const svc = makeService();
    let n = 0;
    (global as any).fetch = jest.fn(async () => {
      n += 1;
      if (n <= 2) {
        const err = new TypeError('fetch failed') as Error & { cause?: unknown };
        err.cause = { code: 'UND_ERR_HEADERS_TIMEOUT' };
        throw err;
      }
      return okResponse(4);
    });
    const out = await svc.embed(Array.from({ length: 4 }, () => 'x'));
    expect(n).toBe(3);
    expect(out).toHaveLength(4);
  });

  it('重试耗尽后抛错（交由上层降级，不再静默吞）', async () => {
    const svc = makeService();
    (global as any).fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(svc.embed(['a', 'b'])).rejects.toThrow('fetch failed');
    // 1 次首发 + 2 次重试
    expect((global as any).fetch).toHaveBeenCalledTimes(3);
  });

  it('HTTP 非 200 不重试直接抛（服务端明确拒绝时重试无意义且有害）', async () => {
    const svc = makeService();
    (global as any).fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => '{"error":"boom"}',
    }));
    await expect(svc.embed(['a'])).rejects.toThrow('Embedding API request failed: 500');
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });
});
