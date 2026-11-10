import { Test, TestingModule } from '@nestjs/testing';
import { Provider, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrService } from './ocr.service';

const okJson = {
  text: 'hello',
  page_count: 1,
  processed_pages: 1,
  pages: [{ page: 1, text: 'hello' }],
};

async function makeService(
  url: string,
  redis?: unknown,
  env: Record<string, string> = {},
): Promise<OcrService> {
  const providers: Provider[] = [
    OcrService,
    {
      provide: ConfigService,
      useValue: {
        get: (key: string, def?: string) =>
          key === 'OCR_SERVICE_URL' ? url : (env[key] ?? def),
      },
    },
  ];
  if (redis) {
    providers.push({ provide: 'REDIS_CLIENT', useValue: redis });
  }
  const module: TestingModule = await Test.createTestingModule({
    providers,
  }).compile();
  return module.get(OcrService);
}

describe('OcrService 多副本 round-robin', () => {
  it('逗号列表：连续请求在副本间交替', async () => {
    const svc = await makeService('http://a:8100, http://b:8101');
    const hosts: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      hosts.push(new URL(url).host);
      return { ok: true, json: async () => okJson, text: async () => JSON.stringify(okJson) };
    });
    for (let i = 0; i < 4; i++) {
      await svc.ocrImage(Buffer.from('x'), 'image/png', 'x.png');
    }
    expect(hosts).toEqual(['a:8100', 'b:8101', 'a:8100', 'b:8101']);
  });

  it('单 URL：行为与改造前一致（全部打同一地址）', async () => {
    const svc = await makeService('http://a:8100');
    const hosts: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      hosts.push(new URL(url).host);
      return { ok: true, json: async () => okJson, text: async () => JSON.stringify(okJson) };
    });
    for (let i = 0; i < 3; i++) {
      await svc.ocrImage(Buffer.from('x'), 'image/png', 'x.png');
    }
    expect(hosts).toEqual(['a:8100', 'a:8100', 'a:8100']);
  });

  it('尾斜杠规范化 + 空值回退默认', async () => {
    const svc = await makeService('http://a:8100/ , ');
    const hosts: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      hosts.push(new URL(url).host);
      return { ok: true, json: async () => okJson, text: async () => JSON.stringify(okJson) };
    });
    await svc.ocrImage(Buffer.from('x'), 'image/png', 'x.png');
    expect(hosts).toEqual(['a:8100']); // 无 //ocr 双斜杠
  });

  it('isAvailable：首个副本不可达，第二个健康 → true', async () => {
    const svc = await makeService('http://a:8100,http://b:8101');
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.startsWith('http://a:8100')) throw new Error('ECONNREFUSED');
      return { ok: true };
    });
    await expect(svc.isAvailable()).resolves.toBe(true);
  });

  it('isAvailable：全部副本不可达 → false', async () => {
    const svc = await makeService('http://a:8100,http://b:8101');
    (global as any).fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(svc.isAvailable()).resolves.toBe(false);
  });
});

type FetchRecord = { url: string; form: Record<string, string | null> };

/** 从 fetch init.body 提取表单字段（探测/批量断言用） */
function formOf(init: any): Record<string, string | null> {
  const fd = init?.body as FormData;
  const out: Record<string, string | null> = {};
  if (fd && typeof fd.get === 'function') {
    for (const key of ['dpi', 'max_pages', 'page_range']) {
      const v = fd.get(key);
      out[key] = v == null ? null : String(v);
    }
  }
  return out;
}

