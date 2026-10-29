import { OcrService } from './ocr.service';

function mkService(urls: string) {
  return new OcrService({ get: () => urls } as any);
}

describe('OcrService.probeReplicas', () => {
  it('逐副本返回可用性与延迟；失败副本 ok=false', async () => {
    const svc = mkService('http://a:8100,http://b:8100');
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith('http://a')) return { ok: true } as any;
      throw new Error('down');
    });
    const r = await svc.probeReplicas();
    spy.mockRestore();
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ url: 'http://a:8100', ok: true });
    expect(r[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(r[1]).toMatchObject({ url: 'http://b:8100', ok: false });
  });
});
