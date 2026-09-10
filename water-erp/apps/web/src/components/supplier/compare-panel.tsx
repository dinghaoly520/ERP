import { useState, useMemo, Fragment } from "react";
import { Columns3, Check, X, Building2, Award, Star, TrendingUp, Phone, Shield, MapPin, Briefcase, FileBadge, User2 } from "lucide-react";
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
const levelColor = (l?: string) => {
  const colors: Record<string, string> = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--warning)', D: '#ca8a04', E: 'var(--danger)' };
  return l ? colors[l] || 'var(--muted-foreground)' : 'var(--muted-foreground)';
};

/** 单个对比维度：type 决定单元格渲染方式 */
type DimType = "score" | "tags" | "text" | "long" | "eval" | "projects" | "contact" | "chips" | "scope" | "address";
type Dimension = { key: string; label: string; type: DimType };

/** 分组维度（2026-09-09 重构）：资料维度从 7 项扩到 13 项，按业务分组呈现 */
const DIMENSION_GROUPS: { title: string; dims: Dimension[] }[] = [
  {
    title: "匹配概况",
    dims: [
      { key: "matchScore", label: "匹配度", type: "score" },
      { key: "tags", label: "业务标签", type: "tags" },
      { key: "classification", label: "供应商分类", type: "text" },
      { key: "enterpriseType", label: "企业类型", type: "text" },
      { key: "reason", label: "匹配说明", type: "long" },
    ],
  },
  {
    title: "企业实力",
    dims: [
      { key: "legalPerson", label: "法定代表人", type: "text" },
      { key: "registeredCapital", label: "注册资本", type: "text" },
      { key: "region", label: "所属区域", type: "address" },
      { key: "industry", label: "所属行业", type: "address" },
      { key: "businessScope", label: "经营范围", type: "scope" },
      { key: "qualifications", label: "资质证书", type: "chips" },
    ],
  },
  {
    title: "履约表现",
    dims: [
      { key: "evaluation", label: "评价等级", type: "eval" },
      { key: "activeProjects", label: "进行中项目", type: "projects" },
    ],
  },
  {
    title: "联系方式",
    dims: [
      { key: "contact", label: "联系人", type: "contact" },
    ],
  },
];

