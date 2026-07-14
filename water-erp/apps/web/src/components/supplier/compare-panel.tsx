"use client";

import { useState } from "react";
import { X, Columns3, Check } from "lucide-react";
import type { SupplierRecommendation } from "@/lib/api/supplier";

type Props = {
  isOpen: boolean;
  candidates: SupplierRecommendation[];
  onClose: () => void;
};

const DIMENSIONS = [
  { key: "name", label: "供应商名称" },
  { key: "classification", label: "分类" },
  { key: "enterpriseType", label: "企业类型" },
  { key: "matchScore", label: "匹配分" },
  { key: "reason", label: "匹配说明" },
  { key: "contact", label: "联系人" },
  { key: "level", label: "评价等级" },
  { key: "activeProjects", label: "进行中项目" },
] as const;

export function ComparePanel({ isOpen, candidates, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const toggleCheck = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 4) {
        next.add(id);
      }
      return next;
    });
  };

  const compared = candidates.filter((c) => selected.has(c.supplierId));
  const scoreLabel = (s: number) =>
    s >= 85 ? "强匹配" : s >= 70 ? "较匹配" : s >= 55 ? "可考虑" : "弱匹配";
  const levelColor = (l?: string) =>
    l === "A" ? "var(--success)" : l === "B" ? "var(--accent)" : l === "C" ? "var(--warning)" : "var(--danger)";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-[rgba(242,246,255,0.42)] backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative z-10 flex w-full max-w-[min(900px,92vw)] max-h-[85vh] flex-col overflow-hidden rounded-[24px] bg-[var(--background)] shadow-[0_20px_60px_rgba(0,0,0,0.12)]">
        {/* Header */}
        <div
          className="px-6 py-4"
          style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(94,126,189,0.76)]">
                横向对比
              </div>
              <div className="mt-1.5 text-lg font-semibold text-[color:var(--foreground)]">
                候选供应商对比
              </div>
              <p className="mt-1.5 text-sm text-[color:var(--muted-foreground)]">
                勾选 2–4 家供应商进行并列比较
              </p>
            </div>
            <button type="button" onClick={onClose} className="neu-btn-xs" aria-label="关闭对比面板">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
          {/* Check selector */}
          <div className="px-6 py-3 flex flex-wrap gap-2" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.08)" }}>
            {candidates.slice(0, 6).map((c) => (
              <button
                key={c.supplierId}
                onClick={() => toggleCheck(c.supplierId)}
                className={`neu-tab text-[11px] gap-1.5 ${selected.has(c.supplierId) ? "is-active" : ""}`}
              >
                {selected.has(c.supplierId) && <Check size={11} />}
                {c.name}
              </button>
            ))}
            {candidates.length > 6 && (
              <span className="text-[11px] text-[var(--muted-foreground)]/60 self-center">
                +{candidates.length - 6} 家更多
              </span>
            )}
          </div>

          {/* Comparison table */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {compared.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Columns3 size={32} className="text-[var(--muted-foreground)]/30 mb-3" />
                <p className="text-sm text-[color:var(--muted-foreground)]">请至少勾选 2 家供应商开始对比</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left py-2 pr-4 font-semibold text-[11px] uppercase tracking-[0.06em] text-[var(--muted-foreground)] sticky left-0 bg-[var(--background)] z-10">
                        维度
                      </th>
                      {compared.map((c) => (
                        <th key={c.supplierId} className="text-center px-3 py-2 font-bold text-[color:var(--foreground)] min-w-[140px]">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DIMENSIONS.map((dim) => (
                      <tr key={dim.key}>
                        <td
                          className="py-2.5 pr-4 text-[11px] font-semibold text-[var(--muted-foreground)] sticky left-0 bg-[var(--background)]"
                          style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.08)" }}
                        >
                          {dim.label}
                        </td>
                        {compared.map((c) => {
                          const contact = c.contacts?.find((ct) => ct.isPrimary) || c.contacts?.[0];
                          let val: React.ReactNode = "—";
                          switch (dim.key) {
                            case "name":
                              val = <span className="font-bold text-[color:var(--foreground)]">{c.name}</span>;
                              break;
                            case "classification":
                              val = c.classification || "—";
                              break;
                            case "enterpriseType":
                              val = c.enterpriseType || "—";
                              break;
                            case "matchScore":
                              val = (
                                <span className="tabular-nums">
                                  <strong style={{ color: `var(${c.matchScore >= 85 ? "--success" : c.matchScore >= 70 ? "--accent" : c.matchScore >= 55 ? "--warning" : "--danger"})` }}>
                                    {c.matchScore}
                                  </strong>
                                  <span className="ml-1 text-[10px] text-[var(--muted-foreground)]">{scoreLabel(c.matchScore)}</span>
                                </span>
                              );
                              break;
                            case "reason":
                              val = <span className="leading-relaxed">{c.reason}</span>;
                              break;
                            case "contact":
                              val = contact ? `${contact.name} · ${contact.phone}` : "—";
                              break;
                            case "level":
                              val = c.evaluation ? (
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white"
                                    style={{ backgroundColor: levelColor(c.evaluation.level) }}
                                  >
                                    {c.evaluation.level}
                                  </span>
                                  <span className="text-[10px] text-[var(--muted-foreground)]">
                                    {c.evaluation.avgScore}分 · {c.evaluation.count}次
                                  </span>
                                </span>
                              ) : (
                                <span className="text-[var(--muted-foreground)]/50">暂无评价</span>
                              );
                              break;
                            case "activeProjects":
                              val = (
                                <span
                                  className={`font-semibold tabular-nums ${
                                    c.activeProjects >= 5
                                      ? "text-[var(--danger)]"
                                      : c.activeProjects > 0
                                      ? "text-[color:var(--foreground)]"
                                      : "text-[var(--muted-foreground)]"
                                  }`}
                                >
                                  {c.activeProjects}{" "}
                                  <span className="text-[10px] font-normal text-[var(--muted-foreground)]">
                                    {c.activeProjects >= 5 ? "繁忙" : c.activeProjects > 0 ? "正常" : "空闲"}
                                  </span>
                                </span>
                              );
                              break;
                          }
                          return (
                            <td
                              key={c.supplierId}
                              className="text-center px-3 py-2.5 text-[color:var(--foreground)] leading-relaxed"
                              style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.08)" }}
                            >
                              {val}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex justify-end px-6 py-4"
          style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}
        >
          <button type="button" onClick={onClose} className="neu-btn-soft">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
