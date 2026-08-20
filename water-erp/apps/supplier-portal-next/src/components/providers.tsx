"use client";

import { AuthProvider } from "@/lib/auth-context";

/** 根级 Provider：认证上下文（会话探测按路由分流，见 auth-context） */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}
