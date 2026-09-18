"use client";

/**
 * 集中供应商菜单权限逻辑 — 移植自 Vue useSupplierMenu（X-1）。
 * 当前基于 isTemporary 布尔分支，后续扩展为权限矩阵时只需改此文件。
 */
import type { ComponentType } from "react";
import {
  Bell,
  Boxes,
  Building2,
  ClipboardCheck,
  FileCheck,
  FileText,
  History,
  Home,
  IdCard,
  Inbox,
  KeyRound,
  LayoutGrid,
  ListChecks,
  MessageSquareWarning,
  Package,
  ScrollText,
  Trophy,
} from "lucide-react";

export interface WorkspaceTab {
  path: string;
  title: string;
  /** 标题卡下子导航 tab 的图标（SpPageHero 渲染；不配则纯文字） */
  icon?: ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
}

export interface MenuEntry {
  path: string;
  title: string;
  icon: ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  desc: string;
  tabs?: WorkspaceTab[];
  badge?: boolean;
  /** 归属附加路由：命中的 pathname 归属本工作区（父项高亮），但侧栏不渲染子项。
   *  用于子页面不占侧栏、仍需保持模块归属的场景（2026-09-18：可参与项目/资格预审收起）。 */
  extraPaths?: string[];
}

export interface MenuDivider {
  divider: true;
  label: string;
}

export type MenuItem = MenuEntry | MenuDivider;

export function canAccessRegularSupplierWorkspaces(
  isTemporary: boolean | null | undefined,
): boolean {
  return isTemporary === false;
}

/** Finds the most specific exact or descendant route match. */
export function findLongestPathMatch<T extends { path: string }>(
  pathname: string,
  candidates: readonly T[],
): T | null {
  return candidates.reduce<T | null>((best, candidate) => {
    const matches = pathname === candidate.path || pathname.startsWith(`${candidate.path}/`);
    if (!matches || (best && best.path.length >= candidate.path.length)) return best;
    return candidate;
  }, null);
}

/** Resolves a pathname to the workspace that owns its most specific route. */
export function findWorkspaceForPath(
  pathname: string,
  items: readonly MenuItem[],
): MenuEntry | null {
  let best: { workspace: MenuEntry; match: WorkspaceTab } | null = null;

  for (const item of items) {
    if ("divider" in item) continue;
    const match = findWorkspaceTabForPath(pathname, item);
    if (match && (!best || match.path.length > best.match.path.length)) {
      best = { workspace: item, match };
    }
  }

  return best?.workspace ?? null;
}

/** Resolves the most specific tab within a workspace for a pathname. */
export function findWorkspaceTabForPath(
  pathname: string,
  workspace: MenuEntry | null | undefined,
): WorkspaceTab | null {
  if (!workspace) return null;

  const tab = findLongestPathMatch(pathname, workspace.tabs ?? []);
  if (tab) return tab;

  const workspaceMatches = pathname === workspace.path || pathname.startsWith(`${workspace.path}/`)
    || (workspace.extraPaths ?? []).some(
      (extra) => pathname === extra || pathname.startsWith(`${extra}/`),
    );
  return workspaceMatches ? { path: workspace.path, title: workspace.title } : null;
}

/** 供货管理工作区（品类目录/申请进度/供货关系）— 2026-09-17 用户裁定侧栏隐藏：
 *  仅从菜单摘除，页面/路由原样保留（直链与任务跳转仍可达）；恢复时置回 false 即可。 */
const SUPPLY_WORKSPACE_HIDDEN = true;

function supplyWorkspaceEntry(): MenuEntry {
  return {
    path: "/catalog",
    title: "供货管理",
    icon: Package,
    desc: "目录、供货申请与报价",
    tabs: [
      { path: "/catalog", title: "品类目录", icon: LayoutGrid },
      { path: "/catalog-applications", title: "申请进度", icon: ClipboardCheck },
      { path: "/supply", title: "供货关系", icon: Boxes },
    ],
  };
}

export function buildMenuItems(isTemporary: boolean | null | undefined): MenuItem[] {
  const items: MenuItem[] = [
    {
      path: "/dashboard",
      title: "工作台",
      icon: Home,
      desc: "状态与待办总览",
    },
    { divider: true, label: "采购业务" },
    {
      path: "/bids",
      title: "项目机会",
      icon: FileText,
      desc: "发现项目与资格预审",
      // 2026-09-18 用户裁定：可参与项目/资格预审不进侧栏（单入口），资格预审经页面内入口进入
      extraPaths: ["/prequal"],
    },
    {
      path: "/my-bids",
      title: "我的投标",
      icon: FileCheck,
      desc: "跟踪投标与合作历史",
      // 2026-09-18 用户裁定：进行中/已完成不进侧栏（单入口），已完成经页面内入口进入
      extraPaths: ["/completed-projects"],
    },
    {
      path: "/award-letters",
      title: "成交履约",
      icon: Trophy,
      desc: "通知书、合同与框架协议",
      // 2026-09-18 用户裁定：成交通知/合同履约/框架协议不进侧栏（单入口），经页面内入口进入
      extraPaths: ["/contracts", "/frameworks"],
    },
  ];

  if (canAccessRegularSupplierWorkspaces(isTemporary)) {
    items.push({ divider: true, label: "信息维护" });
    if (!SUPPLY_WORKSPACE_HIDDEN) items.push(supplyWorkspaceEntry());
    items.push(
      {
        path: "/profile",
        title: "企业信息",
        icon: Building2,
        desc: "主体资料与变更记录",
        // 2026-09-18 用户裁定：基本资料/变更记录不进侧栏（单入口），变更记录经页面内入口进入
        extraPaths: ["/change-records"],
      },
      {
        path: "/profile/ukey",
        title: "证书与U盾",
        icon: KeyRound,
        desc: "投标加密证书与U盾管理",
      },
    );
  }

  items.push(
    { divider: true, label: "信息服务" },
    {
      path: "/notifications",
      title: "消息中心",
      icon: Inbox,
      desc: "业务消息与站内通知",
      badge: true,
    },
    {
      path: "/announcements",
      title: "公告中心",
      icon: Bell,
      desc: "公告与政策",
    },
    {
      path: "/objections",
      title: "异议投诉",
      icon: MessageSquareWarning,
      desc: "在线提出异议并查看答复",
    },
  );

  return items;
}

