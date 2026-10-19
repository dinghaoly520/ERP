/**
 * SccaUKeyAdapter.unwrapKey base64 解码单测（M-1 backlog）
 * 真盾实证（2026-10-14 E2E）：SOF_DecryptData 返回 base64 编码明文——
 * "eyJpdiI6Im…" = b64('{"iv":"')。三态：base64/已解码直通/非法 base64 原样。
 */
import { SccaUKeyAdapter } from './scca-ukey';

// ukey 包无 @types/node——用 btoa/atob 替代 Buffer
const b64Encode = (s: string): string => btoa(unescape(encodeURIComponent(s)));

// 子类注入 mock transport（Adapter 构造器自建 transport，不可直接注入）
class TestAdapter extends SccaUKeyAdapter {
  private readonly mockResponse: { retValue: any; retCode?: number };
  constructor(retValue: any, retCode?: number) {
    super(undefined);
    this.mockResponse = { retValue, retCode };
    // 覆写 transport 为可控 mock
    (this as any).transport = {
      call: async () => this.mockResponse,
    };
  }
}

describe('SccaUKeyAdapter.unwrapKey base64 解码（M-1）', () => {
  test('base64 编码明文 → 解码返回 UTF-8 JSON 字符串', async () => {
    const plaintext = '{"iv":"abc123","k":"deadbeef"}';
    const b64 = b64Encode(plaintext);
    const adapter = new TestAdapter(b64);
    const result = await adapter.unwrapKey('container', 'p7');
    expect(result).toBe(plaintext);
  });

  test('已解码形态（{ 开头）→ 直通不二次解码', async () => {
    const plaintext = '{"iv":"xyz","k":"abc"}';
    const adapter = new TestAdapter(plaintext);
    const result = await adapter.unwrapKey('container', 'p7');
    expect(result).toBe(plaintext);
  });

  test('非法 base64（含中文字符）→ 原样返回（由调用方 JSON.parse 报错暴露）', async () => {
    const raw = '这是一段非base64文本';
    const adapter = new TestAdapter(raw);
    const result = await adapter.unwrapKey('container', 'p7');
    expect(result).toBe(raw);
  });

  test('retValue 空 → 抛 SccaTransportError（密钥解封失败）', async () => {
    const adapter = new TestAdapter(null);
    await expect(adapter.unwrapKey('container', 'p7')).rejects.toThrow(/密钥解封失败/);
  });
});
