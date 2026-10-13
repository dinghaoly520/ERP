import { SccaTransport, SccaTransportError } from './scca-transport';
import { FakeWS, injectFakeWS } from './scca-fixture';

beforeAll(() => injectFakeWS());
beforeEach(() => FakeWS.reset());

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('SccaTransport（transport v3.2 语义——T1 十断言移植）', () => {
  test('① 超时只关自己的连接（不殃及新连接）', async () => {
    FakeWS.script = [() => { }]; // 第一问不回包
    const t = new SccaTransport(undefined, { op: 500, connect: 2000 });
    const p1 = t.call('SOF_GetVersion', []);
    const r1 = await p1;
    expect(r1.retValue).toBe(''); // 超时返回空
    expect(FakeWS.instances[0]!.readyState).toBe(3); // 旧 socket 已关
  });

  test('② 排队命令不跨连接续发（QUEUE_INVALIDATED）', async () => {
    FakeWS.script = [() => { }];
    const t = new SccaTransport(undefined, { op: 500, connect: 2000 });
    const p1 = t.call('SOF_GetVersion', []);
    const p2 = t.call('SOF_GetUserList', []);
    await p1;
    await expect(p2).rejects.toThrow(/QUEUE_INVALIDATED/);
    expect(FakeWS.instances.every(i => !(i.lastSent ?? '').includes('SOF_GetUserList'))).toBe(true);
  });

  test('③ 连接等待超时', async () => {
    FakeWS.openDelay = 3000; // > 2s connect timeout (test)
    const t = new SccaTransport(undefined, { op: 500, connect: 2000 });
    await expect(t.call('SOF_GetVersion', [])).rejects.toThrow(/超时|CONN_LOST/);
  }, 10000);

  test('④ 打开前关闭立即 reject', async () => {
    FakeWS.closeBeforeOpen = true;
    const t = new SccaTransport(undefined, { op: 500, connect: 2000 });
    await expect(t.call('SOF_GetVersion', [])).rejects.toThrow(/打开前关闭|CONN_LOST/);
  });

  test('⑤ 正常往返（正常回包）', async () => {
    FakeWS.script = [
      (s) => s.emit('message', { data: JSON.stringify({ retValue: '1.3.8.806', retCode: 0 }) }),
    ];
    const t = new SccaTransport(undefined, { op: 500, connect: 2000 });
    const r = await t.call('SOF_GetVersion', []);
    expect(r.retValue).toBe('1.3.8.806');
    expect(r.retCode).toBe(0);
  });

  test('⑥ 迟到帧不误配新调用', async () => {
    FakeWS.script = [() => { }]; // 超时
    const t = new SccaTransport(undefined, { op: 500, connect: 2000 });
    await t.call('SOF_GetVersion', []);
    // 新连接+正常回包
    FakeWS.script = [
      (s) => s.emit('message', { data: JSON.stringify({ retValue: 'a||c&&&', retCode: 0 }) }),
    ];
    const r2 = await t.call('SOF_GetUserList', []);
    expect(r2.retValue).toBe('a||c&&&');
    // 向旧 socket 注入迟到帧——不影响新调用结果
    FakeWS.instances[0]!.emit('message', { data: JSON.stringify({ retValue: 'LATE', retCode: 0 }) });
    expect(r2.retValue).toBe('a||c&&&');
  });

  test('⑦ PIN 掩码——SOF_Login 的 PIN 参数在日志中为 ***', async () => {
    FakeWS.script = [
      (s) => s.emit('message', { data: JSON.stringify({ retValue: true, retCode: 0 }) }),
    ];
    const t = new SccaTransport(undefined, { op: 500, connect: 2000 });
    await t.call('SOF_Login', ['container1', '12345678']);
    const logStr = JSON.stringify(t.log);
    expect(logStr).toContain('***');
    expect(logStr).not.toContain('12345678');
  });

  test('⑧ DoS 红线——SOF_EncryptData >64KiB 输入抛错', async () => {
    const t = new SccaTransport(undefined, { op: 500, connect: 2000 });
    const bigData = 'A'.repeat(65 * 1024);
    await expect(t.call('SOF_EncryptData', ['cert', bigData])).rejects.toThrow(/64.*KiB|红线/);
  });

  test('⑨ 断连时在途请求立即失败（不等超时）', async () => {
    FakeWS.script = [() => { }]; // 不回包
    const t = new SccaTransport(undefined, { op: 500, connect: 2000 });
    const p = t.call('SOF_GetVersion', []);
    await sleep(200); // 等连接建立
    FakeWS.instances[FakeWS.instances.length - 1]!.close(); // 模拟中间件断开
    await expect(p).rejects.toThrow(/断开|CONN_LOST/);
  }, 5000);

  test('⑩ 错误码归一化', () => {
    expect(SccaTransport.normalizeError(184550659, '')).toBe('UKEY_PIN_REQUIRED');
    expect(SccaTransport.normalizeError(184550657, false)).toBe('UKEY_PIN_INVALID');
    expect(SccaTransport.normalizeError(184549377, '')).toBe('UKEY_DECRYPT_FAILED');
    expect(SccaTransport.normalizeError(0, 'ok')).toBeNull();
  });
});
