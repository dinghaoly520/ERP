"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  CalendarCheck2,
  FolderKanban,
  LayoutDashboard,
  FileEdit,
  FileSearch,
  FileBarChart,
  Sparkles,
  FolderOpen,
  KeyRound,
  TrendingUp,
  UserRound,
  Building2,
  Users,
  Megaphone,
  ShoppingBag,
  Bell,
  ChevronDown,
} from "lucide-react";
import { AppUserActions } from "@/components/app-user-actions";
import { fetchCurrentUser, type AuthRole, type AuthUser } from "@/lib/api/auth";

type NavItem = {
  key: string;
  label: string;
  href: string;
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
    key: "overview",
    label: "工作总览",
    icon: LayoutDashboard,
    items: [
      { key: "dashboard", label: "首页驾驶舱", href: "/dashboard", icon: LayoutDashboard, meta: "运营总览" },
      { key: "progress", label: "采购进度", href: "/progress", icon: TrendingUp, meta: "项目进度统计", roles: ["admin", "leader"] },
      { key: "work-arrangements", label: "个人中心", href: "/work-arrangements", icon: UserRound, meta: "工作安排" },
    ],
  },
  {
    key: "procurement",
    label: "采购业务",
    icon: FolderKanban,
    items: [
      { key: "procurements", label: "采购台账", href: "/procurements", icon: FolderKanban, meta: "事项追踪" },
      { key: "projects", label: "项目管理", href: "/projects", icon: FolderOpen, meta: "项目全生命周期" },
      { key: "tender-write", label: "招标文件编写", href: "/tender-write", icon: FileEdit, meta: "AI辅助编写" },
      { key: "tender-review", label: "招标文件审查", href: "/tender-review", icon: FileSearch, meta: "合规性审查" },
      { key: "bid-analysis", label: "投标文件分析", href: "/bid-analysis", icon: FileBarChart, meta: "智能评分分析" },
    ],
  },
  {
    key: "supplier-mgmt",
    label: "供应商管理",
    icon: Building2,
    items: [
      { key: "supplier-approval", label: "供应商审批", href: "/supplier/approval", icon: Building2, meta: "入库审核" },
      { key: "supplier-repo", label: "供应商库", href: "/supplier/repository", icon: Building2, meta: "资源池管理" },
      { key: "supplier-select", label: "供应商选取", href: "/supplier/selection", icon: Building2, meta: "智能匹配" },
      { key: "supplier-eval", label: "供应商评价", href: "/supplier/evaluation", icon: Building2, meta: "绩效管理" },
    ],
  },
  {
    key: "expert-mgmt",
    label: "专家管理",
    icon: Users,
    items: [
      { key: "expert-entry", label: "专家录入", href: "/expert/entry", icon: Users, meta: "新建专家" },
      { key: "expert-repo", label: "专家库", href: "/expert/repository", icon: Users, meta: "专家资源" },
      { key: "expert-extract", label: "专家抽取", href: "/expert/extract", icon: Users, meta: "随机/手动" },
      { key: "expert-eval", label: "专家评价", href: "/expert/evaluation", icon: Users, meta: "履职考核" },
    ],
  },
  {
    key: "notice-mgmt",
    label: "信息发布",
    icon: Megaphone,
    items: [
      { key: "notice", label: "信息发布中心", href: "/notice", icon: Megaphone, meta: "公告/公示/政策" },
      { key: "notifications", label: "通知中心", href: "/notifications", icon: Bell, meta: "消息提醒" },
    ],
  },
  {
    key: "mall-mgmt",
    label: "电子商城管理",
    icon: ShoppingBag,
    items: [
      { key: "mall-approval", label: "价格审批", href: "/mall-management/approval", icon: ShoppingBag, meta: "供货审核" },
      { key: "mall-price", label: "价格录入", href: "/mall-management/price-entry", icon: ShoppingBag, meta: "手动/导入" },
      { key: "mall-catalog", label: "目录管理", href: "/mall-management/catalog", icon: ShoppingBag, meta: "采购目录" },
      { key: "mall-logs", label: "操作日志", href: "/mall-management/logs", icon: ShoppingBag, meta: "同步记录" },
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
  const router = useRouter();
  const hasPageHeader = Boolean(title || description);
  const [resolvedUser, setResolvedUser] = useState<AuthUser | null | undefined>(undefined);
  const [headerVisible, setHeaderVisible] = useState(true);
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
    <div className="ambient-grid h-full overflow-hidden px-2.5 py-2.5 sm:px-3.5 lg:px-4">
      <div className="mx-auto flex h-full w-full gap-4 overflow-hidden">
        <aside className="sidebar-sheen panel-surface chromatic-glass glass-calm glass-float hidden h-full w-[256px] shrink-0 flex-col rounded-[24px] p-2 lg:flex">
          <div className="glass-spectrum glass-spectrum-soft rounded-[18px] border border-white/60 bg-white/72 p-3">
            <div className="flex items-center gap-3">
              <div className="command-orb flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(241,245,251,0.88))] shadow-[0_10px_18px_rgba(63,96,156,0.08)]">
                <Image
                  src="/procurement-brand-logo.png"
                  alt="智慧水发·蜀水云采"
                  width={36}
                  height={36}
                  className="rounded-[10px] object-cover"
                  priority
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-[0.96rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                  智慧水发·采购中心
                </div>
              </div>
            </div>
          </div>

          <nav className="glass-spectrum glass-spectrum-soft mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto rounded-[18px] border border-white/50 bg-white/46 p-1.5">
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
                    className="flex w-full items-center gap-2 rounded-[12px] px-2 py-1.5 text-left transition-colors hover:bg-white/50"
                  >
                    <GroupIcon size={14} className="shrink-0 text-[color:var(--muted-foreground)]" />
                    <span className="flex-1 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
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
                  {!isCollapsed && (
                    <div className="ml-1 space-y-0.5 border-l border-white/40 pl-1.5">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = item.key === activeKey;

                        return (
                          <Link
                            key={item.key}
                            href={item.href}
                            data-active={active}
                            className={[
                              "nav-glow hover-lift interactive-surface group relative flex items-center gap-2.5 overflow-hidden rounded-[12px] px-2.5 py-1.5 transition-all duration-300",
                              active
                                ? "bg-[linear-gradient(135deg,rgba(255,255,255,0.76),rgba(242,246,255,0.62))] text-[color:var(--foreground)] shadow-[0_8px_16px_rgba(54,84,140,0.06)]"
                                : "text-[color:var(--muted-foreground)] hover:bg-white/72 hover:text-[color:var(--foreground)]",
                            ].join(" ")}
                          >
                            {active ? (
                              <span className="absolute bottom-auto left-[4px] top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-[rgba(72,120,235,0.92)]" />
                            ) : null}

                            <span
                              className={[
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border transition-all duration-300",
                                active
                                  ? "border-white/75 bg-[rgba(239,245,255,0.96)] text-[color:var(--accent)]"
                                  : "border-white/45 bg-white/34 group-hover:border-white/70 group-hover:bg-white/70",
                              ].join(" ")}
                            >
                              <Icon size={16} />
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold">{item.label}</div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="mt-2 hidden lg:block">
            <AppUserActions layout="sidebar" />
          </div>
        </aside>

        <section className="min-h-0 flex flex-1 overflow-hidden">
          <main className="panel-surface panel-lens chromatic-glass glass-calm glass-float relative z-10 h-full min-h-0 flex flex-1 flex-col overflow-hidden rounded-[24px] p-3.5 sm:p-4 lg:p-4">
            <div className="pointer-events-none absolute bottom-6 left-[-18px] top-6 hidden w-[24px] lg:block">
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[linear-gradient(180deg,rgba(137,164,214,0.14),rgba(137,164,214,0.46),rgba(137,164,214,0.12))]" />
              <div className="absolute inset-y-8 left-1/2 w-[18px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(153,182,242,0.22),rgba(153,182,242,0.04)_58%,transparent_72%)] blur-md" />
            </div>
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.92),rgba(255,255,255,0))]" />

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
                        href={item.href}
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

                {hasPageHeader ? (
                  <header
                    className={[
                      "grid gap-2.5 overflow-hidden transition-all duration-500 2xl:grid-cols-[1.1fr_0.9fr] 2xl:items-end",
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
      </div>
    </div>
  );
}
