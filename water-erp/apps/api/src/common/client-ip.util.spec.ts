import { getClientIp } from './client-ip.util';

const makeReq = (headers: Record<string, string | undefined> = {}, ip?: string, remote?: string) =>
  ({ headers, ip, socket: { remoteAddress: remote } } as any);

describe('getClientIp', () => {
  it('X-Forwarded-For 取第一个（最左）', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('回退到 X-Real-IP', () => {
    expect(getClientIp(makeReq({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('回退到 req.ip', () => {
    expect(getClientIp(makeReq({}, '203.0.113.1'))).toBe('203.0.113.1');
  });

  it('IPv6 回环 ::1 标准化为 127.0.0.1', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '::1' }))).toBe('127.0.0.1');
  });

  it('去除 ::ffff: 前缀', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '::ffff:192.168.1.1' }))).toBe('192.168.1.1');
  });

  it('无任何来源返回 null', () => {
    expect(getClientIp(makeReq())).toBeNull();
  });
});
