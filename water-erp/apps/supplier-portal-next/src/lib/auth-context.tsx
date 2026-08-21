"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api";

export type LoginResult = "ok" | "invalid" | "pending" | "expired";

interface AuthContextValue {
  user: any | null;
  ready: boolean;
  isLoggedIn: boolean;
  isSupplier: boolean;
  displayName: string;
  login: (username: string, password: string) => Promise<LoginResult>;
  register: (data: Parameters<typeof authApi.register>[0]) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** 游客/公开路由：这些页面不主动探测会话（等价 Vue 版仅在有缓存时 init） */
const GUEST_PATHS = ["/login", "/register", "/register-temporary", "/rsvp"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [ready, setReady] = useState(false);
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    setPath(window.location.pathname);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.getMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (path === null) return;
    if (GUEST_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
      setReady(true);
      return;
    }
    refresh();
  }, [path, refresh]);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    try {
      const res = await authApi.login({ username, password });
      if (res?.access_token || res) {
        await refresh();
        return "ok";
      }
      return "invalid";
    } catch (e) {
      // 「密码正确但待审核/停用」→ 专用结果，登录页据此显示「查询审核进度」而非误报密码错误
      if (e instanceof ApiError) {
        const code = (e.data as any)?.code;
        if (code === "ACCOUNT_PENDING") return "pending";
        if (code === "TEMPORARY_EXPIRED") return "expired";
      }
      return "invalid";
    }
  }, [refresh]);

  const register = useCallback(async (data: Parameters<typeof authApi.register>[0]) => {
    try {
      await authApi.register(data);
      // 注册后账号需采购侧审核（isActive:false），不自动登录——由调用方跳转状态页等待审核
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch { /* 后端不可达也照常清本地态 */ }
    setUser(null);
    window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        isLoggedIn: !!user,
        isSupplier: user?.role === "supplier",
        displayName: user?.displayName || user?.username || "",
        login,
        register,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
