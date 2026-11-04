'use client';

import { useState } from "react";
import { Minimize2, Table2, X } from 'lucide-react';
import type { ChatCard } from "@/lib/api/assistant";
import { ChartCardSvg } from "@/components/m/chart-card-svg";

/** 聊天卡片——metric=指标瓷片网格 / table=迷你表（可展开全部行） / chart=五类 SVG 真图
 * （2026-11-03）+ 放大查看（2026-11-04 审查 D 批：小屏恰是最需放大场景） */
export function ChatCardView({ card }: { card: ChatCard }) {
  const [zoom, setZoom] = useState(false);
  if (card.type === "chart") {
    return (
      <>
        <button type="button" onClick={() => setZoom(true)} className="mt-1.5 block w-full text-left active:scale-[0.99]" aria-label={`放大查看 ${card.title}`}>
          <ChartCardSvg card={card} />
        </button>
        {zoom ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[oklch(0.24_0.038_258/0.55)] px-4" role="dialog" aria-modal="true" aria-label={`${card.title} 放大查看`} onClick={() => setZoom(false)}>
            <div className="w-full max-w-[26rem] rounded-[16px] p-3 m-tile active:scale-[0.99]" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[13px] font-bold text-[var(--foreground)]">{card.title}</span>
                <button type="button" aria-label="关闭放大" onClick={() => setZoom(false)} className="neu-btn-soft h-8 w-8 rounded-[10px] p-0">
                  <X size={14} />
                </button>
              </div>
              <ChartCardSvg card={card} />
            </div>
          </div>
        ) : null}
      </>
    );
  }
  if (card.type === "metric") {
    const items = (card.metrics ?? []) as Array<{ label: string; value: string }>;
    if (items.length) {
      return (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {items.map((m, i) => (
            <div key={i} className="rounded-[12px] m-tile px-3 py-2">
              <div className="text-[12px] text-[var(--muted-foreground)]">{m.label}</div>
              <div className="mt-0.5 text-[17px] font-black leading-none tabular-nums text-[var(--foreground)]">{m.value}</div>
            </div>
          ))}
        </div>
      );
    }
    return <FallbackCard card={card} />;
  }
  return <TableCard card={card} />;
}

/** 迷你表：默认 4 列×8 行，超出可展开全部行/全部列（2026-11-04：截断无出口是小屏痛点） */
function TableCard({ card }: { card: ChatCard }) {
  const [expanded, setExpanded] = useState(false);
  const rows = (card.rows ?? []) as Array<Record<string, string>>;
  if (!rows.length) return <FallbackCard card={card} />;
  /* 表头优先用后端 columns 的中文 label（用户口径：表格不允许出现英文——2026-10-26）；
   * 无 columns 的卡（cockpit 中文行键风格）回退行键 */
  const colDefs = ((card.columns ?? []) as Array<{ key: string; label: string }>).filter((c) =>
    rows.some((r) => c.key in r),
  );
  const allCols = colDefs.length
    ? colDefs
    : Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  // 合计行不进列裁切判断（_total 行键少于数据行）
  const cols = expanded ? allCols : allCols.slice(0, 4);
  const shownRows = expanded ? rows : rows.slice(0, 8);
  const hasMore = rows.length > 8 || allCols.length > 4;
  return (
    <div className="mt-1.5 overflow-hidden rounded-[12px] m-tile">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <span className="text-[13px] font-bold text-[var(--foreground)]">{card.title}</span>
        {hasMore ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="neu-btn-soft flex h-7 items-center gap-1 rounded-[8px] px-2 text-[11px]"
          >
            {expanded ? <Minimize2 size={11} /> : <Table2 size={11} />}
            {expanded ? '收起' : `全部 ${rows.length} 行`}
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto px-3 pb-2.5 pt-1.5">
        <table className="w-full text-[12px]">
          <thead>
            {/* 列居中（2026-11-04 用户裁定） */}
            <tr className="text-center text-[var(--muted-foreground)]">
              {cols.map((c) => <th key={c.key} className="whitespace-nowrap py-1 pr-3 font-semibold">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="tabular-nums text-[var(--foreground)]">
            {shownRows.map((r, i) => (
              <tr key={i} className="border-t border-[color-mix(in_oklch,var(--border)_45%,transparent)]">
                {cols.map((c) => <td key={c.key} className="max-w-[10rem] whitespace-nowrap py-1 pr-3 text-center">{String(r[c.key] ?? "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FallbackCard({ card }: { card: ChatCard }) {
  const entries = Object.entries(card).filter(([k]) => k !== "type" && k !== "title").slice(0, 4);
  return (
    <div className="mt-1.5 rounded-[12px] m-tile px-3 py-2.5">
      <div className="text-[13px] font-bold text-[var(--foreground)]">{card.title}</div>
      {entries.map(([k, v]) => (
        <div key={k} className="mt-0.5 truncate text-[12px] text-[var(--muted-foreground)]">
          {k}: {typeof v === "string" ? v : JSON.stringify(v).slice(0, 60)}
        </div>
      ))}
    </div>
  );
}
