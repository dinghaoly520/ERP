"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { UserSettingsProvider } from "@/lib/user-settings-context";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";

const routeToKey: Record<string, string> = {
  "/dashboard": "dashboard",
  "/progress": "progress",
  "/procurements": "procurements",
  "/projects": "projects",
  "/work-arrangements": "work-arrangements",
  "/profile": "personal-center",
  "/tender-write": "tender-write",
  "/tender-review": "tender-review",
  "/smart-bid": "smart-bid",
  "/bid-analysis": "bid-analysis",
  "/assistant": "assistant",
  "/admin/password-requests": "password-requests",
};

const routeToModule: Record<string, string> = {
  "/dashboard": "数据库",
  "/progress": "采购进度",
  "/procurements": "采购台账",
  "/projects": "项目管理",
  "/work-arrangements": "工作台",
  "/profile": "个人中心",
  "/tender-write": "采购文件编写",
  "/tender-review": "采购文件审查",
  "/bid-analysis": "投标文件分析",
  "/smart-bid": "智能投标",
  "/assistant": "水叮当助手",
  "/admin/password-requests": "密码审批",
};

const childrenScrollRoutes = new Set(["/tender-write", "/assistant"]);

function AssistantLayoutInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setPageContext } = useAssistant();

  useEffect(() => {
    const module = routeToModule[pathname] ?? pathname;
    setPageContext({ currentPage: pathname, currentModule: module });
  }, [pathname, setPageContext]);

  const activeKey =
    Object.entries(routeToKey).find(
      ([route]) => pathname === route || pathname.startsWith(`${route}/`),
    )?.[1] ?? "dashboard";

  const isChildrenScrollMode =
    childrenScrollRoutes.has(pathname) ||
    childrenScrollRoutes.has(
      Object.keys(routeToKey).find((route) => pathname.startsWith(`${route}/`)) ?? "",
    );

  return (
    <>
      <AppShell activeKey={activeKey} bodyScrollMode={isChildrenScrollMode ? "children" : "shell"}>
        {children}
      </AppShell>
    </>
  );
}

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <UserSettingsProvider>
      <AssistantProvider>
        <AssistantLayoutInner>{children}</AssistantLayoutInner>
      </AssistantProvider>
    </UserSettingsProvider>
  );
}
