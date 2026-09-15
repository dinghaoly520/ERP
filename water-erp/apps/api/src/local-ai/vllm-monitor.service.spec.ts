import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { VllmMonitorService } from './vllm-monitor.service';

const modelsResponse = { data: [{ id: 'BAAI/bge-m3' }] };

const originalFetch = global.fetch;

async function makeService(
  env: Record<string, string>,
): Promise<VllmMonitorService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VllmMonitorService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, def?: unknown) => env[key] ?? def,
        },
      },
    ],
  }).compile();
  return module.get(VllmMonitorService);
}

describe('VllmMonitorService 探针鉴权（在线 embedding API 兼容）', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('EMBEDDING_API_KEY 已配置时探针请求带 Authorization 头', async () => {
    const svc = await makeService({
      EMBEDDING_BASE_URL: 'https://api.siliconflow.cn/v1',
      EMBEDDING_MODEL: 'BAAI/bge-m3',
      EMBEDDING_API_KEY: 'sk-test',
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => modelsResponse,
    })) as unknown as typeof fetch;

    await svc.check();

    expect(svc.isEmbeddingAvailable()).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      }),
    );
  });

  it('未配置 key 时探针不带 Authorization 头（本机 vLLM 行为不变）', async () => {
    const svc = await makeService({
      EMBEDDING_BASE_URL: 'http://localhost:8003/v1',
      EMBEDDING_MODEL: 'BAAI/bge-m3',
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => modelsResponse,
    })) as unknown as typeof fetch;

    await svc.check();

    expect(svc.isEmbeddingAvailable()).toBe(true);
    const [, init] = (global.fetch as unknown as jest.Mock).mock.calls[0];
    expect(init.headers ?? {}).not.toHaveProperty('Authorization');
  });
});
