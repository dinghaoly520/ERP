"use client";

import { NotificationProvider } from "@/lib/notification-context";
import { SupplierStatusProvider } from "@/lib/supplier-status-context";
import { RealtimeNotifications } from "@/components/notification/realtime-notifications";
import { AppShell } from "@/components/shell/app-shell";
import { IdleTimeout } from "@/components/idle-timeout";

/** 受保护路由组外壳：通知（30s 轮询）+ 供应商状态（isTemporary 菜单分支）+ 门户框架 + 12h 空闲自动退出 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      <SupplierStatusProvider>
        <AppShell>{children}</AppShell>
      <RealtimeNotifications />
      <IdleTimeout />
      </SupplierStatusProvider>
    </NotificationProvider>
  );
}
