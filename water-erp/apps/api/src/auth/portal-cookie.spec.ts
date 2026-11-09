import { portalFromRequest, tokenFromRequest } from './portal-cookie';

/** 最小 Request 桩：portal-cookie 只读 headers / cookies 两个字段 */
function req(headers: Record<string, string>, cookies?: Record<string, string>) {
  return { headers, cookies } as any;
}

describe('portalFromRequest', () => {
  it('X-Portal 头最优先', () => {
    expect(
      portalFromRequest(
        req({
          'x-portal': 'expert',
          referer: 'https://procurement-ssyc.scsfjt.com/notice',
        }),
      ),
    ).toBe('expert');
  });

  it('Origin/Referer 端口反查（dev 端口模式）', () => {
    expect(portalFromRequest(req({ referer: 'http://localhost:3006/evaluate/x' }))).toBe('expert');
    expect(portalFromRequest(req({ origin: 'http://localhost:3004' }))).toBe('supplier');
    expect(portalFromRequest(req({ referer: 'http://192.168.1.5:3007/bid' }))).toBe('bid');
    expect(portalFromRequest(req({ referer: 'http://localhost:3005/dashboard' }))).toBe('web');
    expect(portalFromRequest(req({ referer: 'http://localhost:3002/' }))).toBe('public');
  });

  describe('域名家族子域反查（2026-11-09：生产 *.scsfjt.com 无端口）', () => {
    // 生产实录：专家门户「标书获取」预览采购文件 —— <a href="/api/..."> 直链导航
    // 无 X-Portal 头、GET 导航不带 Origin，仅 Referer（无端口）——缺此回退则落旧版
    // token cookie → 401「未登录或登录已过期」。
    it('无端口的域名家族 Referer → 按子域反查门户', () => {
      expect(
        portalFromRequest(req({ referer: 'https://expert-ssyc.scsfjt.com/evaluate/abc' })),
      ).toBe('expert');
      expect(
        portalFromRequest(req({ origin: 'https://supplier-ssyc.scsfjt.com' })),
      ).toBe('supplier');
      expect(
        portalFromRequest(req({ referer: 'https://procurement-ssyc.scsfjt.com/notice' })),
      ).toBe('web');
      expect(
        portalFromRequest(req({ referer: 'https://bid-ssyc.scsfjt.com/bid/open?id=x' })),
      ).toBe('bid');
      expect(portalFromRequest(req({ referer: 'https://ssyc.scsfjt.com/' }))).toBe('public');
    });

    it('mobile 子域 → web 命名空间（mobile-portal 会话复用 token_web，与其 proxy 自报 X-Portal: web 同口径）', () => {
      expect(
        portalFromRequest(req({ referer: 'https://mobile-ssyc.scsfjt.com/' })),
      ).toBe('web');
    });

    it('api 子域不是门户 → undefined（回退旧版 token cookie）', () => {
      expect(
        portalFromRequest(req({ referer: 'https://api-ssyc.scsfjt.com/api/docs' })),
      ).toBeUndefined();
    });

    it('家族外域名无端口 → undefined（不误判）', () => {
      expect(portalFromRequest(req({ referer: 'https://example.com/page' }))).toBeUndefined();
      expect(portalFromRequest(req({ origin: 'https://evil-scsfjt.com' }))).toBeUndefined();
    });

    it('端口优先于子域反查（家族域名带端口的边缘形态）', () => {
      expect(
        portalFromRequest(req({ referer: 'https://scsfjt.com:3006/evaluate' })),
      ).toBe('expert');
    });
  });

  it('无任何来源线索 → undefined', () => {
    expect(portalFromRequest(req({}))).toBeUndefined();
  });

  it('畸形 Referer 不抛错', () => {
    expect(portalFromRequest(req({ referer: 'not a url' }))).toBeUndefined();
  });
});

describe('tokenFromRequest（域名模式直链下载的鉴权取 token）', () => {
  it('域名家族 Referer + 对应命名空间 cookie → 取到 token（修复 401 的关键路径）', () => {
    const token = tokenFromRequest(
      req(
        { referer: 'https://expert-ssyc.scsfjt.com/evaluate/abc' },
        { token_expert: 'jwt-expert' },
      ),
    );
    expect(token).toBe('jwt-expert');
  });

  it('mobile 子域 Referer → 读 token_web', () => {
    const token = tokenFromRequest(
      req({ referer: 'https://mobile-ssyc.scsfjt.com/' }, { token_web: 'jwt-web' }),
    );
    expect(token).toBe('jwt-web');
  });

  it('api 子域 Referer → 回退旧版 token cookie（现状保持）', () => {
    const token = tokenFromRequest(
      req({ referer: 'https://api-ssyc.scsfjt.com/x' }, { token: 'legacy' }),
    );
    expect(token).toBe('legacy');
  });

  it('家族外 Referer → 回退旧版 token cookie（现状保持）', () => {
    const token = tokenFromRequest(
      req({ referer: 'https://example.com/x' }, { token: 'legacy' }),
    );
    expect(token).toBe('legacy');
  });
});
