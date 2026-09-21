/**
 * 登录/注册页背景图（2026-09-21）：同一会话内共享一张。
 * - 打开登录页时随机取一张并写入 sessionStorage；
 * - 从注册页/临时注册页返回登录、或进入注册/临时注册时，沿用 sessionStorage 里的那张，
 *   不再重新随机——保证整个会话背景图一致。
 */
export const LOGIN_BG_POOL = ["/login-bg-1.jpg", "/login-bg-2.jpg", "/login-bg-3.jpg"] as const;

const BG_KEY = "supplier-login-bg";

/** 取当前会话背景图：优先 sessionStorage，无则随机一张并写入；SSR 环境回退池首张。 */
export function resolveLoginBg(fallback: string = LOGIN_BG_POOL[0]): string {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.sessionStorage.getItem(BG_KEY);
    if (stored && (LOGIN_BG_POOL as readonly string[]).includes(stored)) return stored;
    const picked = LOGIN_BG_POOL[Math.floor(Math.random() * LOGIN_BG_POOL.length)];
    window.sessionStorage.setItem(BG_KEY, picked);
    return picked;
  } catch {
    return fallback;
  }
}

/** 预加载背景图池全部图片（防随机切换时新图未缓存导致白闪）。 */
export function preloadLoginBg(): void {
  if (typeof window === "undefined") return;
  for (const src of LOGIN_BG_POOL) {
    const img = new Image();
    img.src = src;
  }
}
