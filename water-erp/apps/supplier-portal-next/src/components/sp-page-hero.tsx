"use client";

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

type IconType = ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;

/** 页面标题卡 — 移植自 Vue SpPageHero.vue（.page-hero 样式已在 globals.css） */
export function SpPageHero({
  icon: Icon, title, sub, eyebrow, actions, children,
}: {
  icon: IconType;
  title: string;
  sub?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-hero">
      <div className="page-hero__row">
        <div className="page-hero__left">
          <div className="page-hero__icon">
            <Icon size={17} strokeWidth={1.75} />
          </div>
          <div>
            {eyebrow && <div className="page-hero__eyebrow">{eyebrow}</div>}
            <div className="page-hero__title">{title}</div>
            {sub && <div className="page-hero__sub">{sub}</div>}
          </div>
        </div>
        {actions && <div className="page-hero__right">{actions}</div>}
      </div>
      {children && (
        <>
          <hr className="page-hero__rule wb-section-rule" />
          {children}
        </>
      )}
    </div>
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
  return (
    <div
      className={cn("kpi-card", clickable && "clickable")}
      style={style}
      onClick={clickable ? handle : undefined}
      role={clickable ? "button" : undefined}
    >
      <span className="kpi-card__label">{label}</span>
      <span className="kpi-card__value">
        {value}
        {suffix && <small>{suffix}</small>}
      </span>
    </div>
  );
}
