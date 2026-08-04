"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  FolderKanban,
  LayoutDashboard,
  FileEdit,
  FileSearch,
  Sparkles,
  FolderOpen,
  KeyRound,
  TrendingUp,
  UserRound,
  Building2,
  Users,
  Megaphone,
  MessageSquare,
  ShoppingBag,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AppUserActions } from "@/components/app-user-actions";
import { UnifiedHeader } from "@/components/workbench/unified-header";
import { GlobalSearch } from "@/components/global-search";
import { fetchCurrentUser, type AuthRole, type AuthUser } from "@/lib/api/auth";
import { ChatPanel } from "@/components/assistant/chat-panel";

type NavItem = {
  key: string;
  label: string;
  href?: string;
  icon: typeof LayoutDashboard;
  meta?: string;
  roles?: AuthRole[];
};

type NavGroup = {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
  items: NavItem[];
  roles?: AuthRole[];
};

const navGroups: NavGroup[] = [
  {
    key: "personal-center",
    label: "个人中心",
    icon: UserRound,
    items: [
      { key: "work-arrangements", label: "工作台", href: "/work-arrangements", icon: UserRound, meta: "工作安排" },
      { key: "personal-center", label: "个人中心", href: "/profile", icon: UserRound, meta: "管理个人资料与偏好" },
      { key: "assistant", label: "水叮当助手", href: "/assistant", icon: Sparkles, meta: "AI智能助手" },
    ],
  },
  {
    key: "cockpit",
    label: "驾驶舱",
    icon: LayoutDashboard,
    items: [
      { key: "dashboard", label: "数据库", href: "/dashboard", icon: LayoutDashboard, meta: "运营总览" },
      { key: "procurements", label: "采购台账", href: "/procurements", icon: FolderKanban, meta: "事项追踪" },
      { key: "progress", label: "采购进度", href: "/progress", icon: TrendingUp, meta: "项目进度统计", roles: ["admin", "leader"] },
    ],
  },
  {
    key: "procurement",
    label: "采购业务",
    icon: FolderKanban,
    items: [
      { key: "projects", label: "项目管理", href: "/projects", icon: FolderOpen, meta: "项目全生命周期" },
      { key: "tender-write", label: "采购文件编写", href: "/tender-write", icon: FileEdit, meta: "AI辅助编写" },
      { key: "tender-review", label: "采购文件审查", href: "/tender-review", icon: FileSearch, meta: "合规性审查" },
    ],
  },
  {
    key: "announcement",
    label: "公告管理",
    icon: Megaphone,
    items: [
      { key: "notice", label: "信息发布中心", href: "/notice", icon: Megaphone, meta: "公告/公示/政策" },
      { key: "clar-notice", label: "澄清说明", href: "/clar-notice", icon: MessageSquare, meta: "供应商端展示文案", roles: ["admin", "bid_host", "leader", "staff"] },
    ],
  },
  {
    key: "supplier-mgmt",
    label: "供应商管理",
    icon: Building2,
    items: [
      { key: "supplier-repo", label: "供应商库", href: "/supplier/repository", icon: Building2, meta: "资源池管理" },
      { key: "supplier-eval", label: "供应商评价", href: "/supplier/evaluation", icon: Building2, meta: "绩效管理" },
    ],
  },
  {
    key: "expert-mgmt",
    label: "专家管理",
    icon: Users,
    items: [
      { key: "expert-repo", label: "专家库", href: "/expert/repository", icon: Users, meta: "专家资源" },
      { key: "expert-eval", label: "专家评价", href: "/expert/evaluation", icon: Users, meta: "履职考核" },
    ],
  },
  {
    key: "catalog-mgmt",
    label: "集中目录管理",
    icon: ShoppingBag,
    items: [
      { key: "mall-central-catalog", label: "集中采购目录", href: "/mall-management/central-catalog", icon: ShoppingBag, meta: "浏览目录" },
      { key: "mall-catalog", label: "目录管理", href: "/mall-management/catalog", icon: ShoppingBag, meta: "管理中心" },
    ],
  },
  {
    key: "admin",
    label: "系统管理",
    icon: KeyRound,
    items: [
      { key: "password-requests", label: "密码审批", href: "/admin/password-requests", icon: KeyRound, meta: "账号安全", roles: ["admin"] },
    ],
    roles: ["admin"],
  },
];

const SWDG_USERNAME = "SWDG-01";
const SWDG_NAV_KEYS = new Set(["tender-write", "tender-review", "bid-analysis"]);

const CHAIRMAN_USERNAME = "Swhi-CGZX-00";
const CHAIRMAN_NAV_KEYS = new Set(["work-arrangements", "dashboard", "progress", "procurements", "projects"]);

type AppShellProps = {
  activeKey: string;
  title?: string;
  description?: string;
  autoHideHeader?: boolean;
  currentUserRole?: AuthRole;
  headerActions?: ReactNode;
  bodyScrollMode?: "shell" | "children";
  children: ReactNode;
};

