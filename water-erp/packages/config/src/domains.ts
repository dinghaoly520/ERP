import type { AppName } from './ports';

/** 生产子域映射 —— 《子域名申请单》（已处理·2026-10-14 新终版）定稿。
 *  家族 *.scsfjt.com（公网 182.148.52.110 / 223.85.98.164 → 内网 10.10.7.20，HTTPS）。
 *  申请单未列业务（mall :3003 / assistant :3008 / bigscreen :3010）无子域——
 *  域名模式下跳转回退端口口径（见 urls.ts portalURL）。 */
export const PORTAL_DOMAINS: Partial<Record<AppName, string>> = {
  public: 'ssyc.scsfjt.com',
  api: 'api-ssyc.scsfjt.com',
  supplier: 'supplier-ssyc.scsfjt.com',
  expert: 'expert-ssyc.scsfjt.com',
  web: 'procurement-ssyc.scsfjt.com',
  bid: 'bid-ssyc.scsfjt.com',
  mobile: 'mobile-ssyc.scsfjt.com',
};

const DOMAIN_FAMILY = 'scsfjt.com';

/** 当前 hostname 是否处于生产域名家族（scsfjt.com / *.scsfjt.com）。
 *  端口/IP 访问（localhost、10.x、公网 IP 带 :port）→ false，维持端口互跳。 */
export function inDomainFamily(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, ''); // 容忍 DNS 尾点
  return h === DOMAIN_FAMILY || h.endsWith(`.${DOMAIN_FAMILY}`);
}
