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
});
