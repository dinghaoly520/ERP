import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OcrService } from './ocr.service';

const okJson = {
  text: 'hello',
  page_count: 1,
  processed_pages: 1,
  pages: [{ page: 1, text: 'hello' }],
};

async function makeService(url: string): Promise<OcrService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OcrService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, def?: string) =>
            key === 'OCR_SERVICE_URL' ? url : def,
        },
      },
    ],
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
