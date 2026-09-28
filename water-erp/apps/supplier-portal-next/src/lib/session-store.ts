/**
 * :3004 供应商门户 tab 级会话存储（2026-09-28，移植自 :3005 session-store）。
 *
 * - supplierToken：tab 级会话 token（登录响应的 access_token，存 sessionStorage）。
 *   token_supplier cookie 在同一浏览器全局只有一份，另一标签页登录（同账号或换账号）
 *   会直接覆盖 cookie，旧标签页会无感变成新会话——没有任何被顶感知。改由各标签页经
 *   X-Supplier-Token 头携带自己的 token：登录轮换 sid 后，旧标签页的旧 sid 比对不
 *   通过 → 401 SESSION_REPLACED → 弹「会话被顶」遮罩。cookie 仅作回退（新开标签页
 *   直接访问受保护页 / 无头客户端）。
 */

const SUPPLIER_TOKEN_KEY = "supplierToken";

export function getSupplierToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(SUPPLIER_TOKEN_KEY);
}

/** 登录成功后调用：把 access_token 存入当前 tab（标签页独立，互不覆盖） */
export function rememberSupplierSession(token: string) {
  if (typeof window === "undefined" || !token) return;
  window.sessionStorage.setItem(SUPPLIER_TOKEN_KEY, token);
}

/** 被顶/冻结/登出时调用：清本 tab 的会话 token */
export function clearSupplierToken() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SUPPLIER_TOKEN_KEY);
}