/** mock fetch：max_pages=0 探测调用返回 100 页；批量调用按 page_range 生成页 */
function mockRecordingFetch(records: FetchRecord[], totalPages = 100) {
  return jest.fn(async (url: string, init: any) => {
    const form = formOf(init);
    records.push({ url, form });
    let payload: any;
    if (form.max_pages === '0') {
      payload = { text: '', page_count: totalPages, processed_pages: 0, pages: [] };
    } else {
      const [s, e] = (form.page_range ?? '1-1').split('-').map(Number);
      const pages = Array.from({ length: e - s + 1 }, (_, i) => ({
        page: i + 1,
        text: `p${s + i}`,
      }));
      payload = {
        text: pages.map((p) => p.text).join('\n\n'),
        page_count: totalPages,
        processed_pages: pages.length,
        pages,
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  });
}

describe('消费端瘦身后契约：恒定批次 + 不发 dpi + 页数探测零 OCR', () => {
  it('100 页文件默认按 40 分批（3 批 + 1 次零 OCR 探测），无 env 可调', async () => {
    const svc = await makeService('http://a:8100');
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    const big = Buffer.alloc(21 * 1024 * 1024); // >20MB 触发分批路径
    await svc.ocrPdf(big);

    expect(records).toHaveLength(4);
    const batches = records.slice(1).map((r) => r.form.page_range);
    expect(batches).toEqual(['1-40', '41-80', '81-100']);
  });

  it('onProgress：页数探测后先报总数 (0,100)，每批完成累加 (40/80/100,100)', async () => {
    const svc = await makeService('http://a:8100');
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    const big = Buffer.alloc(21 * 1024 * 1024);
    const events: Array<[number, number]> = [];
    const r = await svc.ocrPdf(big, 0, (p, t) => events.push([p, t]));

    expect(r.processedPages).toBe(100);
    // 末次 (100,100) 为 ocrPdf 出口的无条件终值补报（2026-11-10：缓存命中路径行上页数
    // 不再 0/?）——compute 路径与末批上报同值幂等重复，契约=「终值保证至少上报一次」
    expect(events).toEqual([[0, 100], [40, 100], [80, 100], [100, 100], [100, 100]]);
  });

  it('页数探测调用零 OCR：max_pages=0 且无 page_range、无 dpi 字段', async () => {
    const svc = await makeService('http://a:8100');
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    const big = Buffer.alloc(21 * 1024 * 1024);
    await svc.ocrPdf(big);

    expect(records[0].form.max_pages).toBe('0');
    expect(records[0].form.page_range).toBeNull();
    expect(records[0].form.dpi).toBeNull();
  });

  it('默认不截断：800 页文件按 40 分 20 批全量处理，末批 761-800', async () => {
    const svc = await makeService('http://a:8100');
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records, 800);

    const big = Buffer.alloc(21 * 1024 * 1024);
    const r = await svc.ocrPdf(big);

    expect(records).toHaveLength(21); // 1 探测 + 20 批
    expect(records[1].form.page_range).toBe('1-40');
    expect(records[20].form.page_range).toBe('761-800');
    expect(r.processedPages).toBe(800);
  });

  it('dpi 完全交由服务端：所有请求不带 dpi 字段', async () => {
    const svc = await makeService('http://a:8100');
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    await svc.ocrPdf(Buffer.from('x'));

    expect(records).toHaveLength(1);
    expect(records[0].form.dpi).toBeNull();
  });
});

/** Redis mock：内部 Map 模拟 get/set 往返，可注入故障 */
function makeRedisMock(
  overrides: { get?: unknown; set?: unknown } = {},
): any {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    ...overrides,
  };
}

describe('消费端 OCR env 旋钮（2026-11-06 推翻零配置面裁定）', () => {
  it('OCR_BATCH_PAGES=20：批界按 20 切', async () => {
    const svc = await makeService('http://a:8100', undefined, { OCR_BATCH_PAGES: '20' });
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);
    await svc.ocrPdf(Buffer.alloc(21 * 1024 * 1024));
    expect(records[1].form.page_range).toBe('1-20');
    expect(records[1].form.max_pages).toBe('20');
  });

  it('OCR_CACHE_TTL_SECONDS=3600：redis.set 以 EX 3600 落盘', async () => {
    const redis = makeRedisMock();
    const svc = await makeService('http://a:8100', redis, { OCR_CACHE_TTL_SECONDS: '3600' });
    (global as any).fetch = mockRecordingFetch([]);
    await svc.ocrPdf(Buffer.from('x'));
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 3600);
  });

  it('非法值回落默认（OCR_BATCH_PAGES=abc → 40）', async () => {
    const svc = await makeService('http://a:8100', undefined, { OCR_BATCH_PAGES: 'abc' });
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);
    await svc.ocrPdf(Buffer.alloc(21 * 1024 * 1024));
    expect(records[1].form.page_range).toBe('1-40');
  });
});

