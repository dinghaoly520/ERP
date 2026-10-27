import { createHash } from 'node:crypto';
import { RongyidaSmsProvider, resolveSmsProvider } from './sms-provider';

/* 融易达 provider 单测：mock global.fetch。
   核心回归点（文档 V2.3 铁律）：sign = md5(appid+mobile+msg+appkey)，msg 以【原文】参与
   运算、仅传输时 urlencode（URLSearchParams 代办）——两者混用即 -4。
   注意 URLSearchParams.get() 返回解码值；要看传输编码形态须用 toString()。 */

const ENV = {
  RYD_APPID: 'test-appid-0000000000000000',
  RYD_APPKEY: 'test-appkey-00000000000000000',
  RYD_SIGN_NAME: '四川省水利发展集团有限公司',
};

const mockFetchOnce = (payload: unknown, ok = true) => {
  const fn = global.fetch as jest.Mock;
  fn.mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  } as unknown as Response);
};

/** 取第 n 次调用的表单体（get() 即解码后的原文 msg） */
const capturedBody = (n = 0): URLSearchParams => {
  const fn = global.fetch as jest.Mock;
  const body = fn.mock.calls[n][1]?.body;
  expect(body).toBeInstanceOf(URLSearchParams);
  return body as URLSearchParams;
};

describe('RongyidaSmsProvider', () => {
  let provider: RongyidaSmsProvider;
  const fetchMock = jest.fn();

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    // @ts-expect-error 恢复宿主 fetch（jest 环境无原生引用可存）
    delete global.fetch;
  });
  beforeEach(() => {
    fetchMock.mockReset();
    Object.entries(ENV).forEach(([k, v]) => (process.env[k] = v));
    provider = new RongyidaSmsProvider();
  });
  afterEach(() => {
    Object.keys(ENV).forEach((k) => delete process.env[k]);
  });

  it('sign 以 msg 原文计算，传输层才是 urlencode 形态', async () => {
    mockFetchOnce({ sumSize: 1, resultCode: 0, restNum: 39, taskId: 'I2509242145141974', resultMsg: '成功' });

    await provider.send('13800138000', '482913', 'supplier_registration');

    const body = capturedBody();
    const msg = body.get('msg') ?? '';
    const expectedSign = createHash('md5')
      .update(`${ENV.RYD_APPID}13800138000${msg}${ENV.RYD_APPKEY}`)
      .digest('hex');
    expect(body.get('sign')).toBe(expectedSign);
    expect(body.get('appid')).toBe(ENV.RYD_APPID);
    expect(body.get('mobile')).toBe('13800138000');
    // 传输层编码可见：序列化形态里【签名】括号已百分号化（E3 80 90），无裸中文
    expect(body.toString()).toContain('msg=%E3%80%90');
    expect(body.toString()).not.toContain('【');
  });

  it('成功返回 taskId 作 requestId，msg 含已报备签名与场景文案', async () => {
    mockFetchOnce({ sumSize: 1, resultCode: 0, restNum: 39, taskId: 'I2509242145141974', resultMsg: '成功' });

    const result = await provider.send('13800138000', '482913', 'supplier_registration');

    expect(result).toEqual({ requestId: 'I2509242145141974' });
    const msg = capturedBody().get('msg') ?? '';
    expect(msg.startsWith(`【${ENV.RYD_SIGN_NAME}】`)).toBe(true);
    expect(msg).toContain('供应商门户');
    expect(msg).toContain('482913');
    expect(msg).toContain('5分钟内有效');
    expect(msg.length).toBeLessThanOrEqual(70); // 单条计费上限（文档第十七章）
  });

  it('四个场景文案分流：重置密码带「如非本人操作」、中性兜底不含门户名', async () => {
    mockFetchOnce({ resultCode: 0, taskId: 't1' });
    mockFetchOnce({ resultCode: 0, taskId: 't2' });
    mockFetchOnce({ resultCode: 0, taskId: 't3' });

    await provider.send('13800138000', '111111', 'supplier_password_reset');
    await provider.send('13800138000', '222222', 'management_registration');
    await provider.send('13800138000', '333333', 'expert_verification');

    const resetMsg = capturedBody(0).get('msg') ?? '';
    const regMsg = capturedBody(1).get('msg') ?? '';
    const genericMsg = capturedBody(2).get('msg') ?? '';
    expect(resetMsg).toContain('重置登录密码');
    expect(resetMsg).toContain('如非本人操作');
    expect(regMsg).toContain('采购管理工作台');
    expect(genericMsg).not.toContain('门户');
    // 勿把验证码框定为登录用途（系统无短信登录场景；「重置登录密码」指重置口令本身，合规）
    for (const m of [resetMsg, regMsg, genericMsg]) {
      expect(m).not.toMatch(/登录(验证码|操作)/);
    }
  });

  it('resultCode 非 0 抛错并附错误码语义（-11 签名未报备 / -13 条数用尽）', async () => {
    mockFetchOnce({ resultCode: -11, taskId: '0', resultMsg: '没有设置短信签名' });
    await expect(provider.send('13800138000', '482913', 'supplier_registration')).rejects.toThrow(/-11.*签名/);

    mockFetchOnce({ resultCode: -13, taskId: '0', resultMsg: '已达可用条数上限' });
    await expect(provider.send('13800138000', '482913', 'supplier_registration')).rejects.toThrow(/-13.*条数/);
  });

  it('HTTP 非 2xx 同样抛错', async () => {
    mockFetchOnce({ resultCode: undefined }, false);
    await expect(provider.send('13800138000', '482913', 'supplier_registration')).rejects.toThrow(/HTTP 500/);
  });

  it('resultCode 为字符串 "0" 亦按成功（防御性归一）', async () => {
    mockFetchOnce({ resultCode: '0', taskId: 'I-str-code', restNum: 100, resultMsg: '成功' }, true);
    await expect(provider.send('13800138000', '482913', 'supplier_registration')).resolves.toEqual({ requestId: 'I-str-code' });
  });

  it('HTTP 200 但 resultCode 缺失/非数值按失败兜底（网关异常响应形态）', async () => {
    mockFetchOnce({ resultMsg: 'gateway hiccup' }, true);
    await expect(provider.send('13800138000', '482913', 'supplier_registration')).rejects.toThrow(/融易达短信发送失败/);
  });

  it('env 缺失时 send 抛配置不完整', async () => {
    delete process.env.RYD_APPKEY;
    await expect(provider.send('13800138000', '482913', 'supplier_registration')).rejects.toThrow('配置不完整');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolveSmsProvider 按 env 选中 rongyida', () => {
    process.env.SMS_PROVIDER = 'rongyida';
    expect(resolveSmsProvider().id).toBe('rongyida');
    delete process.env.SMS_PROVIDER;
  });
});
