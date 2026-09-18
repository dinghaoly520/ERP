"use client";

import type { ComponentType } from "react";

type IconType = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;

type SpPageHeroViewProps = {
  /** 可见标题——仅详情页实体名等真实数据使用（如项目名）；列表页装饰性标题已删，改用 srTitle */
  title?: string;
  /** 视觉隐藏的页面级标题（a11y 锚点）：装饰组合删除后仍为读屏提供页面名 */
  srTitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
};

/** 精简标题条（2026-09-17 删除「图标+页面标题+描述句」装饰组合后）：
 *  cgzxui page-hero 卡片降为单行工具条——工作区 tabs 居左、统计与操作按钮居右；
 *  无任何可见内容时不渲染卡片，仅留 sr-only 标题。cgzxui 渐变 + 方向性双影保留。 */
export function SpPageHeroView({
  title, srTitle, actions, children, headingLevel = 1,
}: SpPageHeroViewProps) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const hiddenHeading = !title && srTitle ? (
    <Heading className="sp-sr-only">{srTitle}</Heading>
  ) : null;
  const hasAside = !!(children || actions);

  if (!title && !hasAside) return hiddenHeading;

  return (
    <header className="page-hero sp-hero sp-hero--bar">
      {hiddenHeading}
      <div className="page-hero__row">
        {title ? (
          <Heading className="page-hero__title">{title}</Heading>
        ) : null}
        {hasAside && (
          <div className="page-hero__right sp-hero__aside">
            {children && <div className="sp-hero__meta">{children}</div>}
            {actions && <div className="sp-hero__actions">{actions}</div>}
          </div>
        )}
      </div>
    </header>
  );
}

/** 页面用入口（客户端组件包装）。子页面导航已移至侧栏（2026-09-18），标题条仅承载标题/统计/操作。 */
export function SpPageHero(props: Omit<SpPageHeroViewProps, never>) {
  return <SpPageHeroView {...props} />;
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
