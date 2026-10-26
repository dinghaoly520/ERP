import os = require('node:os');
import { resolvePortalLinkOrigin } from './portal-link-origin';

/** 局域网自适应 origin 解析——发给供应商/专家的链接必须能被**别的机器**点开（RSVP 回执链路） */
describe('resolvePortalLinkOrigin', () => {
  const realInterfaces = os.networkInterfaces;

  afterEach(() => {
    os.networkInterfaces = realInterfaces;
    delete process.env.SUPPLIER_PORTAL_URL;
  });

  const mockLan = (ip: string | undefined) => {
    os.networkInterfaces = () =>
      ip
        ? { en0: [{ address: '127.0.0.1', family: 'IPv4', internal: true, mac: '', netmask: '', cidr: null }, { address: ip, family: 'IPv4', internal: false, mac: '', netmask: '', cidr: null }] }
        : { lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true, mac: '', netmask: '', cidr: null }] };
  };

  it('生产域名 env 覆盖优先（非 localhost 才算覆盖）', () => {
    mockLan('192.168.1.5');
    expect(
      resolvePortalLinkOrigin('supplier', { origin: 'http://192.168.1.9:3005' }, 'https://supplier.example.com'),
    ).toBe('https://supplier.example.com');
  });

  it('localhost 值的 env 不视为覆盖——退到请求访问主机（LAN 自适应）', () => {
    mockLan('192.168.1.5');
    expect(
      resolvePortalLinkOrigin('supplier', { origin: 'http://192.168.1.9:3005' }, 'http://localhost:3004'),
    ).toBe('http://192.168.1.9:3004');
  });

  it('Referer 兜底 Origin；X-Forwarded-Host 兜底前两者（Next 代理场景，host:port 形式）', () => {
    mockLan('192.168.1.5');
    expect(resolvePortalLinkOrigin('supplier', { referer: 'http://192.168.1.9:3005/notice' })).toBe('http://192.168.1.9:3004');
    expect(resolvePortalLinkOrigin('supplier', { 'x-forwarded-host': '192.168.1.9:3005' })).toBe('http://192.168.1.9:3004');
    // 逗号链取第一跳
    expect(resolvePortalLinkOrigin('supplier', { 'x-forwarded-host': '192.168.1.9:3005, proxy:80' })).toBe('http://192.168.1.9:3004');
  });

  it('访问主机为 localhost（操作者在服务器本机浏览）→ 用服务器 LAN IPv4，链接仍可被局域网设备点开', () => {
    mockLan('192.168.1.5');
    expect(resolvePortalLinkOrigin('supplier', { origin: 'http://localhost:3005' })).toBe('http://192.168.1.5:3004');
    expect(resolvePortalLinkOrigin('supplier', undefined)).toBe('http://192.168.1.5:3004');
  });

  it('无任何线索（无请求头 + 无 LAN 网卡）→ portalOrigin localhost 兜底', () => {
    mockLan(undefined);
    expect(resolvePortalLinkOrigin('supplier', undefined)).toBe('http://localhost:3004');
  });

  it('非 supplier 门户按各自端口派生', () => {
    mockLan('192.168.1.5');
    expect(resolvePortalLinkOrigin('expert', { origin: 'http://192.168.1.9:3005' })).toBe('http://192.168.1.9:3006');
  });

  // ── 域名家族双轨（2026-10-26，*.scsfjt.com 子域名申请单）：域名访问 → 域名互跳 ──

  it('域名家族访问（Origin https）→ 目标门户子域，无端口，协议随 Origin', () => {
    mockLan('192.168.1.5');
    expect(
      resolvePortalLinkOrigin('supplier', { origin: 'https://procurement-ssyc.scsfjt.com' }),
    ).toBe('https://supplier-ssyc.scsfjt.com');
  });

  it('域名家族但仅 X-Forwarded-Host（无协议头）→ 缺省 https（公网家族恒 TLS）', () => {
    mockLan('192.168.1.5');
    expect(
      resolvePortalLinkOrigin('expert', { 'x-forwarded-host': 'ssyc.scsfjt.com' }),
    ).toBe('https://expert-ssyc.scsfjt.com');
  });

  it('X-Forwarded-Proto 优先于 Origin scheme（反代 http 回源场景）', () => {
    mockLan('192.168.1.5');
    expect(
      resolvePortalLinkOrigin('web', { origin: 'http://ssyc.scsfjt.com', 'x-forwarded-proto': 'https' }),
    ).toBe('https://procurement-ssyc.scsfjt.com');
  });

  it('域名家族访问但目标门户无子域（mall 未申请）→ 回退端口口径', () => {
    mockLan('192.168.1.5');
    expect(
      resolvePortalLinkOrigin('mall', { origin: 'https://ssyc.scsfjt.com' }),
    ).toBe('http://ssyc.scsfjt.com:3003');
  });

  it('仿冒家族后缀不触发域名分支（scsfjt.com.cn / evil-scsfjt.com）', () => {
    mockLan('192.168.1.5');
    expect(
      resolvePortalLinkOrigin('supplier', { origin: 'https://x.scsfjt.com.cn' }),
    ).toBe('http://x.scsfjt.com.cn:3004');
    expect(
      resolvePortalLinkOrigin('supplier', { origin: 'https://evil-scsfjt.com' }),
    ).toBe('http://evil-scsfjt.com:3004');
  });
});