export function AppShell({
  activeKey,
  title,
  description,
  autoHideHeader,
  currentUserRole,
  headerActions,
  bodyScrollMode = "shell",
  children,
}: AppShellProps) {
  const hasPageHeader = Boolean(title || description);
  const [resolvedUser, setResolvedUser] = useState<AuthUser | null | undefined>(undefined);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const effectiveRole = currentUserRole ?? resolvedUser?.role;
  const isUserLoading = currentUserRole === undefined && resolvedUser === undefined;
  const effectiveUsername = resolvedUser?.username;

  useEffect(() => {
    if (currentUserRole !== undefined) {
      return;
    }

    let active = true;

    const loadCurrentUser = async () => {
      try {
        const user = await fetchCurrentUser();
        if (active) {
          setResolvedUser(user);
        }
      } catch {
        if (active) {
          setResolvedUser(null);
        }
      }
    };

    void loadCurrentUser();

    return () => {
      active = false;
    };
  }, [currentUserRole]);

  useEffect(() => {
    if (!autoHideHeader) {
      return;
    }

    const timer = window.setTimeout(() => setHeaderVisible(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [autoHideHeader]);

  // 菜单栏折叠状态持久化（localStorage）
  useEffect(() => {
    const stored = window.localStorage.getItem("app-shell:sidebar-hidden");
    if (stored === "1") setSidebarHidden(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("app-shell:sidebar-hidden", sidebarHidden ? "1" : "0");
  }, [sidebarHidden]);


  // 过滤+展开分组为扁平列表（带 group key 标记），含角色过滤 + 特殊用户过滤
  const visibleGroups = isUserLoading
    ? []
    : navGroups
        .filter((group) => {
          if (!group.roles) return true;
          return !!effectiveRole && group.roles.includes(effectiveRole);
        })
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (effectiveUsername === SWDG_USERNAME && !SWDG_NAV_KEYS.has(item.key)) return false;
            if (effectiveUsername === CHAIRMAN_USERNAME && !CHAIRMAN_NAV_KEYS.has(item.key)) return false;
            if (!item.roles) return true;
            return !!effectiveRole && item.roles.includes(effectiveRole);
          }),
        }))
        .filter((group) => group.items.length > 0);

  // 默认展开含有当前 activeKey 的分组
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  return (
    <div className="flow-page ambient-grid h-full overflow-hidden px-2.5 pb-2.5 sm:px-3.5 lg:pr-4 lg:pl-0">
      {/* cgzxui 水彩光晕 —— 五角 oklch 浅彩 bloom，作为玻璃面板背后漂移的色彩层 */}
      <div className="flow-glow" aria-hidden />
      <div className="mx-auto flex h-full w-full overflow-hidden [perspective:1500px]">
        <aside
          data-hidden={sidebarHidden ? "true" : "false"}
          className="sidebar-sheen sidebar-3d sidebar-card mr-4 hidden h-full w-[268px] shrink-0 flex-col rounded-tl-[24px] rounded-tr-[24px] rounded-bl-none rounded-br-[24px] pr-2 lg:flex"
        >
          <header className="flex flex-col items-center gap-2 px-3.5 pb-3.5 pt-4">
            <div className="command-orb brand-orb-3d flex h-12 w-12 shrink-0 items-center justify-center">
              <Image
                src="/procurement-brand-logo.png"
                alt="智慧水发·蜀水云采"
                width={46}
                height={46}
                className="rounded-[12px] object-cover"
                priority
              />
            </div>

            <div className="w-full text-center">
              <div className="truncate text-[1rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                智慧水发·采购中心
              </div>
            </div>
          </header>

          <div aria-hidden className="mx-3.5 h-px bg-[linear-gradient(90deg,transparent,rgba(160,178,210,0.70),transparent)]" />

          <nav className="sidebar-scroll sidebar-nav mt-1.5 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
            {visibleGroups.map((group) => {
              const GroupIcon = group.icon;
              const isCollapsed = collapsedGroups.has(group.key);
              const hasActiveItem = group.items.some((item) => item.key === activeKey);

              return (
                <div key={group.key} className="mb-0.5">
                  {/* 分组标题 — 可点击折叠 */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="sidebar-group-header flex w-full items-center gap-2 rounded-[12px] px-2 py-1.5 text-left transition-all duration-300"
                  >
                    <GroupIcon size={14} className="shrink-0 text-[color:var(--muted-foreground)]" />
                    <span className="flex-1 text-sm font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
                      {group.label}
                    </span>
                    <ChevronDown
                      size={12}
                      className={`shrink-0 text-[color:var(--muted-foreground)] transition-transform duration-200 ${
                        isCollapsed ? "-rotate-90" : ""
                      }`}
                    />
                  </button>

                  {/* 分组子项 */}
                  <div className={`sidebar-group-panel ml-1 border-l border-white/60 pl-1.5 ${!isCollapsed ? "is-open" : ""}`}>
                      <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = item.key === activeKey;

                        return (
                          <Link
                            key={item.key}
                            href={item.href!}
                            data-active={active}
                            className="sidebar-nav-item group relative"
                          >
                            {active ? (
                              <span className="nav-active-skew absolute bottom-2 left-[2px] top-2 w-[2.5px]" />
                            ) : null}

                            <Icon size={16} className="shrink-0" />

                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                    </div>
                </div>
              );
            })}
          </nav>

          {/* 右边缘折叠手柄 —— 点击向左折叠 */}
          <button
            type="button"
            onClick={() => setSidebarHidden(true)}
            aria-label="收起菜单栏"
            className="sidebar-edge-tab group absolute right-0 top-1/2 z-20 flex h-8 w-[13px] -translate-y-1/2 items-center justify-center rounded-l-[7px] border border-r-0 border-white/85 bg-[linear-gradient(90deg,rgba(241,245,251,0.62),rgba(255,255,255,0.95))] text-[color:var(--muted-foreground)] shadow-[-4px_0_7px_-3px_rgba(69,99,158,0.22)] transition-colors duration-200 hover:bg-white hover:text-[color:var(--accent)]"
          >
            <ChevronLeft size={12} />
          </button>
        </aside>

        {sidebarHidden ? (
          <button
            type="button"
            onClick={() => setSidebarHidden(false)}
            aria-label="展开菜单栏"
            className="sidebar-edge-tab interactive-surface group fixed left-0 top-1/2 z-30 hidden h-8 w-[13px] -translate-y-1/2 items-center justify-center rounded-r-[7px] border border-l-0 border-white/85 bg-[linear-gradient(270deg,rgba(241,245,251,0.62),rgba(255,255,255,0.95))] text-[color:var(--muted-foreground)] shadow-[4px_0_7px_-3px_rgba(69,99,158,0.22)] transition-colors duration-200 hover:bg-white hover:text-[color:var(--accent)] lg:flex"
          >
            <ChevronRight size={12} />
          </button>
        ) : null}

        <section className="min-h-0 flex flex-1 overflow-visible px-1 h-full">
          <main id="app-main" className="relative z-10 h-full min-h-0 flex flex-1 flex-col overflow-visible p-3.5 sm:p-4 lg:p-4">
            <div
              data-app-shell-scroll="true"
              className={[
                "relative min-h-0 flex-1",
                bodyScrollMode === "shell" ? "overflow-y-auto" : "flex flex-col overflow-hidden",
              ].join(" ")}
            >
              <div className={bodyScrollMode === "children" ? "flex flex-1 min-h-0 flex-col" : "min-h-full"}>
                {!hasPageHeader ? (
                  <div className="mb-4 flex justify-end lg:hidden">
                    <AppUserActions />
                  </div>
                ) : null}

                <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
                  {visibleGroups.flatMap((group) => group.items).map((item) => {
                    const Icon = item.icon;
                    const active = item.key === activeKey;

                    return (
                      <Link
                        key={item.key}
                        href={item.href!}
                        className={[
                          "interactive-surface inline-flex min-w-fit items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-all duration-200",
                          active
                            ? "border-white/75 bg-[linear-gradient(145deg,rgba(255,255,255,0.8),rgba(236,242,255,0.72))] text-[color:var(--accent)] shadow-[0_12px_24px_rgba(57,88,142,0.08)]"
                            : "border-white/45 bg-white/42 text-[color:var(--muted-foreground)]",
                        ].join(" ")}
                      >
                        <Icon size={16} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>

                <UnifiedHeader
                  showBack={false}
                  title={hasPageHeader ? title : undefined}
                  description={hasPageHeader ? description : undefined}
                  actions={hasPageHeader ? headerActions : undefined}
                />

                {hasPageHeader ? (
                  <header
                    className={[
                      "grid gap-2.5 overflow-hidden transition-all duration-500 2xl:grid-cols-[1.1fr_0.9fr] 2xl:items-end hidden",
                      headerVisible ? "max-h-[220px] opacity-100" : "max-h-0 pointer-events-none opacity-0",
                    ].join(" ")}
                  >
                    <div className="max-w-4xl">
                      {title ? (
                        <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.65rem,2.8vw,2.85rem)] font-semibold tracking-[-0.06em] text-[color:var(--foreground)]">
                          {title}
                        </h1>
                      ) : null}
                      {description ? (
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--muted-foreground)] sm:text-[15px]">
                          {description}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center justify-start gap-2 lg:hidden 2xl:justify-end">
                      {headerActions ?? <AppUserActions />}
                    </div>
                  </header>
                ) : null}

                <div
                  className={[
                    hasPageHeader && headerVisible ? "mt-3.5" : "",
                    bodyScrollMode === "children"
                      ? "flex flex-1 min-h-0 flex-col"
                      : "min-h-full",
                  ].join(" ")}
                >
                  {children}
                </div>
              </div>
            </div>
          </main>
        </section>
        <ChatPanel variant="mini" />
        <GlobalSearch />
      </div>
    </div>
  );
}
