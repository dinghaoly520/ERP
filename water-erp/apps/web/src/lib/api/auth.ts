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
export type AuthRole = "admin" | "leader" | "staff" | "procurement_staff" | "bid_host" | "bid_expert" | "supplier" | "mall";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
  email?: string | null;
  phone?: string | null;
  officeLocation?: string | null;
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
};

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallbackMessage = "请求失败，请稍后重试。";
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        const body = (await response.json()) as { message?: string | string[] };
        const message = Array.isArray(body.message)
          ? body.message[0]
          : body.message;
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
    const response = await fetch(input, init);
    return await parseJsonResponse<T>(response);
  } catch (error) {
    throw new Error(normalizeRequestErrorMessage(error));
  }
}

export async function login(credentials: {
  username: string;
  password: string;
}): Promise<{ access_token: string; role: string; username: string }> {
  return requestJson<{ access_token: string; role: string; username: string }>(
    `${API_BASE}/auth/login`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    },
  );
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  return requestJson<AuthUser>(`${API_BASE}/auth/me`, {
    credentials: "include",
    cache: "no-store",
  });
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

export async function logout() {
  return requestJson<{ success: true }>(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
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
