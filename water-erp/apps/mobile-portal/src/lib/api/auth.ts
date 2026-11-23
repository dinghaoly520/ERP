/**
 * 移动门户鉴权最小集——登录（X-Portal: web，写 token_web）、当前用户、登出。
 * 会话命名空间与 :3005 完全同轨（见 spec 2026-10-13-mobile-portal-3011）。
 */
import { api } from "../api";
import { rememberWebSession, clearWebToken } from "../session-store";

/** 系统实际角色（与后端 Prisma schema 保持一致，同 web 口径） */
export type AuthRole = "admin" | "leader" | "staff" | "bid_host" | "bid_expert" | "supplier";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
};

/** admin 专属公司选择器数据（同 web CompanySelect：GET /companies） */
export type CompanyOption = {
  id: string;
  name: string;
  shortName: string | null;
  _count: { users: number; officeUsers?: number; expertUsers?: number };
};

export async function login(username: string, password: string): Promise<{ role: AuthRole }> {
  const res = await api.post<{ access_token: string; role: AuthRole; username: string }>(
    "/auth/login",
    { username, password },
  );
  rememberWebSession(res.access_token);
  return { role: res.role };
}

/* ── :3011 移动驾驶舱手机号登录（2026-11-23 用户裁定：白名单短信码 + 固定密码白名单号）── */

/** 发送登录短信验证码（仅白名单手机号；名单外后端报「无法接收短信验证码」） */
export async function sendMobileLoginCode(phone: string): Promise<void> {
  await api.post<{ maskedPhone: string }>("/auth/mobile/send-code", { phone });
}

export async function mobileLogin(phone: string, code: string): Promise<{ role: AuthRole }> {
  const res = await api.post<{ access_token: string; role: AuthRole; username: string }>(
    "/auth/mobile/login",
    { phone, code },
  );
  rememberWebSession(res.access_token);
  return { role: res.role };
}

/** 白名单号 13368360619：固定密码登录（不走短信） */
export async function mobilePasswordLogin(phone: string, password: string): Promise<{ role: AuthRole }> {
  const res = await api.post<{ access_token: string; role: AuthRole; username: string }>(
    "/auth/mobile/password-login",
    { phone, password },
  );
  rememberWebSession(res.access_token);
  return { role: res.role };
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const u = await api.get<AuthUser>("/auth/me");
  return { ...u, displayName: u.displayName || u.username };
}

export async function fetchCompanies(): Promise<CompanyOption[]> {
  return api.get<CompanyOption[]>("/companies");
}

export async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout", {});
  } catch {
    /* 会话已失效也继续本地清理 */
  }
  clearWebToken();
}
