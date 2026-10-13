import { SccaGatewayClient, GwErrorKind } from './scca-gateway.client';

// ─── mock fetch 工具 ───
type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];
let mockResponse: { status: number; body: string } | null = null;
let mockDelay = 0;

beforeEach(() => {
  calls = [];
  mockResponse = null;
  mockDelay = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (mockDelay) {
      const signal = init?.signal;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, mockDelay);
        if (signal) signal.addEventListener('abort', () => {
          clearTimeout(t);
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        }, { once: true });
      });
    }
    const status = mockResponse?.status ?? 200;
    const bodyText = mockResponse?.body ?? '';
    return new Response(bodyText, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

const CLIENT = new SccaGatewayClient({
  baseUrl: 'http://gw.test:9527/signgw-service',
  appId: 'TEST-APPID',
  appSecret: 'test-secret',
  timeoutMs: 2000,
});

const INPUT = {
  opType: '登录签名',
  requestId: 'p0-test-001',
  signedDataB64: 'VGVzdFA3RGF0YQ==', // base64 of "TestP7Data"
  toSign: 'SCCA-P0-V1::plain-ascii-0123456789',
};

describe('SccaGatewayClient（T3 字节等价实现）', () => {
  test('① 请求构造：表单字段/HMAC/headers 与 T3 已证契约一致', async () => {
    mockResponse = { status: 200, body: '{"result_code":0,"result_msg":"OK","body":{"serialNumber":"abc","certBase64":"ZA=="}}' };
    await CLIENT.verifyPkcs7(INPUT);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;

    // URL
    expect(c.url).toBe('http://gw.test:9527/signgw-service/api/signature/verifyPkcs7');

    // Method + headers
    expect(c.init.method).toBe('POST');
    const headers = c.init.headers as Record<string, string>;
    expect(headers['app_id']).toBe('TEST-APPID');
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded; charset=UTF-8');
    expect(headers['signature']).toMatch(/^[0-9a-f]{40}$/); // HMAC-SHA1 小写 hex

    // Body: URL-encoded form, sorted keys, skip empty
    const body = c.init.body as string;
    const params = new URLSearchParams(body);
    expect(params.get('opType')).toBe('登录签名');
    expect(params.get('requestId')).toBe('p0-test-001');
    expect(params.get('signedData')).toBe('VGVzdFA3RGF0YQ==');
    expect(params.get('toSign')).toBe(INPUT.toSign);

    // HMAC verification: sorted keys, skip empty, values joined by &, no URL encoding
    const { createHmac } = require('crypto');
    const plain = ['opType', 'requestId', 'signedData', 'toSign'].sort()
      .map(k => ({ opType: INPUT.opType, requestId: INPUT.requestId, signedData: INPUT.signedDataB64, toSign: INPUT.toSign })[k])
      .filter(v => v != null && v !== '')
      .join('&');
    const expected = createHmac('sha1', Buffer.from('test-secret', 'utf8')).update(plain, 'utf8').digest('hex');
    expect(headers['signature']).toBe(expected);
  });

  test('② 成功响应解析', async () => {
    mockResponse = { status: 200, body: '{"result_code":0,"result_msg":"OK","body":{"serialNumber":"4eb0","certBase64":"MIIB"}}' };
    const r = await CLIENT.verifyPkcs7(INPUT);
    expect(r.resultCode).toBe(0);
    expect(r.certSerialHex).toBe('4eb0');
    expect(r.certBase64).toBe('MIIB');
  });

  test('③ 错误映射：1003→AUTH / 1105→PERMISSION / 9998→CERT_CHAIN / 其他→BUSINESS', async () => {
    for (const [code, kind] of [[1003, 'AUTH'], [1105, 'PERMISSION'], [9998, 'CERT_CHAIN'], [5000, 'BUSINESS']] as [number, GwErrorKind][]) {
      mockResponse = { status: code === 1003 ? 401 : 200, body: `{"result_code":${code},"result_msg":"E"}` };
      const r = await CLIENT.verifyPkcs7(INPUT);
      expect(r.errorKind).toBe(kind);
      expect(r.resultCode).toBe(code);
    }
  });

  test('④ 超时→UNAVAILABLE 且仅调用一次（禁自动重试）', async () => {
    mockDelay = 3000; // > timeoutMs 2000
    const r = await CLIENT.verifyPkcs7(INPUT);
    expect(r.errorKind).toBe('UNAVAILABLE');
    expect(calls).toHaveLength(1); // 无重试
  });

  test('⑤ 空值跳过：signedData 空串→请求体不含该字段', async () => {
    mockResponse = { status: 200, body: '{"result_code":0,"result_msg":"OK","body":null}' };
    await CLIENT.verifyPkcs7({ ...INPUT, signedDataB64: '' });
    const body = calls[0]!.init.body as string;
    expect(body).not.toContain('signedData');
  });

  test('⑥ 网络异常→UNAVAILABLE', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const r = await CLIENT.verifyPkcs7(INPUT);
    expect(r.errorKind).toBe('UNAVAILABLE');
  });
});
