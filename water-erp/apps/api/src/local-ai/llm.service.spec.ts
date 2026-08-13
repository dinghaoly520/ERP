import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import * as https from 'https';
import { LlmService } from './llm.service';

/* =====================================================================
   https mock 基础设施：LlmService 经 node:https 直连 DeepSeek
   （不用 global.fetch——那批 mock 对原生 https.request 完全失效）。
   假 ClientRequest 是 EventEmitter：实现方挂 error/timeout 监听，
   end() 时经 responder 决定响应/挂起/网络错误。
   ===================================================================== */

/** 响应规格：content 包进 DeepSeek choices 结构 */
interface ResponseSpec {
  status?: number;
  content?: string;
  rawBody?: string;
  retryAfter?: string;
}

const okRes = (content: string): ResponseSpec => ({ status: 200, content });
const errRes = (status: number, retryAfter?: string): ResponseSpec => ({
  status,
  rawBody: 'error body',
  retryAfter,
});

/** 哨兵：挂起（超时/手动响应测试）与网络层失败 */
const HANG = Symbol('hang');
const NETWORK_ERROR = Symbol('network-error');

interface CapturedRequest {
  opts: any;
  payload: any;
  req: any;
}

const origHttpsRequest = https.request;

class HttpsMock {
  request = jest.fn();
  calls: CapturedRequest[] = [];

  constructor(
    private responder: (
      callIndex: number,
      payload: any,
      req: any,
    ) => ResponseSpec | symbol | undefined,
  ) {
    this.request.mockImplementation((opts: any, cb: (res: any) => void) => {
      const req = new EventEmitter() as any;
      req.write = jest.fn();
      req.end = jest.fn(() => {
        const payload = JSON.parse(req.write.mock.calls[0][0]);
        const spec = this.responder(this.calls.length, payload, req);
        this.calls.push({ opts, payload, req });
        if (spec === NETWORK_ERROR) req.emit('error', new TypeError('fetch failed'));
        else if (spec !== HANG && spec !== undefined) this.deliver(req, cb, spec as ResponseSpec);
      });
      req.destroy = jest.fn();
      req.respond = (spec: ResponseSpec) => this.deliver(req, cb, spec);
      return req;
    });
    (https as any).request = this.request;
  }

  private deliver(req: any, cb: (res: any) => void, spec: ResponseSpec) {
    const raw =
      spec.rawBody ??
      JSON.stringify({ choices: [{ message: { content: spec.content ?? '' } }] });
    const res = new EventEmitter() as any;
    res.statusCode = spec.status ?? 200;
    res.headers = spec.retryAfter ? { 'retry-after': spec.retryAfter } : {};
    cb(res); // 实现方在 cb 内同步挂 data/end 监听
    res.emit('data', Buffer.from(raw));
    res.emit('end');
  }
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
  let httpsMock: HttpsMock;

  beforeEach(async () => {
    service = await makeService();
    httpsMock = new HttpsMock(() => okRes('hello'));
  });

  afterEach(() => {
    (https as any).request = origHttpsRequest;
  });

  const lastPayload = () => httpsMock.calls[httpsMock.calls.length - 1].payload;

