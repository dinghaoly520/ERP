"use client";

import type { ComponentType } from "react";

type IconType = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;

type SpPageHeroViewProps = {
  /** 标题卡图标（内凹图标井） */
  icon?: IconType;
  /** 可见页面标题 */
  title?: string;
  /** 视觉隐藏的页面级标题（a11y 锚点）：仅当无可见 title 时使用（如详情页实体名即页面标题） */
  srTitle?: string;
  /** 副标题/功能描述 */
  sub?: string;
  /** 眉题（小写间隔大写，弱化分组词） */
  eyebrow?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
};

/** cgzxui page-hero 标题卡（2026-09-18 恢复可见标题栏）：
 *  图标井 + 标题/副标题 + 右侧统计与操作；srTitle 仅作无可见标题详情页的读屏锚点。
 *  cgzxui 105° 渐变 + 方向性双影 + ::after 光晕由 .page-hero 提供。 */
export function SpPageHeroView({
  icon: Icon, title, srTitle, sub, eyebrow, actions, children, headingLevel = 1,
}: SpPageHeroViewProps) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const hiddenHeading = !title && srTitle ? (
    <Heading className="sp-sr-only">{srTitle}</Heading>
  ) : null;
  const hasAside = !!(children || actions);

  if (!title && !hasAside) return hiddenHeading;

  return (
    <header className="page-hero sp-hero">
      {hiddenHeading}
      <div className="page-hero__row">
        <div className="page-hero__left">
          {Icon && (
            <div className="page-hero__icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.75} />
            </div>
          )}
          <div className="page-hero__copy">
            {eyebrow && <div className="page-hero__eyebrow">{eyebrow}</div>}
            {title && <Heading className="page-hero__title">{title}</Heading>}
            {sub && <p className="page-hero__sub">{sub}</p>}
          </div>
        </div>
        {hasAside && (
          <div className="page-hero__right sp-hero__aside">
            {children && <div className="sp-hero__meta">{children}</div>}
            {actions && <div className="sp-hero__actions">{actions}</div>}
          </div>
        )}
      </div>
      {/* 下横线收底（2026-09-18 对齐 :3005 账号管理 page-hero__divider）——标题行与内容区的 1px hairline */}
      <div className="page-hero__divider" />
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
