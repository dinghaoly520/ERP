import { Request } from 'express';

/**
 * 从请求中提取真实客户端 IP。
 * 优先使用 X-Forwarded-For（需 trust proxy 配合）→ X-Real-IP → req.ip，
 * 并对本地开发环境的 IPv6 回环地址做标准化处理。
 */
export function getClientIp(req: Request): string | null {
  // X-Forwarded-For: "client, proxy1, proxy2" — 取第一个（最左边）
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }

  // X-Real-IP（某些代理单独设置）
  const realIp = req.headers['x-real-ip'] as string | undefined;
  if (realIp) return normalizeIp(realIp);

  // req.ip — Express 默认值，trust proxy 后自动从 x-forwarded-for 提取
  if (req.ip) return normalizeIp(req.ip);

  // req.socket.remoteAddress 作为最后备选
  const remote = req.socket?.remoteAddress;
  return remote ? normalizeIp(remote) : null;
}

/** 标准化 IP：IPv6 回环 → 127.0.0.1，去除 ::ffff: 前缀 */
function normalizeIp(ip: string): string {
  // IPv6-mapped IPv4: "::ffff:192.168.1.1" → "192.168.1.1"
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  // IPv6 回环 → 127.0.0.1
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return '127.0.0.1';
  return ip;
}
