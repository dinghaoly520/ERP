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
  "/bid-analysis": "bid-analysis",
  "/assistant": "assistant",
  "/admin/password-requests": "password-requests",
  // 公告管理
  "/notice": "notice",
  "/notifications": "notifications",
  // 供应商管理
  "/supplier/approval": "supplier-approval",
  "/supplier/repository": "supplier-repo",
  "/supplier/selection": "supplier-select",
  "/supplier/evaluation": "supplier-eval",
  "/supplier": "supplier-approval",
  // 专家管理
  "/expert/entry": "expert-entry",
  "/expert/repository": "expert-repo",
  "/expert/extract": "expert-extract",
  "/expert/evaluation": "expert-eval",
  "/expert": "expert-entry",
  // 集中目录管理：catalog=管理主页(9页签)、central-catalog=只读健康度概览，各自独立侧边键。
  // central-catalog 前缀更长，必须放在 /mall-management 之前，否则被通配吃到 mall-catalog（高亮跑偏到「目录管理」）。
  "/mall-management/central-catalog": "mall-central-catalog",
  "/mall-management": "mall-catalog",
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
  "/assistant": "水叮当助手",
  "/admin/password-requests": "密码审批",
  "/notice": "信息发布中心",
  "/notifications": "通知中心",
  "/supplier": "供应商管理",
  "/expert": "专家管理",
  "/mall-management": "集中目录管理",
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
