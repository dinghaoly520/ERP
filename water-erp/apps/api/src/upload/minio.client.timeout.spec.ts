/**
 * 共享 minioClient 请求超时兜底（2026-11-20 终审 M3）：
 * 黑洞端点下副本写入/回退读不再无限挂——默认 120s，MINIO_REQUEST_TIMEOUT_MS 可覆盖。
 */
jest.mock('minio', () => {
  const setDefaultTimeout = jest.fn();
  const Client = jest.fn().mockImplementation(() => ({ setDefaultTimeout }));
  return { Client };
});

describe('minio.client 请求超时（M3）', () => {
  it('默认 120_000ms 兜底并挂在单例上', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { minioClient } = require('./minio.client');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Client } = require('minio') as { Client: jest.Mock };
      expect(Client).toHaveBeenCalledTimes(1);
      const instance = Client.mock.results[0].value;
      expect(instance.setDefaultTimeout).toHaveBeenCalledWith(120_000);
      expect(minioClient).toBe(instance);
    });
  });

  it('MINIO_REQUEST_TIMEOUT_MS 显式覆盖生效', () => {
    const prev = process.env.MINIO_REQUEST_TIMEOUT_MS;
    process.env.MINIO_REQUEST_TIMEOUT_MS = '5000';
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('./minio.client');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Client } = require('minio') as { Client: jest.Mock };
        expect(Client.mock.results[0].value.setDefaultTimeout).toHaveBeenCalledWith(5000);
      });
    } finally {
      if (prev === undefined) delete process.env.MINIO_REQUEST_TIMEOUT_MS;
      else process.env.MINIO_REQUEST_TIMEOUT_MS = prev;
    }
  });
});
