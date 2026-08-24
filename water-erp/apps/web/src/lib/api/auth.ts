import {
  rememberWebSession,
  saveLoginPrefill,
  clearLoginPrefill,
  clearWebToken,
  getWebToken,
} from "@/lib/session-store";

export function normalizeApiBaseUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "/api";
  }

  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return trimmed.replace(/\/+$/, "");
  }

  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`.replace(/\/+$/, "");
  }

  return trimmed.replace(/\/+$/, "");
}

// Use relative /api path to leverage Next.js rewrites for cookie handling
const API_BASE = '/api';

/** 系统实际角色，与后端 Prisma schema 保持一致 */
export type AuthRole = "admin" | "leader" | "staff" | "bid_host" | "bid_expert" | "supplier" | "mall";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
  email?: string | null;
  phone?: string | null;
  officeLocation?: string | null;
  company?: string | null;
  avatar?: string | null;
  isActive?: boolean;
  createdAt?: string | null;
  department?: { id: string; name: string; code: string | null } | null;
};

export type DepartmentItem = {
  id: string;
  name: string;
  code: string | null;
};

export type UpdateProfileInput = {
  displayName?: string;
  email?: string | null;
  departmentId?: string | null;
  phone?: string | null;
  officeLocation?: string | null;
  company?: string | null;
  avatar?: string | null;
};

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallbackMessage = "请求失败，请稍后重试。";
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        const body = (await response.json()) as {
          message?: string | string[];
          error?: string;
        };
        // API HttpExceptionFilter 使用 error 字段传递错误信息，message 仅用于
        // NestJS 标准 ValidationPipe 校验错误，两者需同时读取。
        const apiError = body.error ?? body.message;
        const message = Array.isArray(apiError)
          ? apiError[0]
          : apiError;
        throw new Error(message || fallbackMessage);
      } catch (error) {
        if (error instanceof Error && error.message !== fallbackMessage) {
          throw error;
        }

        throw new Error(fallbackMessage);
      }
    }

    const text = (await response.text()).trim();
    if (text === "Internal Server Error") {
      throw new Error("服务处理失败，请稍后重试。");
    }

    try {
      throw new Error(text || fallbackMessage);
    } catch {
      throw new Error(fallbackMessage);
    }
  }

  return response.json() as Promise<T>;
}

export function normalizeRequestErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      const normalized = message.toLowerCase();
      if (
        normalized === "load failed" ||
        normalized === "failed to fetch" ||
        normalized === "networkerror when attempting to fetch resource."
      ) {
        return "无法连接到服务，请确认后端已启动。";
      }

      if (normalized === "the string did not match the expected pattern.") {
        return "接口地址配置无效，请检查前端环境变量 NEXT_PUBLIC_API_BASE_URL。";
      }

      if (
        normalized.includes("invalid url") ||
        normalized.includes("failed to parse url")
      ) {
        return "接口地址配置无效，请检查前端环境变量 NEXT_PUBLIC_API_BASE_URL。";
      }

      return message;
    }
  }

  return "无法连接到服务，请确认后端已启动。";
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  try {
    // 统一注入门户与 tab 级会话头：本文件所有端点共用此通道，缺 X-Web-Token 时
    // 后端回退共享 cookie——cookie 被其他标签页登录覆盖就会身份错位（403 无权访问）。
    const headers = new Headers(init?.headers);
    headers.set("X-Portal", "web");
    const token = getWebToken();
    if (token) headers.set("X-Web-Token", token);
    const response = await fetch(input, { ...init, headers, credentials: init?.credentials ?? "include" });
    return await parseJsonResponse<T>(response);
  } catch (error) {
    throw new Error(normalizeRequestErrorMessage(error));
  }
}

export async function login(credentials: {
  username: string;
  password: string;
}): Promise<{ access_token: string; role: string; username: string }> {
  const result = await requestJson<{ access_token: string; role: string; username: string }>(
    `${API_BASE}/auth/login`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    },
  );
  // 单设备登录：tab 级会话标识 + 被顶下线回登录页时的账号密码预填
  rememberWebSession(result.access_token);
  saveLoginPrefill(credentials.username, credentials.password);
  return result;
}

/** 登录历史记录 */
export type LoginHistoryItem = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export async function fetchLoginHistory(): Promise<LoginHistoryItem[]> {
  return requestJson<LoginHistoryItem[]>(`${API_BASE}/auth/me/login-history`, {
    credentials: 'include',
    cache: 'no-store',
  });
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/me`, {
      credentials: "include",
      cache: "no-store",
      headers: { "X-Portal": "web", ...(getWebToken() ? { "X-Web-Token": getWebToken()! } : {}) },
    });
  } catch (error) {
    throw new Error(normalizeRequestErrorMessage(error));
  }
  // 单设备登录（2026-08-21）：此函数走裸 fetch（不经 @water-erp/client 的 on401），
  // 被顶下线/冻结时需在此兜底弹提示——否则 app-shell 只会静默置空用户。
  if (response.status === 401 && typeof window !== "undefined") {
    let code = "";
    let message = "";
    try {
      const body = await response.clone().json();
      code = body?.code ?? "";
      message = body?.error ?? "";
    } catch {
      /* 非 JSON 响应忽略 */
    }
    if (code === "SESSION_REPLACED") {
      const { showSessionReplacedOverlay } = await import("@/lib/session-kick");
      showSessionReplacedOverlay(message);
      throw new Error(message || "登录已失效");
    }
    if (code === "ACCOUNT_FROZEN") {
      const { showFrozenOverlay } = await import("@/lib/session-kick");
      showFrozenOverlay(message);
      throw new Error(message || "账号已被冻结");
    }
  }
  return parseJsonResponse<AuthUser>(response);
}

