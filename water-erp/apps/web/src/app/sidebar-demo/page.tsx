"use client";

/**
 * 侧栏「当前组」区分方案演示页（/sidebar-demo）
 *
 * 纯演示用途：三栏并排对比「现状 / 方案A 非当前组降权 / 方案B 当前组浅井」，
 * 点击任意面板的菜单项，三个面板联动切换「当前组」，便于横向对比效果。
 * 本页为独立新增文件，不引用也不改动线上 AppShell。
 */

import { useState } from "react";
import {
  Bell,
  Boxes,
  Building2,
  ChevronsLeft,
  FileEdit,
  FileSearch,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";
import styles from "./sidebar-demo.module.css";

type DemoItem = { key: string; label: string; icon: typeof Bell };
type DemoGroup = { key: string; label: string; icon: typeof Bell; items: DemoItem[] };

/* 与线上 navGroups 同源的静态副本（leader 视角 6 组 16 项） */
const demoGroups: DemoGroup[] = [
  {
    key: "personal-center",
    label: "个人中心",
    icon: UserRound,
    items: [
      { key: "work-arrangements", label: "工作台", icon: UserRound },
      { key: "personal-center", label: "个人中心", icon: UserRound },
      { key: "assistant", label: "水叮当助手", icon: Sparkles },
    ],
  },
  {
    key: "cockpit",
    label: "驾驶舱",
    icon: LayoutDashboard,
    items: [
      { key: "dashboard", label: "数据库", icon: LayoutDashboard },
      { key: "procurements", label: "采购台账", icon: FolderKanban },
      { key: "progress", label: "采购进度", icon: TrendingUp },
    ],
  },
  {
    key: "procurement",
    label: "采购业务",
    icon: FolderKanban,
    items: [
      { key: "projects", label: "项目管理", icon: FolderOpen },
      { key: "tender-write", label: "采购文件编写", icon: FileEdit },
      { key: "tender-review", label: "采购文件审查", icon: FileSearch },
    ],
  },
  {
    key: "announcement",
    label: "信息管理",
    icon: Megaphone,
    items: [
      { key: "notice", label: "公告发布中心", icon: Megaphone },
      { key: "notifications", label: "通知管理", icon: Bell },
      { key: "clar-notice", label: "澄清说明", icon: MessageSquare },
    ],
  },
  {
    key: "resource-mgmt",
    label: "资源管理",
    icon: Boxes,
    items: [
      { key: "supplier-repo", label: "供应商管理", icon: Building2 },
      { key: "expert-repo", label: "专家管理", icon: Users },
    ],
  },
  {
    key: "catalog-mgmt",
    label: "集中目录管理",
    icon: ShoppingBag,
    items: [
      { key: "mall-central-catalog", label: "集中采购目录", icon: ShoppingBag },
      { key: "mall-catalog", label: "目录管理", icon: ShoppingBag },
    ],
  },
];

type Variant = "current" | "dim" | "well";

function SidebarMock({
  variant,
  activeKey,
  onSelect,
}: {
  variant: Variant;
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <aside className="sidebar-card flex h-[560px] w-[240px] shrink-0 flex-col rounded-[24px] pr-2">
      <div
        aria-hidden
        className="mx-3.5 mt-4 h-px bg-[linear-gradient(90deg,transparent,rgba(160,178,210,0.70),transparent)]"
      />

      <nav className="sidebar-scroll sidebar-nav mt-1.5 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {demoGroups.map((group) => {
          const GroupIcon = group.icon;
          const isCurrent = group.items.some((item) => item.key === activeKey);

          return (
            <div key={group.key} className="mb-0.5">
              <button
                type="button"
                data-has-active={isCurrent ? "true" : "false"}
                className="sidebar-group-header flex w-full items-center gap-2 rounded-[12px] px-2 py-1.5 text-left"
              >
                <GroupIcon size={13} className="shrink-0 text-[color:var(--muted-foreground)]" />
                <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                  {group.label}
                </span>
              </button>

              <div className="sidebar-group-panel is-open ml-1 pl-1.5">
                <div className={`space-y-0.5 ${variant === "well" && isCurrent ? styles.well : ""}`}>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = item.key === activeKey;
                    const dimmed = variant === "dim" && !isCurrent;

                    return (
                      <button
                        key={item.key}
                        type="button"
                        data-active={active}
                        onClick={() => onSelect(item.key)}
                        className={`sidebar-nav-item group relative ${dimmed ? styles.dimItem : ""}`}
                      >
                        {active ? (
                          <span className="nav-active-skew absolute bottom-2 left-[2px] top-2 w-[2.5px]" />
                        ) : null}
                        <Icon size={16} className="shrink-0" />
                        <span className="sidebar-item-label min-w-0 flex-1 truncate text-left text-sm font-medium">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      <div
        aria-hidden
        className="mx-3.5 h-px bg-[linear-gradient(90deg,transparent,rgba(160,178,210,0.70),transparent)]"
      />
      <div className="shrink-0 px-2 pb-2 pt-1">
        <button type="button" className="sidebar-nav-item justify-center" aria-label="收起菜单栏">
          <ChevronsLeft size={16} className="shrink-0" />
        </button>
      </div>
    </aside>
  );
}

const panels: { variant: Variant; title: string; desc: string }[] = [
  {
    variant: "current",
    title: "现状",
    desc: "蓝组头 + 10px 缩进 + 激活项蓝染；组间无明度差",
  },
  {
    variant: "dim",
    title: "方案A · 非当前组降权",
    desc: "非当前组子项 0.42→0.52（减法）；当前组兄弟项全场最深，0.25s 过渡抹平切换闪动",
  },
  {
    variant: "well",
    title: "方案B · 当前组浅井",
    desc: "当前组子项区加 accent 5% 底板（加法）；结构感更强，但把「面」加了回来",
  },
];

export default function SidebarDemoPage() {
  const [activeKey, setActiveKey] = useState("notifications");

  return (
    <div className="flow-page min-h-screen">
      <main className="mx-auto max-w-[1280px] px-6 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
          侧栏「当前组」区分方案对比
        </h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
          点击任意面板的菜单项，「当前组」三栏联动切换，横向对比效果。演示页为独立新增文件，未改动线上侧栏。
        </p>

        <div className="mt-8 flex flex-wrap items-start gap-6">
          {panels.map((panel) => (
            <section key={panel.variant} className="flex flex-col gap-3">
              <header>
                <h2 className="text-base font-semibold text-[color:var(--foreground)]">{panel.title}</h2>
                <p className="mt-1 max-w-[240px] text-xs leading-5 text-[color:var(--muted-foreground)]">
                  {panel.desc}
                </p>
              </header>
              <SidebarMock variant={panel.variant} activeKey={activeKey} onSelect={setActiveKey} />
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