describe('OCR 结果缓存', () => {
  it('相同参数二次调用命中缓存：fetch 仅 1 次，结果一致', async () => {
    const redis = makeRedisMock();
    const svc = await makeService('http://a:8100', redis);
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    const r1 = await svc.ocrPdf(Buffer.from('same-file'));
    const r2 = await svc.ocrPdf(Buffer.from('same-file'));

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(r2.text).toBe(r1.text);
    expect(r2.processedPages).toBe(r1.processedPages);
  });

  it('maxPages 不同 → 键不同 → 两次 fetch', async () => {
    const redis = makeRedisMock();
    const svc = await makeService('http://a:8100', redis);
    (global as any).fetch = mockRecordingFetch([]);

    await svc.ocrPdf(Buffer.from('same-file'));
    await svc.ocrPdf(Buffer.from('same-file'), 50);

    expect((global as any).fetch).toHaveBeenCalledTimes(2);
  });

  it('Redis get/set 双双抛异常 → 不崩、照常 fetch', async () => {
    const redis = makeRedisMock({
      get: jest.fn().mockRejectedValue(new Error('redis down')),
      set: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    const svc = await makeService('http://a:8100', redis);
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    const r = await svc.ocrPdf(Buffer.from('x'));

    expect(records).toHaveLength(1);
    expect(r.processedPages).toBe(1);
  });
});

describe('探测重试与非 JSON 归一', () => {
  it('M5: 页数探测失败两次后成功 → 重试拿页数（3 次 fetch）', async () => {
    const svc = await makeService('http://a:8100');
    let n = 0;
    (global as any).fetch = jest.fn(async () => {
      n += 1;
      if (n <= 2) throw new Error('ECONNREFUSED');
      const payload = { text: '', page_count: 42, processed_pages: 0, pages: [] };
      return {
        ok: true,
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      };
    });

    const count = await (svc as any).getPdfPageCount(Buffer.from('x'));

    expect(count).toBe(42);
    expect((global as any).fetch).toHaveBeenCalledTimes(3);
  });

  it('M5: 200 但非 JSON → ServiceUnavailableException（非裸 SyntaxError）', async () => {
    const svc = await makeService('http://a:8100');
    (global as any).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '<html>proxy error page</html>',
    }));

    await expect(
      svc.ocrImage(Buffer.from('x'), 'image/png', 'x.png'),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('批次级缓存与并发合并（2026-11-06 知识库 5 份重复实录）', () => {
  it('串行场景：第二次同文件分批 → 全部批次命中缓存，零 fetch', async () => {
    const redis = makeRedisMock();
    const svc = await makeService('http://a:8100', redis);
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    const big = Buffer.alloc(21 * 1024 * 1024);
    await svc.ocrPdf(big); // 第一次：探测+3 批，全部落缓存
    const fetchedAfterFirst = (global as any).fetch.mock.calls.length;
    await svc.ocrPdf(big); // 第二次：整体入口缓存命中（不 fetch）

    expect((global as any).fetch.mock.calls.length).toBe(fetchedAfterFirst);
  });

  it('并发场景：5 个同文件同时分批 → 每批次底层只算一次（in-flight 合并）', async () => {
    const redis = makeRedisMock();
    const svc = await makeService('http://a:8100', redis);
    const records: FetchRecord[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      const form = formOf(init);
      records.push({ url, form });
      if (form.max_pages === '0') {
        return { ok: true, text: async () => JSON.stringify({ text: '', page_count: 100, processed_pages: 0, pages: [] }), json: async () => ({ text: '', page_count: 100, processed_pages: 0, pages: [] }) };
      }
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 150)); // 模拟 OCR 耗时，制造并发窗口
      inFlight -= 1;
      const [s, e] = (form.page_range ?? '1-1').split('-').map(Number);
      const pages = Array.from({ length: e - s + 1 }, (_, i) => ({ page: i + 1, text: `p${s + i}` }));
      const payload = { text: pages.map((p) => p.text).join('\n\n'), page_count: 100, processed_pages: pages.length, pages };
      return { ok: true, text: async () => JSON.stringify(payload), json: async () => payload };
    });

    const big = Buffer.alloc(21 * 1024 * 1024);
    const results = await Promise.all([
      svc.ocrPdf(big), svc.ocrPdf(big), svc.ocrPdf(big), svc.ocrPdf(big), svc.ocrPdf(big),
    ]);

    // 5 份结果一致
    expect(new Set(results.map((r) => r.text)).size).toBe(1);
    // fetch 计数：1 次探测合并 + 3 批各合并一次 = 4（无合并时 = 5×(1+3)=20）
    expect((global as any).fetch.mock.calls.length).toBe(4);
    expect(maxInFlight).toBe(1); // 计算流唯一：批次串行、无重复并发
  });
});

describe('onProgress 协作式取消（2026-11-09 删除解析中文件实录）', () => {
  it('异步 onProgress 抛错 → 批循环立即中止，后续批次不再发起', async () => {
    const svc = await makeService('http://a:8100');
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);
    const err = new Error('文件已删除，解析中止');
    // 现状（未 await 回调）下拒绝是 unhandled——抑制防进程崩，让断言正常说话
    const swallowed: unknown[] = [];
    const onUnhandled = (e: unknown) => swallowed.push(e);
    process.on('unhandledRejection', onUnhandled);

    await expect(
      svc.ocrPdf(Buffer.alloc(21 * 1024 * 1024), 200, async (processed: number) => {
        if (processed > 0) throw err; // 批 1 完成后的进度回调取消（0 页起始调用放行）
      }),
    ).rejects.toThrow('文件已删除，解析中止');

    process.off('unhandledRejection', onUnhandled);

    // 探测 1 + 批次 1（被取消，批 2/3 不得发起）
    const batches = records.filter((r) => r.form.page_range).length;
    expect(batches).toBe(1);
    expect(swallowed).toHaveLength(0); // 修复后回调被 await，无 unhandled 拒绝
  });
});

