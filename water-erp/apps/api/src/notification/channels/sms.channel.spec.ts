import { createHash } from 'node:crypto';
import { SmsChannel } from './sms.channel';

/* 通知轨短信通道单测（2026-10-27 接融易达）：mock global.fetch。
   锁定：sign=md5(appid+mobile+msg 原文+appkey) 传输才编码；msg 未带【签名】时前置；
   失败不兜底直接 failed 透出错误码。 */

const ENV = {
  RYD_APPID: 'test-appid-0000000000000000',
  RYD_APPKEY: 'test-appkey-00000000000000000',
  RYD_SIGN_NAME: '四川省水利发展集团',
};

describe('SmsChannel（通知轨·融易达）', () => {
  let channel: SmsChannel;
  const fetchMock = jest.fn();

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    // @ts-expect-error 恢复宿主 fetch
    delete global.fetch;
  });
  beforeEach(() => {
    fetchMock.mockReset();
    Object.entries(ENV).forEach(([k, v]) => (process.env[k] = v));
    channel = new SmsChannel();
  });
  afterEach(() => {
    Object.keys(ENV).forEach((k) => delete process.env[k]);
  });

  const payload = {
    userId: 'u1', phone: '13368360619', type: 'SELECTION_NOTIFY',
    title: '关于某采购项目候选供应商邀请的通知',
    content: '中国地质科学院探工所 您好！四川水发勘测设计研究有限公司现邀请贵公司参与钻机（800型）采购项目（项目编号：X-1），采购方式为谈判采购。请在24小时内登录供应商门户或直接点击 http://192.168.1.107:3004/rsvp?t=abc123 确认是否参加本次采购邀请，若超时则视为自动放弃；',
  };

  it('成功：前置【签名】、sign 用 msg 原文、返回 sent', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ resultCode: 0, taskId: 'T1', restNum: 50 }) });
    const r = await channel.send(payload as never);
    expect(r).toEqual({ status: 'sent' });

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    const msg = body.get('msg') ?? '';
    expect(msg.startsWith(`【${ENV.RYD_SIGN_NAME}】`)).toBe(true);
    expect(msg).toContain('中国地质科学院探工所');
    expect(body.get('sign')).toBe(createHash('md5').update(`${ENV.RYD_APPID}${payload.phone}${msg}${ENV.RYD_APPKEY}`).digest('hex'));
    expect(body.toString()).toContain('msg=%E3%80%90'); // 传输层编码可见
  });

  it('正文已带【签名】时不重复前置', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ resultCode: 0, taskId: 'T2' }) });
    await channel.send({ ...payload, content: `【${ENV.RYD_SIGN_NAME}】自带签名正文` } as never);
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect((body.get('msg') ?? '').split('【').length - 1).toBe(1);
  });

  it('网关失败：不兜底，failed 透出错误码（-11 签名未报备）', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ resultCode: -11, resultMsg: '短信签名不正确' }) });
    const r = await channel.send(payload as never);
    expect(r.status).toBe('failed');
    expect(r.error).toContain('-11');
  });

  it('env 缺失：failed 配置不完整，不触网', async () => {
    delete process.env.RYD_APPKEY;
    const r = await channel.send(payload as never);
    expect(r).toEqual({ status: 'failed', error: expect.stringContaining('配置不完整') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('无手机号：skipped', async () => {
    const r = await channel.send({ ...payload, phone: null } as never);
    expect(r).toEqual({ status: 'skipped', error: '无手机号' });
  });
});