const textOf = (c: SupplierRecommendation, key: string): string => {
  switch (key) {
    case "classification": return c.classification || "";
    case "enterpriseType": return normalizeEnterpriseType(c.enterpriseType);
    case "legalPerson": return c.legalPerson || "";
    case "registeredCapital": return c.registeredCapital || "";
    case "region": return c.region || "";
    case "industry": return c.industry || "";
    default: return (c as unknown as Record<string, string>)[key] || "";
  }
};

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
    if (compared.length < 2) return { score: -1, evalLevel: "", projects: -1, tags: -1 };
    const gradeOrder: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
    let bestScore = -1, bestEval = "", bestEvalOrder = 0, fewestProjects = Infinity, mostTags = 0;
    compared.forEach((c) => {
      if (c.matchScore > bestScore) bestScore = c.matchScore;
      if (c.evaluation?.level && gradeOrder[c.evaluation.level] > bestEvalOrder) { bestEvalOrder = gradeOrder[c.evaluation.level]; bestEval = c.evaluation.level; }
      if (c.activeProjects < fewestProjects) fewestProjects = c.activeProjects;
      if ((c.tags?.length ?? 0) > mostTags) mostTags = c.tags!.length;
    });
    return { score: bestScore, evalLevel: bestEval, projects: fewestProjects, tags: mostTags };
  }, [compared]);

  if (!isOpen) return null;

  const dimIcon = (dim: Dimension) => {
    switch (dim.key) {
      case "tags": return <Star size={11} />;
      case "registeredCapital": return <Briefcase size={11} />;
      case "region": return <MapPin size={11} />;
      case "industry": return <Briefcase size={11} />;
      case "businessScope": return <Building2 size={11} />;
      case "qualifications": return <FileBadge size={11} />;
      case "legalPerson": return <User2 size={11} />;
      case "evaluation": return <Award size={11} />;
      case "activeProjects": return <TrendingUp size={11} />;
      case "contact": return <Phone size={11} />;
      case "matchScore": return <Shield size={11} />;
      default: return null;
    }
  };

  const renderCell = (c: SupplierRecommendation, dim: Dimension) => {
    const contact = c.contacts?.find((ct) => ct.isPrimary) || c.contacts?.[0];
    switch (dim.type) {
      case "score": {
        const pct = Math.max(4, Math.min(100, c.matchScore));
        return (
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-extrabold tabular-nums" style={{ color: scoreColor(c.matchScore) }}>{c.matchScore}</span>
              <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">/100</span>
            </div>
            {/* 分数比例条：横向直观对比 */}
            <div className="h-1.5 w-24 overflow-hidden rounded-full" style={{ background: 'oklch(0.55 0.03 258 / 0.12)' }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: scoreColor(c.matchScore) }} />
            </div>
            <span className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold" style={{ color: scoreColor(c.matchScore), background: `color-mix(in oklch, ${scoreColor(c.matchScore)} 14%, transparent)` }}>{scoreLabel(c.matchScore)}</span>
            {c.matchScore === bestScores.score && <span className="text-[9px] font-bold text-[var(--success)]">🏆 最高</span>}
          </div>
        );
      }
      case "tags": {
        const tags = c.tags ?? [];
        if (tags.length === 0) return <span className="text-xs text-[var(--muted-foreground)]/50">—</span>;
        return (
          <div className="flex flex-wrap justify-center gap-1 max-w-[240px] mx-auto">
            {tags.slice(0, 6).map((t) => (
              <span key={t} className="rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ color: 'var(--accent)', background: 'color-mix(in oklch, var(--accent) 10%, transparent)' }}>{t}</span>
            ))}
            {tags.length > 6 && <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">+{tags.length - 6}</span>}
          </div>
        );
      }
      case "text": {
        const v = textOf(c, dim.key);
        return v ? <span className="text-sm font-semibold text-[var(--foreground)]">{v}</span> : <span className="text-xs text-[var(--muted-foreground)]/50">—</span>;
      }
      case "address": {
        const v = textOf(c, dim.key);
        return v ? <span className="text-xs font-medium text-[var(--foreground)]">{v}</span> : <span className="text-xs text-[var(--muted-foreground)]/50">—</span>;
      }
      case "scope": {
        const v = c.businessScope?.trim();
        if (!v) return <span className="text-xs text-[var(--muted-foreground)]/50">—</span>;
        return (
          <p className="mx-auto max-w-[260px] max-h-[92px] overflow-y-auto whitespace-pre-wrap rounded-[10px] px-2.5 py-2 text-left text-[11px] leading-relaxed text-[var(--muted-foreground)]"
            style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.55), inset 2px 2px 5px oklch(0.55 0.04 258 / 0.07)' }}>{v}</p>
        );
      }
      case "chips": {
        const quals = c.qualifications ?? [];
        if (quals.length === 0) return <span className="text-xs text-[var(--muted-foreground)]/50">—</span>;
        return (
          <div className="flex flex-wrap justify-center gap-1 max-w-[240px] mx-auto">
            {quals.map((q) => (
              <span key={q} className="rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ color: 'var(--accent-strong)', background: 'color-mix(in oklch, var(--accent-strong) 10%, transparent)' }}>{q}</span>
            ))}
          </div>
        );
      }
      case "long":
        return <p className="text-xs text-[var(--muted-foreground)] leading-relaxed max-w-[260px] mx-auto text-center">{c.reason}</p>;
      case "eval":
        return c.evaluation?.level ? (
          <div className="flex items-center justify-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-sm font-extrabold text-white" style={{ background: levelColor(c.evaluation.level) }}>{c.evaluation.level}</span>
            <div className="text-xs">
              <div className="font-semibold tabular-nums text-[var(--foreground)]">{c.evaluation.level} 级</div>
              <div className="text-[var(--muted-foreground)]">{c.evaluation.count} 次评价</div>
            </div>
            {c.evaluation.level === bestScores.evalLevel && <span className="text-[9px] font-bold text-[var(--success)]">🏆 最优</span>}
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

  const totalCols = compared.length + 1;

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
                勾选 2–4 家供应商，按「匹配概况 · 企业实力 · 履约表现 · 联系方式」四组共 13 个维度并列比较
              </div>
            </div>
          </div>
          <button onClick={onClose} className="neu-btn-soft !p-2"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: 'oklch(0.975 0.012 258 / 0.32)', boxShadow: 'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)' }}>

          {/* Check selector */}
          <div className="sticky top-0 z-20 px-6 py-3 border-b" style={{ background: 'oklch(0.98 0.005 258 / 0.92)', borderColor: 'oklch(0.6 0.04 258 / 0.12)' }}>
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
                <p className="text-xs text-[var(--muted-foreground)] max-w-sm">在上方选项卡中勾选 2 至 4 家供应商，系统将并列展示标签、实力、资质、履约等 13 项维度，最佳项高亮标记 🏆</p>
              </div>
            ) : (
              /* ── 对比表格（按组分段）── */
              <div className="overflow-x-auto rounded-[16px]" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="text-center py-3 px-4 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted-foreground)] sticky left-0 z-10 w-[92px]"
                        style={{ background: 'oklch(1 0 0 / 0.85)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>对比维度</th>
                      {compared.map((c) => (
                        <th key={c.supplierId} className="text-center px-4 py-3 min-w-[190px]"
                          style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex h-8 w-8 items-center justify-center rounded-[10px]" style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>
                              <Building2 size={14} className="text-white" />
                            </div>
                            <span className="text-[11px] font-bold text-[var(--foreground)]">{c.name}</span>
                            {c.supplierNo && <span className="text-[9px] font-semibold tabular-nums text-[var(--muted-foreground)]/70">{c.supplierNo}</span>}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DIMENSION_GROUPS.map((group) => (
                      <Fragment key={group.title}>
                        {/* 组标题行：横跨全列 */}
                        <tr>
                          <td colSpan={totalCols} className="px-4 py-2"
                            style={{ background: 'color-mix(in oklch, var(--accent) 7%, oklch(1 0 0 / 0.55))', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.08)' }}>
                            <span className="text-[10px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'var(--accent)' }}>{group.title}</span>
                          </td>
                        </tr>
                        {group.dims.map((dim, rowIdx) => (
                          <tr key={dim.key}>
                            <td className="py-3 px-3 text-[11px] font-semibold text-center text-[var(--muted-foreground)] sticky left-0 z-10"
                              style={{ background: rowIdx % 2 === 0 ? 'oklch(1 0 0 / 0.4)' : 'oklch(1 0 0 / 0.6)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.06)' }}>
                              <span className="inline-flex flex-col items-center gap-1">
                                {dimIcon(dim)}
                                {dim.label}
                              </span>
                            </td>
                            {compared.map((c) => (
                              <td key={c.supplierId} className="text-center px-4 py-3"
                                style={{ background: rowIdx % 2 === 0 ? 'oklch(1 0 0 / 0.3)' : 'oklch(1 0 0 / 0.5)', borderBottom: '1px solid oklch(0.6 0.04 258 / 0.06)' }}>
                                {renderCell(c, dim)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </Fragment>
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
