"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import {
  buildMenuItems,
  findWorkspaceForPath,
  findWorkspaceTabForPath,
} from "@/components/shell/supplier-menu";
import { useSupplierStatus } from "@/lib/supplier-status-context";

type IconType = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;

/** 工作区子导航（原 shell 顶部的 sp-context-nav，2026-09-04 移入标题卡内）：
 *  仅多 tab 工作区渲染；内凹轨道 + 凸起图标 tab，激活态内凹品牌蓝。 */
export function HeroWorkspaceTabs({
  tabs,
  currentPath,
  ariaLabel = "工作区子导航",
}: {
  tabs?: readonly { path: string; title: string; icon?: IconType }[] | null;
  currentPath: string;
  ariaLabel?: string;
}) {
  if (!tabs || tabs.length < 2) return null;
  const currentTab = tabs.find((tab) => tab.path === currentPath)
    ?? tabs
        .filter((tab) => currentPath.startsWith(tab.path + "/"))
        .sort((a, b) => b.path.length - a.path.length)[0];

  return (
    <nav className="sp-hero-tabs" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const active = currentTab?.path === tab.path;
        const TabIcon = tab.icon;
        return (
          <Link
            key={tab.path}
            href={tab.path}
            className={`sp-hero-tab${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {TabIcon && <TabIcon size={14} strokeWidth={1.9} aria-hidden="true" />}
            {tab.title}
          </Link>
        );
      })}
    </nav>
  );
}

function useHeroWorkspaceTabs(pathname: string) {
  const { status } = useSupplierStatus();
  const workspace = useMemo(
    () => findWorkspaceForPath(pathname, buildMenuItems(status?.isTemporary)),
    [pathname, status?.isTemporary],
  );
  const currentTab = workspace ? findWorkspaceTabForPath(pathname, workspace) : undefined;
  return { tabs: workspace?.tabs ?? null, label: workspace?.title, currentTab };
}

type SpPageHeroViewProps = {
  /** 可见标题——仅详情页实体名等真实数据使用（如项目名）；列表页装饰性标题已删，改用 srTitle */
  title?: string;
  /** 视觉隐藏的页面级标题（a11y 锚点）：装饰组合删除后仍为读屏提供页面名 */
  srTitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** 行内子导航插槽（SpPageHero 默认注入工作区 tabs） */
  nav?: React.ReactNode;
};

/** 精简标题条（2026-09-17 删除「图标+页面标题+描述句」装饰组合后）：
 *  cgzxui page-hero 卡片降为单行工具条——工作区 tabs 居左、统计与操作按钮居右；
 *  无任何可见内容时不渲染卡片，仅留 sr-only 标题。cgzxui 渐变 + 方向性双影保留。 */
export function SpPageHeroView({
  title, srTitle, actions, children, headingLevel = 1, nav,
}: SpPageHeroViewProps) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const hiddenHeading = !title && srTitle ? (
    <Heading className="sp-sr-only">{srTitle}</Heading>
  ) : null;
  const hasAside = !!(children || actions);

  if (!title && !hasAside && !nav) return hiddenHeading;

  return (
    <header className="page-hero sp-hero sp-hero--bar">
      {hiddenHeading}
      <div className="page-hero__row">
        {title ? (
          <Heading className="page-hero__title">{title}</Heading>
        ) : nav}
        {hasAside && (
          <div className="page-hero__right sp-hero__aside">
            {children && <div className="sp-hero__meta">{children}</div>}
            {actions && <div className="sp-hero__actions">{actions}</div>}
          </div>
        )}
      </div>
      {title ? nav : null}
    </header>
  );
}

/** 页面用入口：在标题条内挂载工作区子导航（依赖 Next 路由与供应商状态上下文）。 */
export function SpPageHero(props: Omit<SpPageHeroViewProps, "nav">) {
  const pathname = usePathname();
  const { tabs, label, currentTab } = useHeroWorkspaceTabs(pathname);
  return (
    <SpPageHeroView
      {...props}
      nav={tabs && tabs.length >= 2 ? (
        <HeroWorkspaceTabs
          tabs={tabs}
          currentPath={currentTab?.path ?? pathname}
          ariaLabel={label ? `${label}子导航` : undefined}
        />
      ) : undefined}
    />
  );
}

/** KPI 指标瓷片 — 移植自 Vue SpKpi.vue（.kpi-card 样式已在 globals.css） */
export function SpKpi({
  label, value, suffix, to, tone, onClick,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  to?: string;
  tone?: string;
  onClick?: () => void;
}) {
  const clickable = !!to || !!onClick;
  const style = tone ? ({ "--kpi-tone": tone } as React.CSSProperties) : undefined;
  const handle = () => {
    if (to) window.location.assign(to);
    else onClick?.();
  };

  const content = (
    <>
      <span className="kpi-card__label">{label}</span>
      <span className="kpi-card__value">
        {value}
        {suffix && <small>{suffix}</small>}
      </span>
    </>
  );

  if (clickable) {
    return (
      <button type="button" className="kpi-card clickable appearance-none text-left" style={style} onClick={handle}>
        {content}
      </button>
    );
  }

  return (
    <div className="kpi-card" style={style}>
      {content}
    </div>
  );
}
