/**
 * 会话/签到设备分类（2026-09-22）：UA → 设备类别 + 人类可读摘要。
 *
 * 与门户端 detectTabletUA 同一正则口径（apps/expert-portal/src/lib/device.ts）。
 * 已知局限：服务端拿不到 maxTouchPoints，iPadOS 13+ Safari 默认伪装 Mac 的 UA
 * 会被判为 desktop——精确分类需平板浏览器开启「请求移动网站」、或生产反代按
 * 子网注入 X-Forwarded-Device 时在登录链路并入该头（本期未做，留口）。
 */

export type DeviceClass = 'tablet' | 'desktop' | 'phone' | 'unknown';

export interface DeviceClassMeta {
  deviceClass: DeviceClass;
  /** 如 "Safari·iPadOS" / "Chrome·Windows" / "curl·Linux" */
  uaSummary: string;
}

const TABLET_UA_RE = /iPad|PlayBook|Kindle|Silk|KFAPWI|Tablet|CrOS/i;
const ANDROID_RE = /Android/i;
const MOBILE_RE = /Mobile/i;

function classifyDevice(ua: string): DeviceClass {
  if (TABLET_UA_RE.test(ua)) return 'tablet';
  if (ANDROID_RE.test(ua) && !MOBILE_RE.test(ua)) return 'tablet';
  if (/iPhone/.test(ua) || (ANDROID_RE.test(ua) && MOBILE_RE.test(ua))) return 'phone';
  return 'desktop';
}

function summarizeBrowser(ua: string): string {
  if (/HeadlessChrome/i.test(ua)) return 'HeadlessChrome';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/^curl\//.test(ua)) return 'curl';
  if (/python-requests|axios|node-fetch|undici/i.test(ua)) return '程序客户端';
  return '未知客户端';
}

function summarizeOs(ua: string): string {
  if (/iPad/.test(ua)) return 'iPadOS';
  if (/iPhone/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return '未知系统';
}

export function classifyUserAgent(ua: string | null | undefined): DeviceClassMeta {
  const s = (ua ?? '').trim();
  if (!s) return { deviceClass: 'unknown', uaSummary: '未记录' };
  return { deviceClass: classifyDevice(s), uaSummary: `${summarizeBrowser(s)}·${summarizeOs(s)}` };
}

/** 登录/会话轮换时写入 User.sessionMeta 的快照（IP/UA 最小化，不含个人信息主体） */
export function buildSessionMeta(ua: string | null | undefined, ip?: string | null): {
  deviceClass: DeviceClass;
  uaSummary: string;
  ip: string | null;
  at: string;
} {
  const { deviceClass, uaSummary } = classifyUserAgent(ua);
  return { deviceClass, uaSummary, ip: ip ?? null, at: new Date().toISOString() };
}
