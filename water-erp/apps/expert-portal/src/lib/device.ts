/**
 * 平板设备检测（D5 收口 —— proxy.ts / login / root layout 内联脚本共用一份正则与判定）
 *
 * 检测策略（与 proxy.ts 的 x-forwarded-device 头分支互补）：
 * 1. UA 明确标识平板 / 电子书 / ChromeOS
 * 2. Android 无 Mobile 标记（手机才有 Mobile）
 * 3. 多点触控 + 无 Mobile 标记（iPadOS 13+ 伪装 Mac UA 的兜底）
 */

export const TABLET_UA_RE = /iPad|PlayBook|Kindle|Silk|KFAPWI|Tablet|CrOS/i;
export const ANDROID_RE = /Android/i;
export const MOBILE_RE = /Mobile/i;

/** 服务端判定（UA 字符串来自请求头或 navigator.userAgent） */
export function detectTabletUA(ua: string): boolean {
  return TABLET_UA_RE.test(ua) || (ANDROID_RE.test(ua) && !MOBILE_RE.test(ua));
}

/** 客户端判定（含 maxTouchPoints 兜底；SSR/无 navigator 环境返回 false） */
export function detectTabletClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    detectTabletUA(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && !MOBILE_RE.test(navigator.userAgent))
  );
}
