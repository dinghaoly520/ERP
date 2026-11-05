export function validateLoginCredentials(username: string, password: string): string | null {
  if (!username.trim()) return "请输入用户名";
  if (!password) return "请输入密码";
  // 登录只校验是否填写。密码强度策略仅适用于创建或重置密码，兼容历史账号。
  return null;
}

export function getRegistrationDraftKey(userId: string | null | undefined): string | null {
  return userId ? `register:${userId}` : null;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    const dataError = (error as { data?: { error?: unknown } }).data?.error;
    if (typeof dataError === "string" && dataError.trim()) return dataError;
  }
  return fallback;
}
