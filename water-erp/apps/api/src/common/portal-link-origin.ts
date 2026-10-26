// tsconfig 无 esModuleInterop：CJS 模块（node:os）须用 require 形式导入，默认导入在 jest 下为 undefined
import os = require('node:os');
import { PORTS, portalOrigin, PORTAL_DOMAINS, inDomainFamily, type AppName } from '@water-erp/config';

/**
 * 门户链接 origin 解析（发给外部用户的链接用，如供应商 RSVP 回执链接）。
 *
 * 背景（2026-10-16）：此类链接会被**别的机器**点开（供应商/专家的手机与电脑），
 * 写死 http://localhost:3004 时局域网设备点开连到的是它自己。
 *
 * 优先级：
 *  1. env 显式覆盖且非 localhost（生产真实域名）→ 直接用；
 *  2. 请求头推导的访问主机（Origin/Referer/X-Forwarded-Host）：
 *     a. 域名家族访问（*.scsfjt.com，2026-10-26 子域名申请单）且目标门户有子域
 *        → 域名 origin（无端口；协议随 X-Forwarded-Proto/Origin/Referer，缺省 https）；
 *     b. 端口/IP 访问：采购人员从 http://192.168.x.x:3005 操作 → 链接指向
 *        http://192.168.x.x:3004；
 *  3. 本机 LAN IPv4（os.networkInterfaces 首个非内网地址）——操作者浏览
 *     localhost:3005 时链接仍能被局域网设备点开；
 *  4. portalOrigin 兜底（http://localhost:<port>）。
 */

/** 请求头最小结构（controller 透传；只取链接推导所需四头） */
export interface PortalLinkHeaders {
  origin?: unknown;
  referer?: unknown;
  'x-forwarded-host'?: unknown;
  'x-forwarded-proto'?: unknown;
}

export function resolvePortalLinkOrigin(
  app: AppName,
  headers: PortalLinkHeaders | undefined,
  envOverride?: string,
): string {
  const configured = envOverride?.trim() || undefined;
  if (configured && !isLoopbackHost(hostnameOfUrl(configured))) {
    return configured.replace(/\/+$/, '');
  }
  const requestHost = requestHostname(headers);
  if (requestHost && !isLoopbackHost(requestHost)) {
    const domain = PORTAL_DOMAINS[app];
    if (domain && inDomainFamily(requestHost)) {
      return `${requestProtocol(headers) ?? 'https:'}//${domain}`;
    }
    return `http://${requestHost}:${PORTS[app]}`;
  }
  const lanIp = firstLanIPv4();
  if (lanIp) return `http://${lanIp}:${PORTS[app]}`;
  return portalOrigin(app, configured);
}

/** URL 字符串 → hostname；解析失败返回 undefined */
function hostnameOfUrl(raw: string): string | undefined {
  try {
    return new URL(raw).hostname;
  } catch {
    return undefined;
  }
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/** 从请求头解析协议：X-Forwarded-Proto（可能为逗号链）→ Origin/Referer 的 scheme；均缺省 undefined */
function requestProtocol(headers: PortalLinkHeaders | undefined): string | undefined {
  const fwd = String(headers?.['x-forwarded-proto'] ?? '').trim().split(',')[0].trim();
  if (fwd === 'https' || fwd === 'http') return `${fwd}:`;
  for (const raw of [headers?.origin, headers?.referer]) {
    const s = String(raw ?? '').trim();
    if (s.startsWith('https://')) return 'https:';
    if (s.startsWith('http://')) return 'http:';
  }
  return undefined;
}

/** 从请求头提取访问主机名（Origin/Referer 是完整 URL；X-Forwarded-Host 是 host[:port]，可能为逗号链） */
function requestHostname(headers: PortalLinkHeaders | undefined): string | undefined {
  const candidates: string[] = [
    String(headers?.origin ?? '').trim(),
    String(headers?.referer ?? '').trim(),
    String(headers?.['x-forwarded-host'] ?? '').trim(),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const first = c.split(',')[0].trim();
    const host = first.includes('://') ? hostnameOfUrl(first) : first.replace(/:\d+$/, '');
    if (host) return host;
  }
  return undefined;
}

/** 本机首个非内网 IPv4；无网卡/受限容器环境返回 undefined */
function firstLanIPv4(): string | undefined {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return undefined;
}
