"use client";

import { NotificationProvider } from "@/lib/notification-context";
import { SupplierStatusProvider } from "@/lib/supplier-status-context";
import { AppShell } from "@/components/shell/app-shell";

/** 受保护路由组外壳：通知（30s 轮询）+ 供应商状态（isTemporary 菜单分支）+ 门户框架 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      <SupplierStatusProvider>
        <AppShell>{children}</AppShell>
      </SupplierStatusProvider>
    </NotificationProvider>
  );
}
