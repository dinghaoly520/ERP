"use client";

import { AuthProvider } from "@/lib/auth-context";
import { SessionWatchdog } from "./session-watchdog";

/** 根级 Provider：认证上下文（会话探测按路由分流，见 auth-context）+ 单设备登录心跳 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SessionWatchdog />
      {children}
    </AuthProvider>
  );
}
