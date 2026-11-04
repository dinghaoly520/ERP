import { Request } from 'express';

/**
 * :3011 总数据来源头（2026-11-03 用户裁定 / 2026-11-04 扩到门户全页面）。
 * `x-portal-source: mobile-3011` 由移动端代理注入并覆盖传入值（浏览器 JS 不可
 * 伪造，proxy.ts:29）；直连 :4001 自设头属内部信任域（数据为内部统计、非 PII）。
 * 消费面：assistant chat（工具 ctx.totalData）+ resolveScope（门户页面总数据）。
 */
export const PORTAL_SOURCE_HEADER = 'x-portal-source';
export const MOBILE_PORTAL_SOURCE = 'mobile-3011';

/** 归一化取出请求的来源头（string[] 取首段），无则 undefined */
export function portalSourceOf(req?: Request): string | undefined {
  const raw = req?.headers?.[PORTAL_SOURCE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value || undefined;
}

export function isMobilePortalSource(req?: Request): boolean {
  return portalSourceOf(req) === MOBILE_PORTAL_SOURCE;
}
