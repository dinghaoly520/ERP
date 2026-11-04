import { Test, TestingModule } from '@nestjs/testing';
import { Provider } from '@nestjs/common';
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
  env: Record<string, string> = {},
  redis?: unknown,
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
      return { ok: true, json: async () => okJson, text: async () => '' };
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
      return { ok: true, json: async () => okJson, text: async () => '' };
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
      return { ok: true, json: async () => okJson, text: async () => '' };
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
function mockRecordingFetch(records: FetchRecord[]) {
  return jest.fn(async (url: string, init: any) => {
    const form = formOf(init);
    records.push({ url, form });
    if (form.max_pages === '0') {
      return {
        ok: true,
        text: async () => '',
        json: async () => ({
          text: '',
          page_count: 100,
          processed_pages: 0,
          pages: [],
        }),
      };
    }
    const [s, e] = (form.page_range ?? '1-1').split('-').map(Number);
    const pages = Array.from({ length: e - s + 1 }, (_, i) => ({
      page: i + 1,
      text: `p${s + i}`,
    }));
    return {
      ok: true,
      text: async () => '',
      json: async () => ({
        text: pages.map((p) => p.text).join('\n\n'),
        page_count: 100,
        processed_pages: pages.length,
        pages,
      }),
    };
  });
}

describe('OCR_BATCH_PAGES / OCR_DPI env 化 + 页数探测零 OCR', () => {
  it('OCR_BATCH_PAGES=20：100 页文件分 5 批（+1 次零 OCR 探测），批界按 20 切', async () => {
    const svc = await makeService('http://a:8100', { OCR_BATCH_PAGES: '20' });
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    const big = Buffer.alloc(21 * 1024 * 1024); // >20MB 触发分批路径
    const result = await svc.ocrPdf(big);

    expect(records).toHaveLength(6);
    expect(records[0].form.max_pages).toBe('0'); // 探测零 OCR
    expect(records[0].form.page_range).toBeNull();
    const batches = records.slice(1).map((r) => r.form.page_range);
    expect(batches).toEqual(['1-20', '21-40', '41-60', '61-80', '81-100']);
    for (const r of records.slice(1)) {
      expect(r.form.max_pages).toBe('20');
    }
    expect(result.processedPages).toBe(100);
  });

  it('省略 dpi 走 OCR_DPI 默认：表单 dpi 字段=env 值', async () => {
    const svc = await makeService('http://a:8100', { OCR_DPI: '200' });
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    await svc.ocrPdf(Buffer.from('x'));

    expect(records).toHaveLength(1);
    expect(records[0].form.dpi).toBe('200');
  });

  it('显式 dpi 覆盖 env 默认', async () => {
    const svc = await makeService('http://a:8100', { OCR_DPI: '200' });
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    await svc.ocrPdf(Buffer.from('x'), 200, 120);

    expect(records[0].form.dpi).toBe('120');
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
    const svc = await makeService('http://a:8100', {}, redis);
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    const r1 = await svc.ocrPdf(Buffer.from('same-file'));
    const r2 = await svc.ocrPdf(Buffer.from('same-file'));

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(r2.text).toBe(r1.text);
    expect(r2.processedPages).toBe(r1.processedPages);
  });

  it('dpi 不同 → 键不同 → 两次 fetch', async () => {
    const redis = makeRedisMock();
    const svc = await makeService('http://a:8100', {}, redis);
    (global as any).fetch = mockRecordingFetch([]);

    await svc.ocrPdf(Buffer.from('same-file'));
    await svc.ocrPdf(Buffer.from('same-file'), 200, 120);

    expect((global as any).fetch).toHaveBeenCalledTimes(2);
  });

  it('Redis get/set 双双抛异常 → 不崩、照常 fetch', async () => {
    const redis = makeRedisMock({
      get: jest.fn().mockRejectedValue(new Error('redis down')),
      set: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    const svc = await makeService('http://a:8100', {}, redis);
    const records: FetchRecord[] = [];
    (global as any).fetch = mockRecordingFetch(records);

    const r = await svc.ocrPdf(Buffer.from('x'));

    expect(records).toHaveLength(1);
    expect(r.processedPages).toBe(1);
  });

  it('OCR_CACHE_ENABLED=false → 不读不写缓存', async () => {
    const redis = makeRedisMock();
    const svc = await makeService(
      'http://a:8100',
      { OCR_CACHE_ENABLED: 'false' },
      redis,
    );
    (global as any).fetch = mockRecordingFetch([]);

    await svc.ocrPdf(Buffer.from('x'));

    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });
});
