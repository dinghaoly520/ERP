/**
 * :3005 单设备登录的浏览器侧会话存储（2026-08-21）。
 *
 * - webToken：tab 级会话 token（登录响应的 access_token，存 sessionStorage）。
 *   token_web cookie 在同一浏览器全局只有一份，两个标签页登录两个账号会互相
 *   覆盖；改由各标签页经 X-Web-Token 头携带自己的 token，同浏览器多账号并存。
 *   token 内的 sid 与库中 User.webSessionId 比对实现「同账号仅一处在线」。
 * - login-prefill：登录成功时保存的账号密码（base64 混淆），被顶下线/冻结回到
 *   登录页时预填，减少重复输入。仅本机 localStorage，手动登出即清除。
 */

const WEB_TOKEN_KEY = "webToken";
const PREFILL_KEY = "web:login-prefill";

export function getWebToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(WEB_TOKEN_KEY);
}

/** 登录成功后调用：把 access_token 存入当前 tab（标签页独立，互不覆盖） */
export function rememberWebSession(token: string) {
  if (typeof window === "undefined" || !token) return;
  window.sessionStorage.setItem(WEB_TOKEN_KEY, token);
}

export function clearWebToken() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(WEB_TOKEN_KEY);
}

export function saveLoginPrefill(username: string, password: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PREFILL_KEY,
      btoa(encodeURIComponent(JSON.stringify({ username, password }))),
    );
  } catch {
    /* 存储不可用忽略 */
  }
}

export function readLoginPrefill(): { username: string; password: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PREFILL_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(atob(raw)));
    if (typeof parsed?.username === "string" && typeof parsed?.password === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function clearLoginPrefill() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PREFILL_KEY);
}