export async function requestPasswordChange(payload: {
  currentPassword: string;
  newPassword: string;
}) {
  return requestJson<{
    id: string;
    status: "PENDING";
    requestedAt: string;
  }>(`${API_BASE}/auth/password-change-requests`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function requestPasswordReset(payload: {
  username: string;
  applicantName: string;
  applicantContact: string;
}) {
  return requestJson<{
    id: string;
    requestedUsername: string;
    applicantName: string;
    applicantContact: string;
    matchedUserId: string | null;
    status: "PENDING";
    requestedAt: string;
  }>(`${API_BASE}/auth/password-reset-requests`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export type PendingPasswordChangeRequest = {
  id: string;
  status: "PENDING";
  requestedAt: string;
  decisionNote: string | null;
  user: AuthUser;
};

export async function fetchPendingPasswordChangeRequests() {
  return requestJson<PendingPasswordChangeRequest[]>(
    `${API_BASE}/auth/admin/password-change-requests`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );
}

export type PendingPasswordResetRequest = {
  id: string;
  requestedUsername: string;
  applicantName: string;
  applicantContact: string;
  status: "PENDING";
  requestedAt: string;
  decisionNote: string | null;
  matchedUser: AuthUser | null;
};

export async function fetchPendingPasswordResetRequests() {
  return requestJson<PendingPasswordResetRequest[]>(
    `${API_BASE}/auth/admin/password-reset-requests`,
    {
      credentials: "include",
      cache: "no-store",
    },
  );
}

export async function approvePasswordChangeRequest(id: string) {
  return requestJson<{
    id: string;
    status: "APPROVED";
    reviewedAt: string;
  }>(`${API_BASE}/auth/admin/password-change-requests/${id}/approve`, {
    method: "POST",
    credentials: "include",
  });
}

export async function approvePasswordResetRequest(id: string) {
  return requestJson<{
    id: string;
    requestedUsername: string;
    status: "APPROVED";
    reviewedById: string;
    reviewedAt: string;
    temporaryPassword: string;
  }>(`${API_BASE}/auth/admin/password-reset-requests/${id}/approve`, {
    method: "POST",
    credentials: "include",
  });
}

export async function rejectPasswordChangeRequest(
  id: string,
  decisionNote?: string,
) {
  return requestJson<{
    id: string;
    status: "REJECTED";
    reviewedAt: string;
    decisionNote?: string | null;
  }>(`${API_BASE}/auth/admin/password-change-requests/${id}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisionNote }),
  });
}

export async function rejectPasswordResetRequest(
  id: string,
  decisionNote?: string,
) {
  return requestJson<{
    id: string;
    requestedUsername: string;
    status: "REJECTED";
    reviewedAt: string;
    decisionNote?: string | null;
  }>(`${API_BASE}/auth/admin/password-reset-requests/${id}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisionNote }),
  });
}

// ── 资料变更申请（所有资料修改一律走审批）──

export type ProfileChangePayload = Partial<
  Record<"displayName" | "email" | "phone" | "officeLocation" | "company" | "departmentId" | "avatar", string | null>
>;

export async function submitProfileChange(
  payload: ProfileChangePayload,
): Promise<{ id: string; status: "PENDING"; requestedAt: string }> {
  return requestJson<{ id: string; status: "PENDING"; requestedAt: string }>(
    `${API_BASE}/auth/profile-change-requests`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

/** 管理端：待审批资料变更（user 为当前值=旧值对照） */
export type PendingProfileChange = {
  id: string;
  payload: ProfileChangePayload;
  status: "PENDING";
  requestedAt: string;
  decisionNote: string | null;
  user: {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    officeLocation: string | null;
    company: string | null;
    departmentId: string | null;
    avatar: string | null;
    role: AuthRole;
  };
};

export async function fetchPendingProfileChanges(): Promise<PendingProfileChange[]> {
  return requestJson<PendingProfileChange[]>(`${API_BASE}/auth/admin/profile-change-requests`, {
    credentials: "include",
    cache: "no-store",
  });
}

export async function approveProfileChange(id: string) {
  return requestJson<{ id: string; status: string; reviewedAt: string; username: string }>(
    `${API_BASE}/auth/admin/profile-change-requests/${id}/approve`,
    { method: "POST", credentials: "include" },
  );
}

export async function rejectProfileChange(id: string, note?: string) {
  return requestJson<{ id: string; status: string; reviewedAt: string }>(
    `${API_BASE}/auth/admin/profile-change-requests/${id}/reject`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    },
  );
}

export async function logout() {
  const result = await requestJson<{ success: true }>(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  // 手动登出：不保留密码预填、会话标识失效（被顶下线路径另行保留预填）
  clearLoginPrefill();
  clearWebToken();
  return result;
}

export async function updateMyProfile(
  payload: UpdateProfileInput,
): Promise<AuthUser> {
  return requestJson<AuthUser>(`${API_BASE}/auth/me`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchDepartments(): Promise<DepartmentItem[]> {
  return requestJson<DepartmentItem[]>(`${API_BASE}/auth/departments`, {
    credentials: 'include',
    cache: 'no-store',
  });
}

// ── 注册 ──

export type RegisterPayload = {
  username: string;
  displayName: string;
  password: string;
  company: string;
  department: string;
  email?: string;
  phone: string;
  officeLocation?: string;
  verificationCode: string;
  requestedRole: string;
};

export async function sendRegistrationCode(phone: string): Promise<{ maskedPhone: string }> {
  return requestJson<{ maskedPhone: string }>(`${API_BASE}/verification/send-registration-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
}

/** 已知公司列表（注册下拉建议）*/
export async function fetchRegistrationCompanies(): Promise<string[]> {
  return requestJson<string[]>(`${API_BASE}/auth/companies`, { cache: "no-store" });
}

// ── 注册审核 ──

export type PendingRegistration = {
  id: string;
  username: string;
  displayName: string;
  company: string;
  departmentName: string | null;
  phone: string;
  email: string | null;
  officeLocation: string | null;
  requestedRole: string | null;
  createdAt: string;
};

export type RegistrationReview = {
  id: string;
  username: string;
  displayName: string;
  company: string;
  department: string | null;
  phone: string;
  email: string | null;
  officeLocation: string | null;
  requestedRole: string;
  decision: "APPROVED" | "REJECTED";
  decisionNote: string | null;
  reviewedByName: string | null;
  reviewedAt: string;
};

export async function fetchPendingRegistrations(): Promise<PendingRegistration[]> {
  return requestJson<PendingRegistration[]>(`${API_BASE}/auth/pending-registrations`, {
    credentials: "include",
    cache: "no-store",
  });
}

export async function fetchRegistrationReviews(): Promise<RegistrationReview[]> {
  return requestJson<RegistrationReview[]>(`${API_BASE}/auth/registration-reviews`, {
    credentials: "include",
    cache: "no-store",
  });
}

export async function approveRegistration(userId: string) {
  return requestJson<{ ok: boolean }>(`${API_BASE}/auth/users/${userId}/approve`, {
    method: "POST",
    credentials: "include",
  });
}

export async function rejectRegistration(userId: string, note?: string) {
  return requestJson<{ ok: boolean }>(`${API_BASE}/auth/users/${userId}/reject`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

export async function registerUser(payload: RegisterPayload): Promise<{ pending: true }> {
  return requestJson<{ pending: true }>(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
