"use client";

import type { ReactNode } from "react";

/**
 * 详情弹层共用基元（2026-11-23：专家/供应商详情弹层同款）——徽章、紧凑定义项、分组卡、
 * 竖向时间轴，与日期格式化。语义与 :3005 InfoField/FieldGroup/StatusBadge 对齐（空值淡化显 —）。
 */

export type Tone = "green" | "blue" | "orange" | "red" | "gray" | "gold";
export const TONE_TEXT: Record<Tone, string> = {
  green: "var(--success)",
  blue: "var(--accent)",
  orange: "var(--warning)",
  red: "var(--danger)",
  gray: "var(--muted-foreground)",
  gold: "var(--gold)",
};

/** A–E 等级 → tone（与 :3005 levelTone 同映射：A 绿 / B 蓝 / C·D 橙 / E 红） */
export const toneOfLevel = (g?: string | null): Tone =>
  g === "A" ? "green" : g === "B" ? "blue" : g === "E" ? "red" : g === "C" || g === "D" ? "orange" : "gray";

/* 日期本地时区格式化（禁 UTC 切片——凌晨落库会差一天） */
export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("zh-CN") : "—");
export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export function Badge({ tone, children, solid }: { tone: Tone; children: ReactNode; solid?: boolean }) {
  const c = TONE_TEXT[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold"
      style={solid ? { background: c, color: "oklch(1 0 0)" } : { background: `color-mix(in oklch, ${c} 12%, transparent)`, color: c }}
    >
      {children}
    </span>
  );
}

/* 紧凑定义项：label 小字 + 值（空值淡化显 —） */
export function Field({ label, value, mono, full }: { label: string; value?: ReactNode; mono?: boolean; full?: boolean }) {
  const empty = value == null || (typeof value === "string" && !value.trim());
  return (
    <div className={`min-w-0 ${full ? "col-span-full" : ""}`}>
      <div className="text-[11px] font-semibold text-[var(--muted-foreground)]">{label}</div>
      <div className={`mt-0.5 break-words text-[14px] leading-snug tabular-nums ${mono ? "font-mono tracking-tight" : "font-semibold"} ${empty ? "font-normal text-[var(--muted-foreground)]" : "text-[var(--foreground)]"}`}>
        {empty ? "—" : value}
      </div>
    </div>
  );
}

/* 分组卡：瓷面容器 + 标题 hairline */
export function Group({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-[12px] m-tile px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="shrink-0 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">{title}</span>
        <span className="h-px min-w-0 flex-1 bg-[color-mix(in_oklch,var(--muted-foreground)_14%,transparent)]" />
        {right}
      </div>
      {children}
    </div>
  );
}

export type TimelineEvent = { time: string; type: string; title: string; detail: string; tone: Tone };

/** 竖向时间轴（倒序已由调用方排好）：左侧 hairline 轨 + 色点光晕 + 时间/类型徽章/标题/详情 */
export function Timeline({ events, empty }: { events: TimelineEvent[]; empty: string }) {
  if (!events.length) return <div className="py-6 text-center text-[13px] text-[var(--muted-foreground)]">{empty}</div>;
  return (
    <div className="relative space-y-4 pl-5">
      <span aria-hidden className="absolute bottom-1 left-[5px] top-1 w-px bg-[color-mix(in_oklch,var(--muted-foreground)_18%,transparent)]" />
      {events.map((ev, i) => (
        <div key={i} className="relative">
          <span
            aria-hidden
            className="absolute left-[-1.6rem] top-1.5 h-2.5 w-2.5 rounded-full"
            style={{ background: TONE_TEXT[ev.tone], boxShadow: `0 0 0 3px color-mix(in oklch, ${TONE_TEXT[ev.tone]} 18%, transparent)` }}
          />
          <div className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{fmtDateTime(ev.time)}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={ev.tone}>{ev.type}</Badge>
            <span className="min-w-0 text-[14px] font-bold leading-snug text-[var(--foreground)]">{ev.title}</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted-foreground)]">{ev.detail}</p>
        </div>
      ))}
    </div>
  );
}
