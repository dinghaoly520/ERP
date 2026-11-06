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
): Promise<OcrService> {
  const providers: Provider[] = [
    OcrService,
    {
      provide: ConfigService,
      useValue: {
        get: (key: string, def?: string) =>
          key === 'OCR_SERVICE_URL' ? url : def,
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
    expect(events).toEqual([[0, 100], [40, 100], [80, 100], [100, 100]]);
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
