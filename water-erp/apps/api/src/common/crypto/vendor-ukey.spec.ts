/* VendorUKeyAdapter HTTP 协议适配测试:node:http 随机端口桩服务,baseUrl 注入(不碰 17999) */
import * as http from 'http';
import { AddressInfo } from 'net';
import { VendorUKeyAdapter } from '@water-erp/ukey';

/* 桩:mode 由各用例切换;模拟中间件的响应形状与错误码 */
let mode: 'ok' | 'wrongPin' | 'lockedPin' | 'opError' | 'unreachable' = 'ok';

const stub = http.createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health' && req.method === 'GET') {
    if (mode === 'unreachable') return send(500, { ok: false });
    return send(200, { ok: true, version: '1.0.0', shields: 2, unlocked: 1 });
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    if (req.url === '/certs') {
      return send(200, { certs: [{ certSn: 'SHD-AAAABBBB', certDn: 'CN=甲公司', publicKey: '04' + 'a'.repeat(128), alg: 'SM2', shieldId: 'SHD-AAAABBBB' }] });
    }
    if (req.url === '/session/unlock') {
      if (mode === 'wrongPin') return send(200, { ok: true, unlocked: [], failed: [{ shieldId: 'SHD-X', retryLeft: 2 }] });
      if (mode === 'lockedPin') return send(200, { ok: true, unlocked: [], failed: [{ shieldId: 'SHD-X', retryLeft: 0, locked: true }] });
      return send(200, { ok: true, unlocked: ['SHD-AAAABBBB'], failed: [] });
    }
    if (req.url === '/sign') {
      if (mode === 'opError') return send(403, { error: 'x', code: 'PIN_REQUIRED' });
      return send(200, { sig: 'sig-hex-fixture' });
    }
    if (req.url === '/sm2/decrypt') {
      if (mode === 'opError') return send(422, { error: 'x', code: 'DECRYPT_FAILED' });
      return send(200, { plain: 'ab'.repeat(24) });
    }
    send(404, {});
  });
});

let base = '';
beforeAll(async () => {
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
});
beforeEach(() => { mode = 'ok'; });

describe('VendorUKeyAdapter', () => {
  it('probe:中间件在线 → 计数;离线/非 200 → null', async () => {
    expect(await VendorUKeyAdapter.probe(500, base)).toEqual({ shields: 2, unlocked: 1 });
    mode = 'unreachable';
    expect(await VendorUKeyAdapter.probe(500, base)).toBeNull();
    expect(await VendorUKeyAdapter.probe(200, 'http://127.0.0.1:9')).toBeNull(); // 无人监听端口
  });

  it('open:成功返回实例;错 PIN 抛含剩余次数;锁死抛锁定文案', async () => {
    const uk = await VendorUKeyAdapter.open({ password: '123456', baseUrl: base });
    expect(uk.name).toBe('vendor-ukey');
    mode = 'wrongPin';
    await expect(VendorUKeyAdapter.open({ password: '0', baseUrl: base })).rejects.toThrow('剩余尝试次数 2');
    mode = 'lockedPin';
    await expect(VendorUKeyAdapter.open({ password: '0', baseUrl: base })).rejects.toThrow('已锁定');
  });

  it('listCertificates:透传并剥 shieldId', async () => {
    const certs = await (await VendorUKeyAdapter.open({ password: '1', baseUrl: base })).listCertificates();
    expect(certs).toEqual([{ certSn: 'SHD-AAAABBBB', certDn: 'CN=甲公司', publicKey: '04' + 'a'.repeat(128), alg: 'SM2' }]);
  });

  it('sign/decrypt:结果透传;错误码转中文 Error', async () => {
    const uk = await VendorUKeyAdapter.open({ password: '1', baseUrl: base });
    expect(await uk.sign('SHD-AAAABBBB', 'msg')).toBe('sig-hex-fixture');
    expect(await uk.decrypt('SHD-AAAABBBB', 'cipher')).toBe('ab'.repeat(24));
    mode = 'opError';
    await expect(uk.sign('SHD-AAAABBBB', 'msg')).rejects.toThrow('未解锁');
    await expect(uk.decrypt('SHD-AAAABBBB', 'c')).rejects.toThrow('密文损坏');
  });

  it('中间件中途退出:网络/超时异常转译中文(不漏原始 fetch failed)', async () => {
    const tmp = http.createServer((req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/health' && req.method === 'GET') return send(200, { ok: true, version: '1.0.0', shields: 1, unlocked: 0 });
      req.on('data', () => {});
      req.on('end', () => send(200, { ok: true, unlocked: ['SHD-AAAABBBB'], failed: [] }));
    });
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', r));
    const tmpBase = `http://127.0.0.1:${(tmp.address() as AddressInfo).port}`;
    const uk = await VendorUKeyAdapter.open({ password: '123456', baseUrl: tmpBase });
    await new Promise<void>((r) => tmp.close(() => r())); // 模拟驱动服务中途退出
    await expect(uk.sign('SHD-AAAABBBB', 'msg')).rejects.toThrow('U盾中间件连接失败或已退出');
    await expect(uk.decrypt('SHD-AAAABBBB', 'c')).rejects.toThrow('连接失败');
  });
});