  it('chat 成功返回 content，默认 model/max_tokens 来自 env', async () => {
    await expect(service.chat('sys', 'usr')).resolves.toBe('hello');
    expect(httpsMock.request).toHaveBeenCalledTimes(1);
    const body = lastPayload();
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
    const body = lastPayload();
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.max_tokens).toBe(420);
  });

  it('429 → 200：重试一次后成功', async () => {
    httpsMock = new HttpsMock((i) => (i === 0 ? errRes(429, '0') : okRes('x')));
    await expect(service.chat('s', 'u')).resolves.toBe('x');
    expect(httpsMock.request).toHaveBeenCalledTimes(2);
  });

  it('500 → 502 → 200：两次重试后成功', async () => {
    httpsMock = new HttpsMock((i) => (i === 0 ? errRes(500) : i === 1 ? errRes(502) : okRes('x')));
    await expect(service.chat('s', 'u')).resolves.toBe('x');
    expect(httpsMock.request).toHaveBeenCalledTimes(3);
  });

  it('400 不重试，抛含状态码的错误', async () => {
    httpsMock = new HttpsMock(() => errRes(400));
    await expect(service.chat('s', 'u')).rejects.toThrow('DeepSeek LLM request failed: 400');
    expect(httpsMock.request).toHaveBeenCalledTimes(1);
  });

  it('chatJson 解析失败不重试', async () => {
    httpsMock = new HttpsMock(() => okRes('不是 JSON'));
    await expect(service.chatJson('s', 'u')).rejects.toThrow('无法解析为 JSON');
    expect(httpsMock.request).toHaveBeenCalledTimes(1);
  });

  it('chatJson 成功时走 response_format json_object', async () => {
    httpsMock = new HttpsMock(() => okRes('{"a":1}'));
    await expect(service.chatJson<{ a: number }>('s', 'u')).resolves.toEqual({ a: 1 });
    expect(lastPayload().response_format).toEqual({ type: 'json_object' });
  });

  it('调用方 abort 不重试，直接拒绝（甚至不发请求）', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(service.chat('s', 'u', 0.3, ac.signal)).rejects.toBeTruthy();
    expect(httpsMock.request).toHaveBeenCalledTimes(0);
  });

  it('retries: 0 时 429 只尝试一次', async () => {
    httpsMock = new HttpsMock(() => errRes(429));
    await expect(
      service.chat('s', 'u', 0.3, undefined, undefined, { retries: 0 }),
    ).rejects.toThrow(/429/);
    expect(httpsMock.request).toHaveBeenCalledTimes(1);
  });

  it('网络错误可重试', async () => {
    httpsMock = new HttpsMock((i) => (i === 0 ? NETWORK_ERROR : okRes('recovered')));
    await expect(service.chat('s', 'u')).resolves.toBe('recovered');
    expect(httpsMock.request).toHaveBeenCalledTimes(2);
  });

  it('超时重试耗尽后抛 timed out', async () => {
    httpsMock = new HttpsMock(() => HANG);
    await expect(
      service.chat('s', 'u', 0.3, undefined, undefined, { timeoutMs: 10, retries: 1 }),
    ).rejects.toThrow(/timed out/);
    expect(httpsMock.request).toHaveBeenCalledTimes(2);
  });

  it('chatMessages 透传多轮 messages，默认 max_tokens=8192', async () => {
    httpsMock = new HttpsMock(() => okRes('hi'));
    const messages = [
      { role: 'system', content: 's1' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ] as any;
    await expect(
      service.chatMessages(messages, { model: 'deepseek-chat' }),
    ).resolves.toBe('hi');
    const body = lastPayload();
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
  let httpsMock: HttpsMock;

  afterEach(() => {
    (https as any).request = origHttpsRequest;
  });

  it('并发封顶：4 个任务、上限 2 → 同时在飞 ≤ 2', async () => {
    const service = await makeService({ LLM_MAX_CONCURRENCY: '2' });
    let inFlight = 0;
    let maxInFlight = 0;
    httpsMock = new HttpsMock((_i, _payload, req) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => {
        inFlight--;
        req.respond(okRes('ok'));
      }, 20);
      return HANG;
    });
    const results = await Promise.all([1, 2, 3, 4].map(() => service.chat('s', 'u')));
    expect(results).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('出错必释放，后续调用不死锁', async () => {
    const service = await makeService({ LLM_MAX_CONCURRENCY: '2' });
    httpsMock = new HttpsMock((i) => (i < 2 ? errRes(400) : okRes('ok')));
    await expect(service.chat('s', 'u')).rejects.toThrow(/400/);
    await expect(service.chat('s', 'u')).rejects.toThrow(/400/);
    await expect(service.chat('s', 'u')).resolves.toBe('ok');
  });

  it('排队中 abort：拒绝且不占槽位', async () => {
    const service = await makeService({ LLM_MAX_CONCURRENCY: '1' });
    httpsMock = new HttpsMock(() => HANG);

    const p1 = service.chat('s', 'u'); // 占住唯一槽位
    await new Promise((r) => setImmediate(r));

    const ac = new AbortController();
    const p2 = service.chat('s', 'u', 0.3, ac.signal); // 排队
    await new Promise((r) => setImmediate(r));
    ac.abort();
    await expect(p2).rejects.toBeTruthy();

    httpsMock.calls[0].req.respond(okRes('first'));
    await expect(p1).resolves.toBe('first');
    expect(httpsMock.request).toHaveBeenCalledTimes(1); // p2 从未执行
  });
});