describe('缓存命中补进度上报（2026-11-10：行上页数不再 0/?）', () => {
  it('整文件缓存命中（零 fetch）时 onProgress 仍收到终值 (pages, pageCount)', async () => {
    const redis = makeRedisMock();
    const svc = await makeService('http://a:8100', redis);
    (global as any).fetch = mockRecordingFetch([]);

    const big = Buffer.alloc(21 * 1024 * 1024);
    await svc.ocrPdf(big); // 首算落缓存（mock 100 页 3 批）

    const progress: Array<[number, number]> = [];
    (global as any).fetch = jest.fn(); // 二次调用若误发请求会露馅
    const r = await svc.ocrPdf(big, 200, (p, t) => progress.push([p, t]));

    expect((global as any).fetch).not.toHaveBeenCalled(); // 批次键全命中
    expect(r.processedPages).toBe(100);
    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1];
    expect(last).toEqual([100, 100]);
  });

  it('整文件键命中（同参重传）时也补报终值——修复前该路径 onProgress 零调用', async () => {
    const redis = makeRedisMock();
    const svc = await makeService('http://a:8100', redis);
    (global as any).fetch = mockRecordingFetch([]);
    const big = Buffer.alloc(21 * 1024 * 1024);
    await svc.ocrPdf(big); // 默认 maxPages 落整文件键

    const progress: Array<[number, number]> = [];
    (global as any).fetch = jest.fn();
    await svc.ocrPdf(big, undefined, (p, t) => progress.push([p, t]));

    expect((global as any).fetch).not.toHaveBeenCalled(); // 整文件键直接命中
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toEqual([100, 100]);
  });
});
