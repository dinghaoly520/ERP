/**
 * :3011 移动门户 tab 级会话存储——语义同 web（token_web cookie 全浏览器一份，
 * X-Web-Token 头按 tab 隔离；token 内 sid 与 User.webSessionId 比对实现单设备）。
 */
const WEB_TOKEN_KEY = "webToken";

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
