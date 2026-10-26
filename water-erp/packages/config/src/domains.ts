import { PORTS, type AppName } from './ports';

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

/** hostname 反查门户（域名家族内精确匹配子域）：supplier-ssyc.scsfjt.com → 'supplier'。
 *  家族外或未申请子域 → undefined。WS 握手/服务端跳转用（Origin 无端口时的判定回退）。 */
export function portalFromHostname(hostname: string): AppName | undefined {
  const h = hostname.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!inDomainFamily(h)) return undefined;
  for (const [app, domain] of Object.entries(PORTAL_DOMAINS)) {
    if (domain && h === domain) return app as AppName;
  }
  return undefined;
}

/** 服务端（Next middleware/proxy）跨门户 origin —— portalURL 的无 window 版本：
 *  middleware 里 portalURL 恒落 localhost 占位（2026-09-22 平板实测教训），必须按请求头推导。
 *  双轨同 portalURL：访问 hostname（可带端口）在域名家族且目标有子域 → 子域（无端口，
 *  proto 缺省 https）；IP/端口访问 → http://hostname:<port>。API_ORIGIN env 最高优先（仅 api）。 */
export function portalOriginForHost(app: AppName, hostname: string, proto?: string): string {
  if (app === 'api' && process.env.API_ORIGIN) return process.env.API_ORIGIN.replace(/\/+$/, '');
  const h = hostname.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const domain = PORTAL_DOMAINS[app];
  if (domain && inDomainFamily(h)) {
    const scheme = proto?.replace(/:$/, '') === 'http' ? 'http' : 'https';
    return `${scheme}://${domain}`;
  }
  return `http://${h || 'localhost'}:${PORTS[app]}`;
}
