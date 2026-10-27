/**
 * 移动门户（:3011）API 客户端——复用 web 命名空间（token_web + X-Web-Token）。
 * 与 apps/web/src/lib/api.ts 同轨；差异仅 on401：只读门户从简，任何 401
 * （未登录/被顶 SESSION_REPLACED/账号冻结）统一清会话回登录页，不弹遮罩。
 */
import { createApiClient } from "@water-erp/client";
import { getWebToken } from "./session-store";

export { ApiError } from "@water-erp/client";

const client = createApiClient({
  portal: "web",
  baseUrl: "/api",
  // tab 级会话 token（sessionStorage 各标签页独立）
  extraHeaders: (): Record<string, string> => {
    const token = getWebToken();
    return token ? { "X-Web-Token": token } : {};
  },
  on401: () => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem("webToken");
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  },
});

export const api = {
  get: <T>(path: string) => client.get<T>(path),
  post: <T>(path: string, body?: unknown, init?: RequestInit) => client.post<T>(path, body, init),
  delete: <T>(path: string) => client.delete<T>(path),
};
