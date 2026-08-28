"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { SessionWatchdog } from "@/components/session-watchdog";
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
  "/assistant": "assistant",
  "/admin/password-requests": "accounts",
  "/admin/accounts": "accounts",
  "/admin/registration-review": "accounts",
  "/admin/crypto": "crypto",
  // 公告管理
  "/notice": "notice",
  "/clar-notice": "clar-notice",
  "/notifications": "notifications",
  // 供应商管理
  "/supplier/approval": "supplier-approval",
  "/supplier/repository": "supplier-repo",
  "/supplier/dashboard": "supplier-repo",
  "/supplier/selection": "supplier-select",
  "/supplier/elimination": "supplier-repo",
  "/supplier/qualification-alerts": "supplier-repo",
  "/supplier": "supplier-approval",
  // 专家管理
  "/expert/entry": "expert-entry",
  "/expert/repository": "expert-repo",
  "/expert/extract": "expert-extract",
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
  "/assistant": "水叮当助手",
  "/admin/password-requests": "密码审批",
  "/admin/accounts": "账号管理",
  "/admin/crypto": "加密管理",
  "/notice": "信息发布中心",
  "/clar-notice": "澄清说明",
  "/notifications": "通知中心",
  "/supplier": "供应商管理",
  "/expert": "专家管理",
  "/mall-management": "集中目录管理",
};

// 这些路由是「整页占满 + 内部自滚动」的工作区型页面：page 根用 flex-1 撑高，
// 必须走 children 模式（包裹层=flex flex-1 min-h-0 flex-col，flex-1 才解析成有界高度）。
// shell 模式下包裹层是 min-h-full 的 block，flex-1 失效 → 内部 panel 塌成内容高度、填不到页面底部。
const childrenScrollRoutes = new Set(["/tender-write", "/assistant", "/tender-review"]);

// 供应商 / 专家下的已知子路径（非这些段即视为详情页 :id）
const SUPPLIER_SUB_PATHS = new Set([
  "approval",
  "repository",
  "selection",
  "evaluation",
  "dashboard",
  "elimination",
  "qualification-alerts",
]);
const EXPERT_SUB_PATHS = new Set([
  "entry",
  "repository",
  "extract",
  "evaluation",
  "ranking",
  "retirement",
  "statistics",
]);

function resolveActiveKey(pathname: string): string {
  // 详情页：/supplier/:id → 供应商库、/expert/:id → 专家库
  // 详情页路由在 routeToKey 中无精确条目，会被兜底的 /supplier、/expert 误匹配到审批/入口；
  // 这里提前识别，让左侧工具栏保持在「库」上。
  const supplierDetail = pathname.match(/^\/supplier\/([^/]+)$/);
  if (supplierDetail && !SUPPLIER_SUB_PATHS.has(supplierDetail[1])) {
    return "supplier-repo";
  }
  const expertDetail = pathname.match(/^\/expert\/([^/]+)$/);
  if (expertDetail && !EXPERT_SUB_PATHS.has(expertDetail[1])) {
    return "expert-repo";
  }
  return (
    Object.entries(routeToKey).find(
      ([route]) => pathname === route || pathname.startsWith(`${route}/`),
    )?.[1] ?? "dashboard"
  );
}

function AssistantLayoutInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setPageContext } = useAssistant();

  useEffect(() => {
    const module = routeToModule[pathname] ?? pathname;
    setPageContext({ currentPage: pathname, currentModule: module });
  }, [pathname, setPageContext]);

  const activeKey = resolveActiveKey(pathname);

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
        <SessionWatchdog />
        <AssistantLayoutInner>{children}</AssistantLayoutInner>
      </AssistantProvider>
    </UserSettingsProvider>
  );
}
