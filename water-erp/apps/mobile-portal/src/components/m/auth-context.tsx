"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AuthUser } from "@/lib/api/auth";

/** (main) 布局级用户态——layout 已取 /auth/me，页面经 context 消费（去重：每会话 1 次） */
const AuthCtx = createContext<{ user: AuthUser | null } | null>(null);

export function AuthProvider({ user, children }: { user: AuthUser | null; children: ReactNode }) {
  return <AuthCtx.Provider value={{ user }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): { user: AuthUser | null } {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
