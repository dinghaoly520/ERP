import { useState, useMemo } from "react";
import { Columns3, Check, X, Building2, Award, Star, TrendingUp, Phone, Shield } from "lucide-react";
import type { SupplierRecommendation } from "@/lib/api/supplier";
import { normalizeEnterpriseType } from "@/lib/utils/enterprise-type";

type Props = {
  isOpen: boolean;
  candidates: SupplierRecommendation[];
  onClose: () => void;
};

const scoreColor = (s: number) =>
  s >= 85 ? "var(--success)" : s >= 70 ? "var(--accent)" : s >= 55 ? "var(--warning)" : "var(--danger)";
const scoreLabel = (s: number) =>
  s >= 85 ? "强匹配" : s >= 70 ? "较匹配" : s >= 55 ? "可考虑" : "弱匹配";
const levelColor = (l?: string) =>
  l === "A" ? "var(--success)" : l === "B" ? "var(--accent)" : l === "C" ? "var(--warning)" : "var(--danger)";

const DIMENSIONS = [
  { key: "matchScore", label: "匹配度", type: "score" as const },
  { key: "classification", label: "供应商分类", type: "text" as const },
  { key: "enterpriseType", label: "企业类型", type: "text" as const },
  { key: "reason", label: "匹配说明", type: "long" as const },
  { key: "evaluation", label: "评价等级", type: "eval" as const },
  { key: "activeProjects", label: "进行中项目", type: "projects" as const },
  { key: "contact", label: "联系人", type: "contact" as const },
] as const;

