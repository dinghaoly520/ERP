import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

/** mock fetch 响应工厂 */
const okRes = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => '',
  headers: new Headers(),
});

const errRes = (status: number, retryAfter?: string) => ({
  ok: false,
  status,
  text: async () => 'error body',
  json: async () => ({}),
  headers: new Headers(retryAfter ? { 'retry-after': retryAfter } : {}),
});

/** 尊重 AbortSignal 的 fetch mock 基础行为 */
function signalAware(impl: (url: any, init: any) => Promise<any>) {
  return jest.fn(async (url: any, init: any) => {
    if (init?.signal?.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    return impl(url, init);
  });
}

async function makeService(envOverrides: Record<string, string> = {}): Promise<LlmService> {
  const env: Record<string, string> = {
    DEEPSEEK_API_KEY: 'test-key',
    DEEPSEEK_MODEL: 'deepseek-v4-pro',
    LLM_RETRY_BASE_MS: '1', // 退避基数 1ms，测试快进
    ...envOverrides,
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LlmService,
      {
        provide: ConfigService,
        useValue: { get: (key: string, def?: string) => env[key] ?? def },
      },
    ],
  }).compile();
  return module.get(LlmService);
}

describe('LlmService', () => {
  let service: LlmService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    service = await makeService();
    fetchMock = signalAware(async () => okRes('hello'));
    (global as any).fetch = fetchMock;
  });

  const lastBody = (callIndex = -1) => {
    const call = fetchMock.mock.calls[callIndex < 0 ? fetchMock.mock.calls.length + callIndex : callIndex];
    return JSON.parse(call[1].body);
  };

  it('chat 成功返回 content，默认 model/max_tokens 来自 env', async () => {
    await expect(service.chat('sys', 'usr')).resolves.toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastBody();
    expect(body.model).toBe('deepseek-v4-pro');
    expect(body.max_tokens).toBe(16384);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('options 覆盖 model/maxTokens 透传请求体', async () => {
    await service.chat('s', 'u', 0.2, undefined, undefined, {
      model: 'deepseek-v4-flash',
      maxTokens: 420,
    });
    const body = lastBody();
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.max_tokens).toBe(420);
  });

  it('429 → 200：重试一次后成功', async () => {
    fetchMock = signalAware(async () => okRes('x'));
    fetchMock.mockResolvedValueOnce(errRes(429, '0'));
    (global as any).fetch = fetchMock;
    await expect(service.chat('s', 'u')).resolves.toBe('x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('500 → 502 → 200：两次重试后成功', async () => {
    fetchMock = signalAware(async () => okRes('x'));
    fetchMock.mockResolvedValueOnce(errRes(500)).mockResolvedValueOnce(errRes(502));
    (global as any).fetch = fetchMock;
    await expect(service.chat('s', 'u')).resolves.toBe('x');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('400 不重试，抛含状态码的错误', async () => {
    fetchMock.mockResolvedValueOnce(errRes(400));
    await expect(service.chat('s', 'u')).rejects.toThrow('DeepSeek LLM request failed: 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('chatJson 解析失败不重试', async () => {
    fetchMock.mockResolvedValue(okRes('不是 JSON'));
    await expect(service.chatJson('s', 'u')).rejects.toThrow('无法解析为 JSON');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('chatJson 成功时走 response_format json_object', async () => {
    fetchMock.mockResolvedValueOnce(okRes('{"a":1}'));
    await expect(service.chatJson<{ a: number }>('s', 'u')).resolves.toEqual({ a: 1 });
    expect(lastBody().response_format).toEqual({ type: 'json_object' });
  });

  it('调用方 abort 不重试，直接拒绝（甚至不发请求）', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(service.chat('s', 'u', 0.3, ac.signal)).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('retries: 0 时 429 只尝试一次', async () => {
    fetchMock.mockResolvedValueOnce(errRes(429));
    await expect(
      service.chat('s', 'u', 0.3, undefined, undefined, { retries: 0 }),
    ).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络错误可重试', async () => {
    fetchMock = signalAware(async () => okRes('recovered'));
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    (global as any).fetch = fetchMock;
    await expect(service.chat('s', 'u')).resolves.toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('超时重试耗尽后抛 timed out', async () => {
    fetchMock = jest.fn(
      (url: any, init: any) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    );
    (global as any).fetch = fetchMock;
    await expect(
      service.chat('s', 'u', 0.3, undefined, undefined, { timeoutMs: 10, retries: 1 }),
    ).rejects.toThrow(/timed out/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('chatMessages 透传多轮 messages，默认 max_tokens=8192', async () => {
    fetchMock.mockResolvedValueOnce(okRes('hi'));
    const messages = [
      { role: 'system', content: 's1' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ] as any;
    await expect(
      service.chatMessages(messages, { model: 'deepseek-chat' }),
    ).resolves.toBe('hi');
    const body = lastBody();
    expect(body.messages).toHaveLength(4);
    expect(body.model).toBe('deepseek-chat');
    expect(body.max_tokens).toBe(8192);
  });

  it('未配置 key：getModel() 为 null，chat 抛 not configured', async () => {
    const noKey = await makeService({ DEEPSEEK_API_KEY: '' });
    expect(noKey.getModel()).toBeNull();
    await expect(noKey.chat('s', 'u')).rejects.toThrow('not configured');
  });
});

describe('LlmSemaphore', () => {
  it('并发封顶：4 个任务、上限 2 → 同时在飞 ≤ 2', async () => {
    const service = await makeService({ LLM_MAX_CONCURRENCY: '2' });
    let inFlight = 0;
    let maxInFlight = 0;
    (global as any).fetch = signalAware(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return okRes('ok');
    });
    const results = await Promise.all([1, 2, 3, 4].map(() => service.chat('s', 'u')));
    expect(results).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('出错必释放，后续调用不死锁', async () => {
    const service = await makeService({ LLM_MAX_CONCURRENCY: '2' });
    const fetchMock = signalAware(async () => okRes('ok'));
    fetchMock.mockResolvedValueOnce(errRes(400)).mockResolvedValueOnce(errRes(400));
    (global as any).fetch = fetchMock;
    await expect(service.chat('s', 'u')).rejects.toThrow(/400/);
    await expect(service.chat('s', 'u')).rejects.toThrow(/400/);
    await expect(service.chat('s', 'u')).resolves.toBe('ok');
  });

  it('排队中 abort：拒绝且不占槽位', async () => {
    const service = await makeService({ LLM_MAX_CONCURRENCY: '1' });
    let resolveFirst: (v: any) => void = () => undefined;
    const fetchMock = jest.fn(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        }),
    );
    (global as any).fetch = fetchMock;

    const p1 = service.chat('s', 'u'); // 占住唯一槽位
    await new Promise((r) => setImmediate(r));

    const ac = new AbortController();
    const p2 = service.chat('s', 'u', 0.3, ac.signal); // 排队
    await new Promise((r) => setImmediate(r));
    ac.abort();
    await expect(p2).rejects.toBeTruthy();

    resolveFirst(okRes('first'));
    await expect(p1).resolves.toBe('first');
    expect(fetchMock).toHaveBeenCalledTimes(1); // p2 从未执行
  });
});