export function ComparePanel({ isOpen, candidates, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleCheck = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else if (next.size < 4) { next.add(id); }
      return next;
    });
  };

  const compared = useMemo(
    () => candidates.filter((c) => selected.has(c.supplierId)),
    [candidates, selected]
  );

  const bestScores = useMemo(() => {
    if (compared.length < 2) return { score: -1, evalLevel: "", projects: -1 };
    let bestScore = -1, bestEval = "", fewestProjects = Infinity;
    compared.forEach((c) => {
      if (c.matchScore > bestScore) bestScore = c.matchScore;
      if (c.evaluation?.level && (!bestEval || c.evaluation.level < bestEval)) bestEval = c.evaluation.level;
      if (c.activeProjects < fewestProjects) fewestProjects = c.activeProjects;
    });
    return { score: bestScore, evalLevel: bestEval, projects: fewestProjects };
  }, [compared]);

  if (!isOpen) return null;

  const renderCell = (c: SupplierRecommendation, dim: typeof DIMENSIONS[number]) => {
    const contact = c.contacts?.find((ct) => ct.isPrimary) || c.contacts?.[0];
    switch (dim.type) {
      case "score":
        return (
          <div className="flex flex-col items-center gap-1">
            <span className="text-2xl font-extrabold tabular-nums" style={{ color: scoreColor(c.matchScore) }}>{c.matchScore}</span>
            <span className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold" style={{ color: scoreColor(c.matchScore), background: `color-mix(in oklch, ${scoreColor(c.matchScore)} 14%, transparent)` }}>{scoreLabel(c.matchScore)}</span>
            {c.matchScore === bestScores.score && <span className="text-[9px] font-bold text-[var(--success)]">🏆 最高</span>}
          </div>
        );
      case "text":
        return dim.key === "enterpriseType"
          ? <span className="text-sm font-semibold text-[var(--foreground)]">{normalizeEnterpriseType(c.enterpriseType)}</span>
          : <span className="text-sm font-semibold text-[var(--foreground)]">{c[dim.key as "classification"] || "—"}</span>;
      case "long":
        return <p className="text-xs text-[var(--muted-foreground)] leading-relaxed max-w-[260px] mx-auto text-center">{c.reason}</p>;
      case "eval":
        return c.evaluation ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-sm font-extrabold text-white" style={{ background: levelColor(c.evaluation.level) }}>{c.evaluation.level}</span>
            <div className="text-xs">
              <div className="font-semibold tabular-nums text-[var(--foreground)]">{c.evaluation.avgScore} 分</div>
              <div className="text-[var(--muted-foreground)]">{c.evaluation.count} 次评价</div>
            </div>
          </div>
        ) : <span className="text-xs text-[var(--muted-foreground)]/50">暂无</span>;
      case "projects":
        return (
          <div className="text-center">
            <span className={`text-lg font-extrabold tabular-nums ${c.activeProjects >= 5 ? "text-[var(--danger)]" : c.activeProjects > 0 ? "text-[var(--foreground)]" : "text-[var(--success)]"}`}>{c.activeProjects}</span>
            <span className={`block text-[10px] font-semibold ${c.activeProjects >= 5 ? "text-[var(--danger)]" : c.activeProjects > 0 ? "text-[var(--muted-foreground)]" : "text-[var(--success)]"}`}>
              {c.activeProjects >= 5 ? "繁忙" : c.activeProjects > 0 ? "正常" : "空闲"}
            </span>
            {c.activeProjects === bestScores.projects && c.activeProjects >= 0 && <span className="text-[9px] font-bold text-[var(--success)]">🏆 最少</span>}
          </div>
        );
      case "contact":
        return contact ? (
          <div className="text-xs text-[var(--muted-foreground)] space-y-0.5 text-center">
            <div className="flex items-center justify-center gap-1"><Phone size={10} />{contact.phone || "—"}</div>
            <div className="font-semibold text-[var(--foreground)]">{contact.name}</div>
          </div>
        ) : <span className="text-xs text-[var(--muted-foreground)]/50">—</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-[700] flex flex-col">
      <div className="absolute inset-0" style={{ background: 'oklch(0.1 0.02 258 / 0.5)', backdropFilter: 'blur(6px)' }} onClick={onClose} />
      <div className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.96), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 16px oklch(0.46 0.07 258 / 0.2), -3px -3px 10px oklch(1 0 0 / 0.92)' }}>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{ background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)' }}>
              <Columns3 size={17} className="text-[var(--accent)]" />
            </div>
            <div>
              <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">候选供应商横向对比</div>
              <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                勾选 2–4 家供应商进行多维度并列比较，最佳项自动高亮
              </div>
            </div>
          </div>
          <button onClick={onClose} className="neu-btn-soft !p-2"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: 'oklch(0.975 0.012 258 / 0.32)', boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)' }}>

          {/* Check selector */}
          <div className="sticky top-0 z-10 px-6 py-3 border-b" style={{ background: 'oklch(0.98 0.005 258 / 0.92)', borderColor: 'oklch(0.6 0.04 258 / 0.12)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted-foreground)] mr-1">选择对比</span>
              {candidates.slice(0, 8).map((c) => (
                <button key={c.supplierId} onClick={() => toggleCheck(c.supplierId)}
                  className={`neu-tab text-[11px] gap-1.5 ${selected.has(c.supplierId) ? "is-active" : ""}`}>
                  {selected.has(c.supplierId) && <Check size={11} />}{c.name}
                </button>
              ))}
              {candidates.length > 8 && <span className="text-[11px] text-[var(--muted-foreground)]/50">+{candidates.length - 8}</span>}
              {compared.length > 0 && (
                <button onClick={() => setSelected(new Set())} className="ml-auto neu-btn-xs text-[10px] gap-1">
                  <X size={10} />清空选择
                </button>
              )}
            </div>
          </div>

          {/* Comparison content */}
          <div className="p-6">
            {compared.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-[20px] mb-5"
                  style={{ background: 'color-mix(in oklch, var(--accent-soft) 35%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 3px 8px oklch(0.55 0.03 258 / 0.1)' }}>
                  <Columns3 size={28} className="text-[var(--accent)]" />
                </div>
                <h3 className="text-sm font-bold text-[var(--foreground)] mb-1">选择供应商开始对比</h3>
                <p className="text-xs text-[var(--muted-foreground)] max-w-sm">在上方选项卡中勾选 2 至 4 家供应商，系统将自动并列展示各维度信息，最佳项高亮标记 🏆</p>
              </div>
            ) : (
              /* ── 对比表格 ── */
              <div className="overflow-x-auto rounded-[16px]" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-center py-3 px-4 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted-foreground)] sticky left-0 z-10"
                        style={{ background: 'oklch(1 0 0 / 0.85)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>对比维度</th>
                      {compared.map((c) => (
                        <th key={c.supplierId} className="text-center px-4 py-3 min-w-[160px]"
                          style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex h-8 w-8 items-center justify-center rounded-[10px]" style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>
                              <Building2 size={14} className="text-white" />
                            </div>
                            <span className="text-[11px] font-bold text-[var(--foreground)]">{c.name}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DIMENSIONS.map((dim, rowIdx) => (
                      <tr key={dim.key}>
                        <td className="py-3 px-4 text-[11px] font-semibold text-center text-[var(--muted-foreground)] sticky left-0 z-10"
                          style={{ background: rowIdx % 2 === 0 ? 'oklch(1 0 0 / 0.4)' : 'oklch(1 0 0 / 0.6)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.06)' }}>
                          {dim.label}
                        </td>
                        {compared.map((c) => (
                          <td key={c.supplierId} className="text-center px-4 py-3"
                            style={{ background: rowIdx % 2 === 0 ? 'oklch(1 0 0 / 0.3)' : 'oklch(1 0 0 / 0.5)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.06)' }}>
                            {renderCell(c, dim)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
