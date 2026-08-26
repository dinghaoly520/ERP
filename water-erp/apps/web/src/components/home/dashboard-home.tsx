"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle, ArrowDown, ArrowRight, ArrowUp,
  BarChart3, CalendarRange, ChevronRight, Eye,
  FolderKanban, Layers, Lightbulb, PieChart,
  RefreshCw, Sparkles, Target, TrendingUp, X,
} from "lucide-react";
import { type AuthRole } from "@/lib/api/auth";
import { fetchDashboardData, type DashboardData } from "@/lib/api/dashboard";
import { AwardResultPanel } from "@/components/home/award-result-panel";
import { CompanySelect, readInitialCompanyId } from "@/components/company/company-select";
import {
  fetchDashboardAnalysis,
  type DashboardAnalysisPayload, type DashboardAnalysisResult,
} from "@/lib/api/ai";
import { Modal } from "@/components/workbench";

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

type SupplierDetail = {
  id: string; name: string; participatedCount: number; winCount: number;
  awardAmount: number; awardAmountLabel: string; hitRate: number;
  topMethod: string; topDepartment: string; tags: string[];
  recentProcurements: { project: string; date: string; method: string; department: string; budgetLabel: string; result: string }[];
  winProjects: { project: string; date: string; method: string; department: string; awardAmountLabel: string }[];
};

function fadeIn(index: number, reducedMotion: boolean, baseDelay = 0.04) {
  if (reducedMotion) return { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0 } };
  return { initial: { opacity: 0, y: 18, scale: 0.98, filter: "blur(6px)" }, animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }, transition: { duration: 0.5, delay: index * baseDelay, ease: easeOutQuint } };
}

// ── KPI Card ─────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, signal, trend, trendLabel, index, reducedMotion, showDivider }: {
  label: string; value: string; sub?: string; signal?: "normal" | "warning" | "danger" | "success";
  trend?: "up" | "down" | "flat"; trendLabel?: string; index: number; reducedMotion: boolean; showDivider?: "right";
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const sc = signal === "success" || signal === "normal" ? "bg-[var(--success)]" : signal === "warning" ? "bg-[var(--warning)]" : "bg-[var(--danger)]";
  const st = signal === "success" || signal === "normal" ? "text-[var(--success)]" : signal === "warning" ? "text-[var(--warning)]" : "text-[var(--danger)]";
  const sl = signal === "normal" ? "正常" : signal === "warning" ? "预警" : signal === "danger" ? "告警" : "达标";

  return (
    <motion.div {...{ initial, animate, transition }} className="relative">
      <div className="kpi-card group flex flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</span>
          {signal && <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] ${st}`}><span className={`h-1 w-1 rounded-full ${sc}`} />{sl}</span>}
        </div>
        <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{value}</span>
        {sub && <span className="text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub}</span>}
        {trend && trendLabel && <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold w-fit bg-[color-mix(in_oklch,var(--muted-foreground)_6%,transparent)] text-[var(--muted-foreground)]">{trend === "up" ? <ArrowUp size={10} className="text-[var(--success)]" /> : trend === "down" ? <ArrowDown size={10} className="text-[var(--danger)]" /> : <ArrowRight size={10} />}{trendLabel}</span>}
      </div>
      {showDivider === "right" && <div className="absolute -right-px top-3 bottom-3 w-px bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]" />}
    </motion.div>
  );
}

// ── AI Intelligence ──────────────────────────────────────────────────────

function IntelligencePanel({ analysis, loading, error, onRefresh, index, reducedMotion }: {
  analysis: DashboardAnalysisResult | null; loading: boolean; error: string | null;
  onRefresh: () => void; index: number; reducedMotion: boolean;
}) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.06);
  return (
    <motion.div {...{ initial, animate, transition }} className="h-full">
      <section className="wb-panel h-full">
        <div className="wb-panel-header">
          <div className="flex items-center gap-2.5"><Sparkles size={15} className="text-[var(--accent)]" /><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">综合分析报告</h2></div>
          <div className="flex items-center gap-2">
            {loading && <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]"><RefreshCw size={12} className="animate-spin" />分析中...</div>}
            <button onClick={onRefresh} className="neu-btn-xs" title="刷新分析"><RefreshCw size={12} /></button>
          </div>
        </div>
        {error && !analysis ? <div className="mx-4 mb-4 mt-1 flex items-center gap-2 rounded-[12px] border border-[color-mix(in_oklch,var(--danger)_25%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2.5 text-xs text-[var(--danger)]"><AlertCircle size={13} />{error}</div> : null}
        <div className="wb-panel-body">
          {analysis?.overview ? <div className="neu-card-static mb-3 px-4 py-3.5"><div className="flex items-center gap-2 mb-2"><div className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)]"><Target size={10} className="text-[var(--accent)]" /></div><span className="text-[11px] font-bold tracking-[0.08em] text-[var(--accent)]">综合研判</span></div><p className="text-[0.85rem] font-medium leading-[1.6] tracking-[-0.01em] text-[var(--foreground)]">{analysis.overview}</p></div> : loading ? <div className="flex h-[60px] items-center justify-center rounded-[14px] border border-dashed border-[color-mix(in_oklch,var(--muted-foreground)_25%,transparent)]"><span className="text-[11px] text-[var(--muted-foreground)]">正在生成分析...</span></div> : null}
          {analysis?.highlights && analysis.highlights.length > 0 && <div className="neu-card-static mb-3 px-3.5 py-3"><div className="flex items-center gap-1.5 mb-2.5"><TrendingUp size={12} className="text-[var(--success)]" /><span className="text-xs font-bold tracking-[0.1em] text-[var(--success)]">核心亮点</span></div><div className="grid grid-cols-2 gap-x-4 gap-y-1.5">{analysis.highlights.map((item, i) => <div key={i} className="flex items-start gap-2 transition-all duration-200 hover:translate-x-1"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" /><span className="text-[11px] leading-[1.5] text-[var(--foreground)]">{item}</span></div>)}</div></div>}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="neu-card-static px-3.5 py-3"><div className="flex items-center gap-1.5 mb-2.5"><Eye size={12} className="text-[var(--warning)]" /><span className="text-xs font-bold tracking-[0.1em] text-[var(--warning)]">待关注项</span></div><div className="space-y-1.5">{analysis?.concerns && analysis.concerns.length > 0 ? analysis.concerns.map((item, i) => <div key={i} className="flex items-start gap-2 transition-all duration-200 hover:translate-x-1"><div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warning)]" /><span className="text-[11px] leading-[1.5] text-[var(--foreground)]">{item}</span></div>) : <span className="text-xs text-[var(--muted-foreground)]">当前运行平稳</span>}</div></div>
            <div className="neu-card-static px-3.5 py-3"><div className="flex items-center gap-1.5 mb-2.5"><Lightbulb size={12} className="text-[var(--accent)]" /><span className="text-xs font-bold tracking-[0.1em] text-[var(--accent)]">建议方向</span></div><div className="space-y-1.5">{analysis?.suggestions && analysis.suggestions.length > 0 ? analysis.suggestions.map((item, i) => <div key={i} className="flex items-start gap-2 transition-all duration-200 hover:translate-x-1"><div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[10px] font-bold text-[var(--accent)]">{i + 1}</div><span className="text-[11px] leading-[1.5] text-[var(--foreground)]">{item}</span></div>) : <span className="text-xs text-[var(--muted-foreground)]">暂无具体建议</span>}</div></div>
          </div>
        </div>
      </section>
    </motion.div>
  );
}

// ── Savings Ranking ──────────────────────────────────────────────────────

type SavingsRankingItem = { project: string; department: string; controlAmount: number; awardAmount: number; savings: number; savingsRate: number; controlAmountLabel: string; awardAmountLabel: string; savingsLabel: string; method: string; date: string };

function SavingsRankingPanel({ items, index, reducedMotion }: { items: SavingsRankingItem[]; index: number; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [flipUp, setFlipUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleExpand = (idx: number, btnEl: HTMLButtonElement) => {
    const next = expandedIdx === idx ? null : idx;
    setExpandedIdx(next);
    if (next === null) return;
    requestAnimationFrame(() => { const c = containerRef.current; if (!c) return; const cr = c.getBoundingClientRect(); const br = btnEl.getBoundingClientRect(); setFlipUp(cr.bottom - br.bottom < 140); });
  };

  const rateColor = (r: number) => r >= 15 ? "var(--success)" : r >= 8 ? "var(--accent)" : "var(--warning)";
  const rateBg = (r: number) => r >= 15 ? "bg-[color-mix(in_oklch,var(--success)_12%,transparent)]" : r >= 8 ? "bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]" : "bg-[color-mix(in_oklch,var(--warning)_12%,transparent)]";

  const maxSavings = Math.max(...items.map(i => i.savings), 1);
  const display = items.slice(0, 5);
  const active = expandedIdx !== null ? display[expandedIdx] : null;

  return (
    <motion.div {...{ initial, animate, transition }} className="h-full">
      <section className="wb-panel h-full">
        <div className="wb-panel-header"><div className="flex items-center gap-2"><TrendingUp size={15} className="text-[var(--success)]" /><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">节资率项目排行</h2></div><div className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--success)_25%,transparent)] bg-[color-mix(in_oklch,var(--success)_8%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--success)]"><Target size={10} /> Top 5</div></div>
        <div ref={containerRef} className="wb-panel-body relative space-y-2">
          {display.map((item, idx) => {
            const rc = rateColor(item.savingsRate);
            return (
              <button key={idx} ref={el => { rowRefs.current[idx] = el; }} onClick={() => handleExpand(idx, rowRefs.current[idx]!)} className="wb-list-item group !rounded-[12px] !px-3 !py-2.5" style={{"--item-accent":"var(--success)"} as React.CSSProperties}>
                <div className="flex items-center gap-2.5 text-left w-full">
                  <div className="flex shrink-0 flex-col items-center gap-1"><div className={`flex h-6 w-6 items-center justify-center rounded-[7px] text-[10px] font-bold ${rateBg(item.savingsRate)}`} style={{color:rc}}>{idx+1}</div><div className="text-xs font-semibold" style={{color:rc}}>{item.savingsRate}%</div></div>
                  <div className="min-w-0 flex-1"><div className="text-[11px] font-semibold leading-snug text-[var(--foreground)] line-clamp-2">{item.project}</div><div className="mt-1 flex items-center gap-2"><span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--accent)_20%,transparent)] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">{item.department}</span><span className="text-xs text-[var(--muted-foreground)]">节约 {item.savingsLabel}</span></div></div>
                  <ChevronRight size={13} className={`shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 ${expandedIdx===idx?"rotate-90":""}`} />
                </div>
              </button>
            );
          })}
          {active && expandedIdx !== null && (
            <motion.div initial={{opacity:0,scale:0.96,filter:"blur(4px)"}} animate={{opacity:1,scale:1,filter:"blur(0px)"}} exit={{opacity:0,scale:0.96,filter:"blur(4px)"}} transition={{duration:0.2,ease:easeOutQuint}} className="absolute left-4 right-4 z-10 rounded-[14px] p-3.5 neu-card" style={{top: flipUp ? `${Math.max(0,(rowRefs.current[expandedIdx]?.offsetTop??0)-(containerRef.current?.scrollTop??0)-160)}px` : `${(rowRefs.current[expandedIdx]?.offsetTop??0)-(containerRef.current?.scrollTop??0)+(rowRefs.current[expandedIdx]?.offsetHeight??0)+4}px`}} onClick={e=>e.stopPropagation()}>
              <div className="flex items-start justify-between mb-2"><div className="text-[11px] font-semibold text-[var(--foreground)] line-clamp-2 flex-1 pr-2">{active.project}</div><button onClick={()=>setExpandedIdx(null)} className="neu-btn-xs"><X size={11}/></button></div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2"><div className="neu-card-static rounded-[8px] px-2.5 py-1.5"><div className="text-xs text-[var(--muted-foreground)]">预算金额</div><div className="mt-0.5 text-[11px] font-semibold text-[var(--foreground)]">{active.controlAmountLabel}</div></div><div className="neu-card-static rounded-[8px] px-2.5 py-1.5"><div className="text-xs text-[var(--muted-foreground)]">成交金额</div><div className="mt-0.5 text-[11px] font-semibold text-[var(--success)]">{active.awardAmountLabel}</div></div><div className="neu-card-static rounded-[8px] px-2.5 py-1.5"><div className="text-xs text-[var(--muted-foreground)]">节资率</div><div className="mt-0.5 text-[11px] font-bold" style={{color:rateColor(active.savingsRate)}}>{active.savingsRate}%</div></div></div>
              <div className="mb-1"><div className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--success)]">节资额对比</div><div className="mt-1 h-3 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]"><div className="h-full rounded-full transition-all duration-700" style={{width:`${(active.savings/maxSavings)*100}%`,backgroundColor:rateColor(active.savingsRate)}}/></div><div className="mt-0.5 text-xs font-semibold" style={{color:rateColor(active.savingsRate)}}>节约 {active.savingsLabel}</div></div>
              <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]"><span>采购方式: {active.method}</span><span>日期: {active.date}</span></div>
            </motion.div>
          )}
          {display.length === 0 && <div className="flex flex-1 items-center justify-center text-[11px] text-[var(--muted-foreground)]">暂无已成交项目数据</div>}
        </div>
      </section>
    </motion.div>
  );
}

// ── Risk Projects ────────────────────────────────────────────────────────

function RiskProjectsPanel({ profile, index, reducedMotion }: { profile: DashboardData; index: number; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const sev = { 高:{bg:"bg-[color-mix(in_oklch,var(--danger)_12%,transparent)]",t:"text-[var(--danger)]"}, 中:{bg:"bg-[color-mix(in_oklch,var(--warning)_12%,transparent)]",t:"text-[var(--warning)]"}, 低:{bg:"bg-[color-mix(in_oklch,var(--accent)_12%,transparent)]",t:"text-[var(--accent)]"} } as const;
  const display = profile.riskProjects.slice(0, 5);
  return (
    <motion.div {...{ initial, animate, transition }} className="h-full">
      <section className="wb-panel h-full">
        <div className="wb-panel-header"><div className="flex items-center gap-2"><AlertCircle size={15} className="text-[var(--danger)]" /><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">风险项目预警</h2></div><div className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--danger)_25%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--danger)]"><AlertCircle size={10} /> {profile.riskProjects.length} 项</div></div>
        <div className="wb-panel-body space-y-2">
          {display.map((item, idx) => { const s = sev[item.severity as keyof typeof sev] ?? sev.中;
            return (<div key={idx} className="wb-list-item group !rounded-[12px] !px-3 !py-2.5" style={{"--item-accent":"var(--danger)"} as React.CSSProperties}><div className="flex items-center gap-2.5 w-full"><div className="flex shrink-0 flex-col items-center gap-1"><div className={`flex h-6 w-6 items-center justify-center rounded-[7px] text-[10px] font-bold ${s.bg} ${s.t}`}>{idx+1}</div><div className="text-xs font-semibold text-[var(--danger)]">{item.pendingDays}天</div></div><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold leading-snug text-[var(--foreground)] line-clamp-2">{item.project}</div><div className="mt-1 flex items-center gap-2"><span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklch,var(--accent)_20%,transparent)] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">{item.department}</span><span className={`text-xs ${s.t}`}>{item.reason}</span></div></div><div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[10px] font-bold ${s.bg} ${s.t}`}>{item.severity==="高"?"!":item.severity==="中"?"·":"○"}</div></div></div>);
          })}
          {display.length === 0 && <div className="flex flex-1 items-center justify-center text-[11px] text-[var(--muted-foreground)]">暂无风险项目</div>}
        </div>
      </section>
    </motion.div>
  );
}

// ── Project Scale ────────────────────────────────────────────────────────

type ScaleSegment = { label: string; range: string; min: number; max: number; count: number; amount: number; amountLabel: string; share: number; color: string };

function computeSegments(profile: DashboardData): ScaleSegment[] {
  const segs: ScaleSegment[] = [{label:"小额",range:"<10万",min:0,max:100000,count:0,amount:0,amountLabel:"",share:0,color:"var(--accent)"},{label:"中小",range:"10-50万",min:100000,max:500000,count:0,amount:0,amountLabel:"",share:0,color:"var(--success)"},{label:"中型",range:"50-200万",min:500000,max:2000000,count:0,amount:0,amountLabel:"",share:0,color:"var(--warning)"},{label:"大型",range:">200万",min:2000000,max:Infinity,count:0,amount:0,amountLabel:"",share:0,color:"var(--danger)"}];
  profile.trendSeries.forEach(ti => ti.projects.forEach(p => { const bs = p.budgetLabel; let b = 0; if(bs.includes("万")) b = parseFloat(bs.replace("万","").replace(",","").trim())*10000; else if(bs.includes("元")) b = parseFloat(bs.replace("元","").replace(/,/g,"")); for(const s of segs) if(b>=s.min&&b<s.max){s.count++;s.amount+=b;break;} }));
  const t = segs.reduce((sum,s)=>sum+s.count,0);
  segs.forEach(s=>{s.share=t>0?Math.round((s.count/t)*100):0;s.amountLabel=s.amount>=10000?`${(s.amount/10000).toFixed(1)}万`:`${s.amount.toFixed(0)}元`;});
  return segs;
}

function ProjectScalePanel({ profile, index, reducedMotion }: { profile: DashboardData; index: number; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const segs = useMemo(()=>computeSegments(profile),[profile]);
  const [activeSeg, setActiveSeg] = useState<ScaleSegment|null>(null);
  const total = segs.reduce((s,x)=>s+x.count,0);
  const mc = Math.max(...segs.map(s=>s.count),1);
  const totalAmount = segs.reduce((s,x)=>s+x.amount,0);
  const tal = totalAmount>=10000?`${(totalAmount/10000).toFixed(1)}万`:`${totalAmount.toFixed(0)}元`;

  const gp = (seg:ScaleSegment) => { const p:Array<{name:string;date:string;department:string;budgetLabel:string;status:string}>=[]; profile.trendSeries.forEach(ti=>ti.projects.forEach(proj=>{const bs=proj.budgetLabel;let b=0;if(bs.includes("万"))b=parseFloat(bs.replace("万","").replace(",","").trim())*10000;else if(bs.includes("元"))b=parseFloat(bs.replace("元","").replace(/,/g,""));if(b>=seg.min&&b<seg.max)p.push(proj);}));return p;};
  const sc = (s:string)=>s==="已成交"?"text-[var(--success)]":s==="待定"?"text-[var(--warning)]":"text-[var(--danger)]";

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <section className="wb-panel h-full">
          <div className="wb-panel-header"><div className="flex items-center gap-2"><BarChart3 size={15} className="text-[var(--warning)]" /><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">项目规模分析</h2></div><div className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--warning)_25%,transparent)] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--warning)]">{total} 项 · {tal}</div></div>
          <div className="wb-panel-body gap-2 flex flex-col">
            {segs.map((seg,i)=>{const bw=(seg.count/mc)*100;return <button key={seg.label} onClick={()=>setActiveSeg(seg)} className="scale-row group flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[2px_2px_6px_oklch(0.55_0.03_258/0.08),-1px_-1px_4px_oklch(1_0_0/0.6)]"><div className="flex shrink-0 w-10 flex-col items-start leading-tight"><span className="text-[11px] font-semibold text-[var(--foreground)]">{seg.label}</span><span className="text-[10px] text-[var(--muted-foreground)]">{seg.range}</span></div><div className="flex-1 h-5 min-w-0 rounded-[5px] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] overflow-hidden"><motion.div initial={{width:0}} animate={{width:`${bw}%`}} transition={{duration:0.6,delay:i*0.1,ease:easeOutQuint}} className="h-full rounded-[5px] opacity-85" style={{backgroundColor:seg.color}}/></div><div className="flex shrink-0 w-11 flex-col items-end leading-tight"><span className="text-[11px] font-bold" style={{color:seg.color}}>{seg.count}项</span><span className="text-[10px] text-[var(--muted-foreground)]">{seg.share}%</span></div><ChevronRight size={13} className="shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 group-hover:translate-x-0.5"/></button>;})}
            {total===0&&<div className="flex flex-1 items-center justify-center text-[11px] text-[var(--muted-foreground)]">暂无项目数据</div>}
          </div>
        </section>
      </motion.div>
      {activeSeg && <Modal open onClose={()=>setActiveSeg(null)} size="md" title={<span className="flex items-center gap-3"><BarChart3 size={20} className="text-[var(--warning)]"/><span className="text-base font-semibold tracking-[-0.03em] text-[var(--foreground)]">{activeSeg.label}项目</span></span>} description={<span className="flex items-center gap-2"><span className="text-[11px] font-bold" style={{color:activeSeg.color}}>{activeSeg.count} 项</span><span className="text-xs text-[var(--muted-foreground)]">预算范围 {activeSeg.range}</span></span>}><div className="grid grid-cols-3 gap-2 mb-4">{[{l:"项目数",v:activeSeg.count,c:activeSeg.color},{l:"占比",v:`${activeSeg.share}%`,c:"var(--accent)"},{l:"金额",v:activeSeg.amountLabel,c:"var(--success)"}].map((s,i)=><div key={i} className="neu-card-static rounded-[12px] px-3 py-2 text-center"><div className="text-xs uppercase tracking-[0.1em] text-[var(--muted-foreground)]">{s.l}</div><div className="mt-1 text-[14px] font-bold" style={{color:s.c}}>{s.v}</div></div>)}</div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-2"><FolderKanban size={12}/> 项目列表</div><div className="space-y-1.5 max-h-[300px] overflow-y-auto">{gp(activeSeg).map((p,idx)=><div key={idx} className="neu-card-static rounded-[10px] flex items-center gap-3 px-3 py-2"><div className="flex-1 min-w-0"><div className="truncate text-[11px] font-medium text-[var(--foreground)]">{p.name}</div><div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><span>{p.date}</span><span>·</span><span>{p.department}</span></div></div><div className="text-right shrink-0"><div className="text-xs font-bold text-[var(--foreground)]">{p.budgetLabel}</div><div className={`text-xs ${sc(p.status)}`}>{p.status}</div></div></div>)}</div></Modal>}
    </>
  );
}

// ── Method Pie ───────────────────────────────────────────────────────────

type MethodDetail = { name:string;count:number;amount:number;amountLabel:string;share:number;projects:Array<{name:string;date:string;department:string;budgetLabel:string;awardLabel:string;status:string}> };
const PC = ["oklch(0.63 0.128 247)","oklch(0.55 0.14 164)","oklch(0.65 0.15 83)","oklch(0.55 0.14 280)","oklch(0.6 0.15 27)","oklch(0.55 0.12 175)"];

function MethodPieChartPanel({ profile, index, reducedMotion }: { profile: DashboardData; index: number; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const [hi, setHi] = useState<number|null>(null);
  const [am, setAm] = useState<MethodDetail|null>(null);
  const total = profile.methodStats.reduce((s,m)=>s+m.count,0);
  const cx=100,cy=100,r=70,ir=45;
  const segs = (()=>{let a=0;return profile.methodStats.map((m,i)=>{const ang=(m.share/100)*360;const s={sa:a,ea:a+ang,c:PC[i%PC.length],m};a+=ang;return s;});})();
  const sc=(s:string)=>s==="已成交"?"text-[var(--success)]":s==="待定"?"text-[var(--warning)]":"text-[var(--danger)]";

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <section className="wb-panel h-full">
          <div className="wb-panel-header"><div className="flex items-center gap-2.5"><Layers size={15} className="text-[var(--success)]"/><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">采购方式分布</h2></div><div className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--success)_25%,transparent)] bg-[color-mix(in_oklch,var(--success)_8%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--success)]">{total} 项</div></div>
          <div className="wb-panel-body flex items-center gap-4">
            <div className="relative shrink-0"><svg width="200" height="200" viewBox="0 0 200 200">{segs.map((seg,i)=>{const sr=((seg.sa-90)*Math.PI)/180,er=((seg.ea-90)*Math.PI)/180,la=seg.ea-seg.sa>180?1:0;const x1=cx+r*Math.cos(sr),y1=cy+r*Math.sin(sr),x2=cx+r*Math.cos(er),y2=cy+r*Math.sin(er),x3=cx+ir*Math.cos(er),y3=cy+ir*Math.sin(er),x4=cx+ir*Math.cos(sr),y4=cy+ir*Math.sin(sr);return <path key={i} d={`M ${x1} ${y1} A ${r} ${r} 0 ${la} 1 ${x2} ${y2} L ${x3} ${y3} A ${ir} ${ir} 0 ${la} 0 ${x4} ${y4} Z`} fill={seg.c} opacity={hi===i?1:0.85} className="cursor-pointer transition-all duration-200" onMouseEnter={()=>setHi(i)} onMouseLeave={()=>setHi(null)} onClick={()=>setAm(seg.m as MethodDetail)} style={{transform:hi===i?"scale(1.02)":"scale(1)",transformOrigin:"center"}}/>;})}<text x={cx} y={cy-5} textAnchor="middle" className="fill-[var(--foreground)]" style={{fontSize:"18px",fontWeight:"700"}}>{total}</text><text x={cx} y={cy+12} textAnchor="middle" className="fill-[var(--muted-foreground)]" style={{fontSize:"10px"}}>总项目</text></svg></div>
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">{profile.methodStats.slice(0,6).map((m,i)=><button key={m.name} className={`flex items-center gap-2 rounded-[8px] px-2 py-1.5 cursor-pointer text-left w-full ${hi===i?"bg-[color-mix(in_oklch,var(--success)_8%,transparent)]":"hover:bg-[color-mix(in_oklch,var(--success)_4%,transparent)]"}`} onMouseEnter={()=>setHi(i)} onMouseLeave={()=>setHi(null)} onClick={()=>setAm(m as MethodDetail)}><div className="h-3 w-3 shrink-0 rounded-[4px]" style={{backgroundColor:PC[i%PC.length]}}/><span className="flex-1 truncate text-[11px] font-medium text-[var(--foreground)]">{m.name}</span><span className="text-[11px] font-bold" style={{color:PC[i%PC.length]}}>{m.share}%</span></button>)}</div>
          </div>
        </section>
      </motion.div>
      {am && <Modal open onClose={()=>setAm(null)} size="md" title={<span className="flex items-center gap-3"><Layers size={20} className="text-[var(--success)]"/><span className="text-base font-semibold tracking-[-0.03em] text-[var(--foreground)]">{am.name}</span></span>} description={<span className="flex items-center gap-2"><span className="text-[11px] font-bold text-[var(--success)]">{am.count} 项</span><span className="text-xs text-[var(--muted-foreground)]">采购金额 {am.amountLabel}</span></span>}><div className="grid grid-cols-3 gap-2 mb-4">{[{l:"占比",v:`${am.share}%`,c:"var(--success)"},{l:"项目数",v:am.count,c:"var(--accent)"},{l:"金额",v:am.amountLabel,c:"var(--warning)"}].map((s,i)=><div key={i} className="neu-card-static rounded-[12px] px-3 py-2 text-center"><div className="text-xs uppercase tracking-[0.1em] text-[var(--muted-foreground)]">{s.l}</div><div className="mt-1 text-[14px] font-bold" style={{color:s.c}}>{s.v}</div></div>)}</div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-2"><BarChart3 size={12}/> 采购项目</div><div className="space-y-1.5">{(am.projects??[]).map((p,idx)=><div key={idx} className="neu-card-static rounded-[10px] flex items-center gap-3 px-3 py-2"><div className="flex-1 min-w-0"><div className="truncate text-[11px] font-medium text-[var(--foreground)]">{p.name}</div><div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><span>{p.date}</span><span>·</span><span>{p.department}</span></div></div><div className="text-right shrink-0"><div className="text-xs font-bold text-[var(--foreground)]">{p.awardLabel||p.budgetLabel}</div><div className={`text-xs ${sc(p.status)}`}>{p.status}</div></div></div>)}</div></Modal>}
    </>
  );
}

// ── Non-Award Donut ──────────────────────────────────────────────────────

type NonAwardDetail = { label:string;count:number;detail:string;projects:Array<{name:string;date:string;department:string;budgetLabel:string;reason:string}> };
const NAC = ["oklch(0.6 0.15 27)","oklch(0.65 0.15 83)","oklch(0.63 0.128 247)","oklch(0.55 0.14 280)"];

function NonAwardDonutPanel({ profile, index, reducedMotion }: { profile: DashboardData; index: number; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const [hi, setHi] = useState<number|null>(null);
  const [ar, setAr] = useState<NonAwardDetail|null>(null);
  const total = profile.nonAwardReasons.reduce((s,r)=>s+r.count,0);
  const cx=100,cy=100,r=70,ir=45;
  const segs=(()=>{let a=0;return profile.nonAwardReasons.map((x,i)=>{const sh=total>0?(x.count/total)*100:0,ang=(sh/100)*360;const s={sa:a,ea:a+ang,c:NAC[i%NAC.length],r:x};a+=ang;return s;});})();

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <section className="wb-panel h-full">
          <div className="wb-panel-header"><div className="flex items-center gap-2"><AlertCircle size={15} className="text-[var(--danger)]"/><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">未成交原因分析</h2></div><div className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklch,var(--danger)_25%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--danger)]">{total} 项</div></div>
          <div className="wb-panel-body flex items-center gap-4">
            <div className="relative shrink-0"><svg width="200" height="200" viewBox="0 0 200 200">{segs.map((seg,i)=>{const sr=((seg.sa-90)*Math.PI)/180,er=((seg.ea-90)*Math.PI)/180,la=seg.ea-seg.sa>180?1:0;const x1=cx+r*Math.cos(sr),y1=cy+r*Math.sin(sr),x2=cx+r*Math.cos(er),y2=cy+r*Math.sin(er),x3=cx+ir*Math.cos(er),y3=cy+ir*Math.sin(er),x4=cx+ir*Math.cos(sr),y4=cy+ir*Math.sin(sr);return <path key={i} d={`M ${x1} ${y1} A ${r} ${r} 0 ${la} 1 ${x2} ${y2} L ${x3} ${y3} A ${ir} ${ir} 0 ${la} 0 ${x4} ${y4} Z`} fill={seg.c} opacity={hi===i?1:0.85} className="cursor-pointer transition-all duration-200" onMouseEnter={()=>setHi(i)} onMouseLeave={()=>setHi(null)} onClick={()=>setAr(seg.r as NonAwardDetail)} style={{transform:hi===i?"scale(1.02)":"scale(1)",transformOrigin:"center"}}/>;})}<text x={cx} y={cy-5} textAnchor="middle" className="fill-[var(--foreground)]" style={{fontSize:"18px",fontWeight:"700"}}>{total}</text><text x={cx} y={cy+12} textAnchor="middle" className="fill-[var(--muted-foreground)]" style={{fontSize:"10px"}}>未成交</text></svg></div>
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">{total===0?<div className="text-[11px] text-[var(--muted-foreground)]">无未成交项目</div>:profile.nonAwardReasons.map((x,i)=><button key={x.label} className={`flex items-center gap-2 rounded-[8px] px-2 py-1.5 cursor-pointer text-left w-full ${hi===i?"bg-[color-mix(in_oklch,var(--danger)_8%,transparent)]":"hover:bg-[color-mix(in_oklch,var(--danger)_4%,transparent)]"}`} onMouseEnter={()=>setHi(i)} onMouseLeave={()=>setHi(null)} onClick={()=>setAr(x as NonAwardDetail)}><div className="h-3 w-3 shrink-0 rounded-[4px]" style={{backgroundColor:NAC[i%NAC.length]}}/><span className="flex-1 truncate text-[11px] font-medium text-[var(--foreground)]">{x.label}</span><span className="text-[11px] font-bold" style={{color:NAC[i%NAC.length]}}>{x.count}项</span></button>)}</div>
          </div>
        </section>
      </motion.div>
      {ar && <Modal open onClose={()=>setAr(null)} size="md" title={<span className="flex items-center gap-3"><AlertCircle size={20} className="text-[var(--danger)]"/><span className="text-base font-semibold tracking-[-0.03em] text-[var(--foreground)]">{ar.label}</span></span>} description={<span className="flex items-center gap-2"><span className="text-[11px] font-bold text-[var(--danger)]">{ar.count} 项</span><span className="text-xs text-[var(--muted-foreground)]">未成交项目</span></span>}><div className="grid grid-cols-2 gap-2 mb-4"><div className="neu-card-static rounded-[12px] px-3 py-2 text-center"><div className="text-xs uppercase tracking-[0.1em] text-[var(--muted-foreground)]">项目数</div><div className="mt-1 text-[14px] font-bold text-[var(--danger)]">{ar.count}</div></div><div className="neu-card-static rounded-[12px] px-3 py-2 text-center"><div className="text-xs uppercase tracking-[0.1em] text-[var(--muted-foreground)]">占比</div><div className="mt-1 text-[14px] font-bold text-[var(--warning)]">{((ar.count/total)*100).toFixed(1)}%</div></div></div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-2"><BarChart3 size={12}/> 相关项目</div><div className="space-y-1.5">{(ar.projects??[]).map((p,idx)=><div key={idx} className="neu-card-static rounded-[10px] flex items-center gap-3 px-3 py-2"><div className="flex-1 min-w-0"><div className="truncate text-[11px] font-medium text-[var(--foreground)]">{p.name}</div><div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><span>{p.date}</span><span>·</span><span>{p.department}</span></div></div><div className="text-right shrink-0"><div className="text-xs font-bold text-[var(--foreground)]">{p.budgetLabel}</div><div className="text-xs text-[var(--danger)]">{p.reason}</div></div></div>)}</div></Modal>}
    </>
  );
}

// ── Supplier Cards ───────────────────────────────────────────────────────

function SupplierCards({ suppliers, index, reducedMotion }: { suppliers: SupplierDetail[]; index: number; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.06);
  const [as, setAs] = useState<SupplierDetail|null>(null);
  const ds = suppliers.slice(0, 6);
  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <section className="wb-panel h-full">
          <div className="wb-panel-header"><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">重点供应商动态</h2><span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-[color-mix(in_oklch,var(--accent)_20%,transparent)] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] text-[10px] font-bold text-[var(--accent)]">{suppliers.length}</span></div>
          <div className="wb-panel-body"><div className="grid grid-cols-2 grid-rows-3 gap-2 flex-1">
            {ds.map(s=><button key={s.id} onClick={()=>setAs(s)} className="neu-card text-left rounded-[12px] !rounded-[12px] px-3 py-2.5"><div className="flex items-start gap-2"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[color-mix(in_oklch,var(--accent)_20%,transparent)] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] text-[10px] font-bold text-[var(--accent)]">{s.name.slice(0,2)}</div><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold text-[var(--foreground)]">{s.name}</div><div className="mt-0.5 flex items-center gap-1.5"><span className="text-xs font-bold text-[var(--success)]">{s.winCount}/{s.participatedCount}</span><span className="text-xs text-[var(--muted-foreground)]">中标</span><span className="ml-auto text-xs font-bold text-[var(--foreground)]">{s.awardAmountLabel}</span></div></div></div><div className="mt-1.5 flex flex-wrap gap-1">{s.tags.slice(0,2).map(t=><span key={t} className="inline-flex items-center rounded-full border border-[color-mix(in_oklch,var(--accent)_15%,transparent)] bg-[color-mix(in_oklch,var(--accent)_5%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">{t}</span>)}</div></button>)}
          </div></div>
        </section>
      </motion.div>
      {as && <Modal open onClose={()=>setAs(null)} size="md" title={<span className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[color-mix(in_oklch,var(--accent)_25%,transparent)] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[14px] font-bold text-[var(--accent)]">{as.name.slice(0,2)}</span><span className="text-base font-semibold tracking-[-0.03em] text-[var(--foreground)]">{as.name}</span></span>} description={<span className="flex items-center gap-2"><span className="text-[11px] font-bold text-[var(--success)]">{as.winCount}/{as.participatedCount}</span><span className="text-xs text-[var(--muted-foreground)]">中标</span><span className="text-[11px] font-bold text-[var(--foreground)]">{as.awardAmountLabel}</span></span>}><div className="flex flex-wrap gap-1.5 mb-4">{as.tags.map(t=><span key={t} className="inline-flex items-center rounded-full border border-[color-mix(in_oklch,var(--accent)_15%,transparent)] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-2 py-0.5 text-[10px] text-[var(--accent)]">{t}</span>)}</div><div className="grid grid-cols-3 gap-2 mb-4">{[{l:"中标率",v:`${as.hitRate}%`,c:"var(--success)"},{l:"中标数",v:as.winCount,c:"var(--success)"},{l:"参与数",v:as.participatedCount,c:"var(--warning)"}].map((s,i)=><div key={i} className="neu-card-static rounded-[12px] px-3 py-2 text-center"><div className="text-xs uppercase tracking-[0.1em] text-[var(--muted-foreground)]">{s.l}</div><div className="mt-1 text-[14px] font-bold" style={{color:s.c}}>{s.v}</div></div>)}</div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-2"><BarChart3 size={12}/> 活跃特征</div><div className="grid grid-cols-2 gap-1.5 mb-3">{[{l:"主要方式",v:as.topMethod},{l:"活跃部门",v:as.topDepartment}].map((f,i)=><div key={i} className="neu-card-static rounded-[10px] px-3 py-2"><div className="text-xs text-[var(--muted-foreground)]">{f.l}</div><div className="text-[11px] font-medium text-[var(--foreground)]">{f.v}</div></div>)}</div>{as.recentProcurements.length>0&&<div className="mb-3"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-2"><FolderKanban size={12}/> 近期参与项目</div><div className="space-y-1.5">{as.recentProcurements.slice(0,4).map((p,i)=><div key={i} className="neu-card-static rounded-[10px] px-3 py-2"><div className="truncate text-[11px] font-medium text-[var(--foreground)]">{p.project}</div><div className="mt-0.5 flex items-center justify-between text-xs"><span className="text-[var(--muted-foreground)]">{p.date}</span><span className={`font-bold ${p.result.includes("未")||p.result.includes("审查")?"text-[var(--danger)]":"text-[var(--success)]"}`}>{p.result}</span></div></div>)}</div></div>}{as.winProjects.length>0&&<div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-2"><FolderKanban size={12}/> 中标项目</div><div className="space-y-1.5">{as.winProjects.slice(0,3).map(wp=><div key={wp.project} className="neu-card-static rounded-[10px] px-3 py-2"><div className="truncate text-[11px] font-medium text-[var(--foreground)]">{wp.project}</div><div className="mt-0.5 text-xs font-bold text-[var(--success)]">{wp.awardAmountLabel}</div></div>)}</div></div>}</Modal>}
    </>
  );
}

// ── Trend Chart ──────────────────────────────────────────────────────────

type TrendDetail = { date:string;label:string;count:number;amount:number;projects:Array<{name:string;date:string;department:string;method:string;budgetLabel:string;awardLabel:string;status:string}> };

function TrendChartPanel({ profile, index, reducedMotion }: { profile: DashboardData; index: number; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const [hoveredIdx, setHoveredIdx] = useState<number|null>(null);
  const [activeTrend, setActiveTrend] = useState<TrendDetail|null>(null);
  const cr = useRef<HTMLDivElement>(null);
  const [cw, setCW] = useState(1400);
  useEffect(()=>{const u=()=>{if(cr.current) setCW(cr.current.offsetWidth)};u();window.addEventListener("resize",u);return ()=>window.removeEventListener("resize",u);},[]);

  const tc = profile.trendSeries.reduce((s,i)=>s+i.count,0);
  const ta = profile.trendSeries.reduce((s,i)=>s+i.amount,0);
  const mc = Math.max(...profile.trendSeries.map(i=>i.count),1);
  const ma = Math.max(...profile.trendSeries.map(i=>i.amount),1);
  const pc = profile.trendSeries.reduce((b,v,i,a)=>v.count>a[b].count?i:b,0);
  const pa = profile.trendSeries.reduce((b,v,i,a)=>v.amount>a[b].amount?i:b,0);

  const ch=220,lp=50,rp=50,tp=30,bp=50;
  const caw=cw-lp-rp,cah=ch-tp-bp;
  const dc=profile.trendSeries.length||1;
  const bw=Math.max(16,Math.min(48,(caw/dc)*0.6));
  const gap=Math.max(4,Math.min(12,bw*0.3));
  const tw=dc*(bw+gap)-gap;
  const sx=lp+Math.max(0,(caw-tw)/2);
  const sc=(s:string)=>s==="已成交"?"text-[var(--success)]":s==="待定"?"text-[var(--warning)]":"text-[var(--danger)]";

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <section className="wb-panel h-full">
          <div className="wb-panel-header"><div className="flex items-center gap-2.5"><BarChart3 size={15} className="text-[var(--accent)]"/><div><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">采购执行趋势</h2><div className="text-xs text-[var(--muted-foreground)]">按日期统计采购项目数量与成交金额</div></div></div><div className="flex items-center gap-3"><span className="flex items-center gap-1.5 rounded-[8px] border border-[color-mix(in_oklch,var(--accent)_15%,transparent)] bg-[color-mix(in_oklch,var(--accent)_4%,transparent)] px-2.5 py-1 text-xs font-bold text-[var(--accent)]"><span className="h-2 w-2 rounded-[3px] bg-[var(--accent)]"/>{tc}项</span><span className="flex items-center gap-1.5 rounded-[8px] border border-[color-mix(in_oklch,var(--success)_15%,transparent)] bg-[color-mix(in_oklch,var(--success)_4%,transparent)] px-2.5 py-1 text-xs font-bold text-[var(--success)]"><span className="h-2 w-2 rounded-[3px] bg-[var(--success)]"/>{ta.toFixed(1)}万</span></div></div>
          <div ref={cr} className="wb-panel-body"><div className="neu-card-static rounded-[14px] p-3 overflow-hidden">
            <svg width="100%" height={ch} viewBox={`0 0 ${cw} ${ch}`} preserveAspectRatio="xMidYMid meet" className="overflow-visible" onMouseLeave={()=>setHoveredIdx(null)}>
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="oklch(0.63 0.128 247)"/><stop offset="100%" stopColor="oklch(0.7 0.12 247 / 0.8)"/></linearGradient>
                <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="oklch(0.55 0.14 164)"/><stop offset="100%" stopColor="oklch(0.6 0.13 164)"/></linearGradient>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="oklch(0.55 0.14 164 / 0.2)"/><stop offset="100%" stopColor="oklch(0.55 0.14 164 / 0.02)"/></linearGradient>
              </defs>
              {[0,0.5,1].map((t,i)=>{const y=tp+(1-t)*cah;return <line key={i} x1={lp} y1={y} x2={cw-rp} y2={y} stroke="oklch(0.65 0.03 250 / 0.25)" strokeWidth="1" strokeDasharray={t===0?"none":"4 3"}/>;})}
              {[0,0.5,1].map((t,i)=>{const y=tp+(1-t)*cah;return <text key={`c-${i}`} x={lp-6} y={y+3} textAnchor="end" style={{fontSize:"9px",fill:"oklch(0.6 0.06 250)",fontWeight:"500"}}>{Math.round(t*mc)}</text>;})}
              {[0,0.5,1].map((t,i)=>{const y=tp+(1-t)*cah;return <text key={`a-${i}`} x={cw-rp+6} y={y+3} textAnchor="start" style={{fontSize:"9px",fill:"oklch(0.5 0.12 164 / 0.7)",fontWeight:"500"}}>{(t*ma).toFixed(0)}万</text>;})}
              {profile.trendSeries.map((item,i)=>{const bh=Math.max(2,(item.count/mc)*cah);const x=sx+i*(bw+gap),y=tp+cah-bh;return <g key={`bar-${i}`}><rect x={x} y={y} width={bw} height={bh} rx={4} fill={i===pc?"url(#barGrad)":"oklch(0.63 0.128 247 / 0.5)"} opacity={hoveredIdx===i?1:0.85} className="cursor-pointer transition-all duration-200" onMouseEnter={()=>setHoveredIdx(i)} onClick={()=>setActiveTrend(item as TrendDetail)}/><text x={x+bw/2} y={ch-bp+14} textAnchor="middle" style={{fontSize:"9px",fill:"oklch(0.5 0.04 250 / 0.6)",fontWeight:"500"}}>{item.label}</text></g>;})}
              {(()=>{const pts=profile.trendSeries.map((item,i)=>({x:sx+i*(bw+gap)+bw/2,y:tp+(1-item.amount/ma)*cah}));if(pts.length===0)return null;const d=pts.map((p,i)=>i===0?`M ${p.x} ${p.y}`:`C ${pts[i-1].x+(p.x-pts[i-1].x)*0.4} ${pts[i-1].y}, ${p.x-(p.x-pts[i-1].x)*0.4} ${p.y}, ${p.x} ${p.y}`).join(" ");const ad=`${d} L ${pts[pts.length-1].x} ${tp+cah} L ${pts[0].x} ${tp+cah} Z`;return <><path d={ad} fill="url(#areaGrad)"/><path d={d} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{pts.map((p,i)=><circle key={`dot-${i}`} cx={p.x} cy={p.y} r={i===pa?5:hoveredIdx===i?4:3} fill="oklch(0.55 0.14 164)" stroke="oklch(1 0 0 / 0.95)" strokeWidth="2" className="cursor-pointer" onMouseEnter={()=>setHoveredIdx(i)} onClick={()=>setActiveTrend(profile.trendSeries[i] as TrendDetail)}/>)}</>;})()}
              {hoveredIdx!==null&&profile.trendSeries[hoveredIdx]&&<line x1={sx+hoveredIdx*(bw+gap)+bw/2} y1={tp} x2={sx+hoveredIdx*(bw+gap)+bw/2} y2={tp+cah} stroke="oklch(0.63 0.128 247 / 0.2)" strokeWidth="1" strokeDasharray="3 2"/>}
            </svg>
            <div className="flex items-center justify-center gap-4 mt-2"><span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"><span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--accent)]"/> 采购数量</span><span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"><span className="h-0.5 w-4 rounded-full bg-[var(--success)]"/> 成交金额</span></div>
          </div></div>
        </section>
      </motion.div>
      {activeTrend && <Modal open onClose={()=>setActiveTrend(null)} size="md" title={<span className="flex items-center gap-3"><CalendarRange size={20} className="text-[var(--accent)]"/><span className="text-base font-semibold tracking-[-0.03em] text-[var(--foreground)]">{activeTrend.label}</span></span>} description={<span className="flex items-center gap-2"><span className="text-[11px] font-bold text-[var(--accent)]">{activeTrend.count} 项</span><span className="text-xs text-[var(--muted-foreground)]">成交金额 {activeTrend.amount.toFixed(1)}万</span></span>}><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-2"><FolderKanban size={12}/> 当日项目</div><div className="space-y-1.5">{(activeTrend.projects??[]).map((p,idx)=><div key={idx} className="neu-card-static rounded-[10px] flex items-center gap-3 px-3 py-2"><div className="flex-1 min-w-0"><div className="truncate text-[11px] font-medium text-[var(--foreground)]">{p.name}</div><div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><span>{p.department}</span><span>·</span><span>{p.method}</span></div></div><div className="text-right shrink-0"><div className="text-xs font-bold text-[var(--foreground)]">{p.awardLabel||p.budgetLabel}</div><div className={`text-xs ${sc(p.status)}`}>{p.status}</div></div></div>)}</div></Modal>}
    </>
  );
}

// ── Department ───────────────────────────────────────────────────────────

type DepartmentDetail = { name:string;amount:number;amountLabel:string;completedRate:number;topMethod:string;projects:Array<{name:string;date:string;method:string;budgetLabel:string;awardLabel:string;status:string}> };
const DBC = ["var(--accent)","var(--success)","var(--warning)","oklch(0.55 0.14 280)","var(--danger)","oklch(0.55 0.12 175)"];

function DepartmentPanel({ profile, index, reducedMotion }: { profile: DashboardData; index: number; reducedMotion: boolean }) {
  const { initial, animate, transition } = fadeIn(index, reducedMotion, 0.05);
  const maxAmt = Math.max(...profile.departmentStats.map(d=>d.amount),1);
  const totalAmt = profile.departmentStats.reduce((s,d)=>s+d.amount,0);
  const [ad, setAd] = useState<DepartmentDetail|null>(null);
  const depts = profile.departmentStats.slice(0,6);
  const sc=(s:string)=>s==="已成交"?"text-[var(--success)]":s==="待定"?"text-[var(--warning)]":"text-[var(--danger)]";

  return (
    <>
      <motion.div {...{ initial, animate, transition }} className="h-full">
        <section className="wb-panel h-full">
          <div className="wb-panel-header"><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">各部门采购分布</h2></div>
          <div className="wb-panel-body space-y-2">
            {depts.map((d,i)=>{const pct=(d.amount/maxAmt)*100,sh=(d.amount/totalAmt)*100;const c=DBC[i];
              return <button key={d.name} onClick={()=>setAd(d as DepartmentDetail)} className="wb-list-item group w-full text-left !border-none !px-0 !py-1" style={{"--item-accent":c} as React.CSSProperties}>
                <div className="mb-1 flex items-center justify-between"><div className="flex items-center gap-2"><span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-white/50 bg-white/60 text-[10px] font-bold text-[var(--muted-foreground)]">{i+1}</span><span className="text-[11px] font-medium text-[var(--foreground)]">{d.name}</span></div><div className="flex items-center gap-2"><span className="text-xs text-[var(--muted-foreground)]">{sh.toFixed(0)}%</span><span className="text-[11px] font-bold text-[var(--foreground)]">{d.amountLabel}</span></div></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]"><div className="h-full rounded-full transition-all duration-700" style={{width:`${pct}%`,backgroundColor:c}}/></div>
                <div className="mt-0.5 flex items-center justify-between"><span className="text-xs text-[var(--muted-foreground)]">完成率 {d.completedRate}%</span><span className={`h-1 w-1 rounded-full ${d.completedRate>=80?"bg-[var(--success)]":d.completedRate>=60?"bg-[var(--warning)]":"bg-[var(--danger)]"}`}/></div>
              </button>;
            })}
          </div>
        </section>
      </motion.div>
      {ad && <Modal open onClose={()=>setAd(null)} size="md" title={<span className="flex items-center gap-3"><FolderKanban size={20} className="text-[var(--accent)]"/><span className="text-base font-semibold tracking-[-0.03em] text-[var(--foreground)]">{ad.name}</span></span>} description={<span className="flex items-center gap-2"><span className="text-[11px] font-bold text-[var(--accent)]">{ad.amountLabel}</span><span className="text-xs text-[var(--muted-foreground)]">采购金额</span></span>}><div className="grid grid-cols-3 gap-2 mb-4">{[{l:"完成率",v:`${ad.completedRate}%`,c:"var(--accent)"},{l:"项目数",v:(ad.projects??[]).length,c:"var(--success)"},{l:"主要方式",v:ad.topMethod??"-",c:"var(--warning)"}].map((s,i)=><div key={i} className="neu-card-static rounded-[12px] px-3 py-2 text-center"><div className="text-xs uppercase tracking-[0.1em] text-[var(--muted-foreground)]">{s.l}</div><div className="mt-1 text-[14px] font-bold" style={{color:s.c}}>{s.v}</div></div>)}</div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)] mb-2"><BarChart3 size={12}/> 采购项目</div><div className="space-y-1.5">{(ad.projects??[]).map((p,idx)=><div key={idx} className="neu-card-static rounded-[10px] flex items-center gap-3 px-3 py-2"><div className="flex-1 min-w-0"><div className="truncate text-[11px] font-medium text-[var(--foreground)]">{p.name}</div><div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><span>{p.date}</span><span>·</span><span>{p.method}</span></div></div><div className="text-right shrink-0"><div className="text-xs font-bold text-[var(--foreground)]">{p.awardLabel||p.budgetLabel}</div><div className={`text-xs ${sc(p.status)}`}>{p.status}</div></div></div>)}</div></Modal>}
    </>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

type DashboardHomeProps = { currentUserRole: AuthRole };
const ANALYSIS_CACHE_KEY = "dashboard_analysis_cache";
type AnalysisCache = { dataHash:string;result:DashboardAnalysisResult;timestamp:number };

function generateDataHash(data: DashboardData): string {
  return JSON.stringify({totalBudget:data.summary.totalBudget,totalAward:data.summary.totalAward,totalSavings:data.summary.totalSavings,totalCount:data.summary.totalCount,completedCount:data.summary.completedCount,startDate:data.range.startDate,endDate:data.range.endDate});
}

export function DashboardHome({ currentUserRole }: DashboardHomeProps) {
  const reducedMotion = useReducedMotion()??false;
  const [data,setData] = useState<DashboardData|null>(null);
  const [loading,setLoading] = useState(true);
  const [loadErr,setLoadErr] = useState<string|null>(null);
  const [analysis,setAnalysis] = useState<DashboardAnalysisResult|null>(null);
  const [alLoading,setAlLoading] = useState(false);
  const [alErr,setAlErr] = useState<string|null>(null);
  const [dataHash,setDataHash] = useState<string|null>(null);
  const [showDP,setShowDP] = useState(false);
  const [startDate,setStartDate] = useState("");
  const [endDate,setEndDate] = useState("");
  const [companyId,setCompanyId] = useState("all");
  const dateBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(()=>{setCompanyId(readInitialCompanyId());},[]);

  const bap = useCallback((d:DashboardData):DashboardAnalysisPayload=>({
    rangeLabel:d.range.startDate&&d.range.endDate?`${d.range.startDate} ~ ${d.range.endDate}`:"全部",
    startDate:d.range.startDate??"",endDate:d.range.endDate??"",
    summary:{totalCount:d.summary.totalCount,completedCount:d.summary.completedCount,abnormalCount:d.summary.abnormalCount,totalBudget:d.summary.totalBudgetLabel,totalAward:d.summary.totalAwardLabel,totalSavings:d.summary.totalSavingsLabel},
    trendSeries:d.trendSeries.map(t=>({label:t.label,count:t.count,amount:t.amount})),
    departmentStats:d.departmentStats.map(x=>({name:x.name,amount:x.amountLabel})),
    methodStats:d.methodStats.map(m=>({name:m.name,share:`${m.share}%`})),
    attachmentProgress:d.attachmentProgress.map(a=>({label:a.label,rate:`${a.rate}%`})),
    supplierStats:d.supplierStats.map(s=>({name:s.name,participatedCount:s.participatedCount,winCount:s.winCount,awardAmount:s.awardAmountLabel})),
    resultStats:d.resultStats.map(r=>({label:r.label,count:r.count,amount:r.amountLabel})),
    nonAwardReasons:d.nonAwardReasons.map(n=>({label:n.label,count:n.count,detail:n.detail})),
    riskProjects:d.riskProjects.map(r=>({project:r.project,department:r.department,reason:r.reason,pendingDays:r.pendingDays,severity:r.severity})),
  }),[]);

  const hra = useCallback(async(force=false)=>{
    if(!data)return;const nh=generateDataHash(data);
    if(!force){try{const c=localStorage.getItem(ANALYSIS_CACHE_KEY);if(c){const cache:AnalysisCache=JSON.parse(c);if(cache.dataHash===nh&&cache.result&&Array.isArray(cache.result.highlights)&&Array.isArray(cache.result.concerns)&&Array.isArray(cache.result.suggestions)){setAnalysis(cache.result);setDataHash(nh);return;}localStorage.removeItem(ANALYSIS_CACHE_KEY);}}catch{}}
    setAnalysis(null);setAlErr(null);setAlLoading(true);
    try{const r=await fetchDashboardAnalysis(bap(data));setAnalysis(r);setDataHash(nh);try{localStorage.setItem(ANALYSIS_CACHE_KEY,JSON.stringify({dataHash:nh,result:r,timestamp:Date.now()}));}catch{}}catch(err){setAlErr(err instanceof Error?err.message:"分析请求失败，请稍后重试");}finally{setAlLoading(false);}
  },[data,bap]);

  const suppliers:SupplierDetail[]=useMemo(()=>{if(!data)return[];return data.supplierStats.map(s=>({...s,id:s.name}));},[data]);

  const ld = useCallback(async(s?:string,e?:string,c?:string)=>{setLoading(true);setLoadErr(null);try{const d=await fetchDashboardData(s,e,c);setData(d);setAnalysis(null);setDataHash(null);}catch(err){setLoadErr(err instanceof Error?err.message:"加载仪表盘数据失败");}finally{setLoading(false);}},[],);
  useEffect(()=>{ld();},[ld]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{ld(startDate||undefined,endDate||undefined,companyId);},[companyId]);

  const hadr = useCallback(()=>{ld(startDate||undefined,endDate||undefined,companyId);setShowDP(false);},[startDate,endDate,companyId,ld]);
  const hrdr = useCallback(()=>{setStartDate("");setEndDate("");ld();setShowDP(false);},[ld]);

  const dp = {
    tm:()=>{const d=new Date(),y=d.getFullYear(),m=d.getMonth()+1,ld2=new Date(y,m,0).getDate();setStartDate(`${y}-${String(m).padStart(2,"0")}-01`);setEndDate(`${y}-${String(m).padStart(2,"0")}-${ld2}`);},
    tq:()=>{const d=new Date(),y=d.getFullYear(),q=Math.floor(d.getMonth()/3),sm=q*3+1,em=q*3+3,ld2=new Date(y,em,0).getDate();setStartDate(`${y}-${String(sm).padStart(2,"0")}-01`);setEndDate(`${y}-${String(em).padStart(2,"0")}-${ld2}`);},
    fh:()=>{const y=new Date().getFullYear();setStartDate(`${y}-01-01`);setEndDate(`${y}-06-30`);},
    fy:()=>{const y=new Date().getFullYear();setStartDate(`${y}-01-01`);setEndDate(`${y}-12-31`);},
    lm:()=>{const d=new Date();d.setMonth(d.getMonth()-1);const y=d.getFullYear(),m=d.getMonth()+1,ld2=new Date(y,m,0).getDate();setStartDate(`${y}-${String(m).padStart(2,"0")}-01`);setEndDate(`${y}-${String(m).padStart(2,"0")}-${ld2}`);},
    lq:()=>{const d=new Date(),y=d.getFullYear(),q=Math.floor(d.getMonth()/3);if(q===0){setStartDate(`${y-1}-10-01`);setEndDate(`${y-1}-12-31`);}else{const sm=(q-1)*3+1,em=q*3,ld2=new Date(y,em,0).getDate();setStartDate(`${y}-${String(sm).padStart(2,"0")}-01`);setEndDate(`${y}-${String(em).padStart(2,"0")}-${ld2}`);}},
  };

  useEffect(()=>{if(data&&!analysis&&!alLoading)hra(false);},[data,analysis,alLoading,hra]);

  if(loading||!data)return <div className="flex h-[60vh] items-center justify-center"><div className="flex flex-col items-center gap-3"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[color-mix(in_oklch,var(--accent)_30%,transparent)] border-t-[var(--accent)]"/><span className="text-sm text-[var(--muted-foreground)]">加载中...</span></div></div>;
  if(loadErr)return <div className="flex h-[60vh] items-center justify-center"><div className="neu-card-static flex flex-col items-center gap-4 px-8 py-10 text-center"><p className="text-sm font-semibold text-[var(--danger)]">数据加载失败</p><p className="text-xs text-[var(--muted-foreground)]">{loadErr}</p><button type="button" onClick={()=>{setLoadErr(null);setLoading(true);}} className="neu-btn-primary">重试</button></div></div>;

  const cr = (data.summary.completedCount/Math.max(data.summary.totalCount,1))*100;
  const sr = (data.summary.totalSavings/Math.max(data.summary.awardedBudget,1))*100;
  const { initial:ci, animate:ca, transition:ct } = fadeIn(0, reducedMotion, 0.04);

  return <>
    <motion.div animate={reducedMotion?undefined:{opacity:1}} transition={{duration:0.28,ease:easeOutQuint}}>
      {/* ── page-hero 标题卡（对标采购进度设计）── */}
      <motion.div {...{initial:ci,animate:ca,transition:ct}} className="page-hero mb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="page-hero__left">
            <div className="page-hero__icon"><BarChart3 size={20} strokeWidth={1.8}/></div>
            <div className="min-w-0">
              <div className="page-hero__title">采购中心仪表盘</div>
              <div className="page-hero__sub">采购运营全局概览与数据驾驶舱</div>
            </div>
          </div>
          <div className="page-hero__right">
            <span className="page-hero__stat page-hero__stat--info">共 {data.summary.totalCount} 项</span>
            {data.summary.abnormalCount > 0 && (
              <span className="page-hero__stat page-hero__stat--warn">
                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[oklch(0.67_0.14_32)]" />
                异常 {data.summary.abnormalCount}
              </span>
            )}
            <CompanySelect value={companyId} onChange={setCompanyId}/>
            <div className="relative">
              {showDP && <div className="fixed inset-0 z-[999]" onClick={()=>setShowDP(false)}/>}
              <button ref={dateBtnRef} onClick={()=>setShowDP(!showDP)} className="neu-btn-xs flex items-center gap-1.5"><CalendarRange size={12}/> {data.range.startDate??"起始"} ~ {data.range.endDate??"至今"}</button>
              {showDP && createPortal(
                <div className="fixed z-[1000] w-[288px] rounded-[18px] bg-[var(--background)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.15)] ring-1 ring-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]" style={{top: (dateBtnRef.current?.getBoundingClientRect().bottom ?? 120) + 8, right: window.innerWidth - (dateBtnRef.current?.getBoundingClientRect().right ?? window.innerWidth - 16)}}>
                <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted-foreground)] mb-2">快捷选择</div>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {(["tm","tq","fh","fy","lm","lq"] as const).map(k=><button key={k} onClick={()=>dp[k]()} className="neu-btn-xs !px-2 !py-1 !text-[10px]">{{tm:"本月",tq:"本季度",fh:"上半年",fy:"全年",lm:"上月",lq:"上季度"}[k]}</button>)}
                </div>
                <hr className="wb-section-rule"/>
                <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted-foreground)] mb-2 mt-3">自定义范围</div>
                <div className="grid grid-cols-2 gap-2 mb-3"><div><label className="text-xs text-[var(--muted-foreground)] mb-1 block">起始</label><input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="neu-input !h-[32px] !text-[10px] !px-2"/></div><div><label className="text-xs text-[var(--muted-foreground)] mb-1 block">结束</label><input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="neu-input !h-[32px] !text-[10px] !px-2"/></div></div>
                <div className="flex items-center justify-between"><button onClick={hrdr} className="neu-btn-soft !py-1 !px-3 !text-[10px]">重置</button><button onClick={hadr} className="neu-btn-primary !h-[32px] !text-[10px] !px-3">应用</button></div>
              </div>,
                document.body
              )}
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 items-stretch gap-2.5">
          <KpiCard label="预算总金额" value={data.summary.totalBudgetLabel} signal="normal" index={1} reducedMotion={reducedMotion}/>
          <KpiCard label="未成交预算" value={data.summary.pendingBudgetLabel} signal={data.summary.pendingBudget>0?"warning":"normal"} index={2} reducedMotion={reducedMotion}/>
          <KpiCard label="已成交预算" value={data.summary.awardedBudgetLabel} signal="success" index={3} reducedMotion={reducedMotion}/>
          <KpiCard label="合同金额" value={data.summary.totalAwardLabel} signal="normal" index={4} reducedMotion={reducedMotion} showDivider="right"/>
          <KpiCard label="节约资金" value={data.summary.totalSavingsLabel} signal={data.summary.totalSavings>0?"success":"normal"} index={5} reducedMotion={reducedMotion}/>
          <KpiCard label="节资率" value={`${sr.toFixed(1)}%`} signal={sr>5?"success":"warning"} index={6} reducedMotion={reducedMotion} showDivider="right"/>
          <KpiCard label="开评标项目" value={`${data.summary.completedCount}/${data.summary.totalCount}`} index={7} reducedMotion={reducedMotion}/>
          <KpiCard label="项目推进率" value={`${cr.toFixed(0)}%`} signal={cr>=70?"success":cr>=50?"warning":"danger"} index={8} reducedMotion={reducedMotion}/>
        </div>
        </div>
      </motion.div>
      <div className="mb-3 grid grid-cols-1 items-stretch gap-2 md:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="flex h-full flex-col min-h-[280px] md:min-h-[300px]"><IntelligencePanel analysis={analysis} loading={alLoading} error={alErr} onRefresh={()=>hra(true)} index={7} reducedMotion={reducedMotion}/></div>
        <div className="flex h-full flex-col min-h-[280px] md:min-h-[300px]"><SavingsRankingPanel items={data.savingsRanking as SavingsRankingItem[]} index={8} reducedMotion={reducedMotion}/></div>
        <div className="flex h-full flex-col min-h-[280px] md:min-h-[300px] md:col-span-2 lg:col-span-1"><RiskProjectsPanel profile={data} index={9} reducedMotion={reducedMotion}/></div>
      </div>
      <div className="mb-3 grid grid-cols-1 items-stretch gap-2 md:grid-cols-2 lg:grid-cols-[1fr_1fr]">
        <div className="h-full min-h-[240px]"><SupplierCards suppliers={suppliers} index={13} reducedMotion={reducedMotion}/></div>
        <div className="h-full min-h-[240px]"><DepartmentPanel profile={data} index={14} reducedMotion={reducedMotion}/></div>
      </div>
      <div className="mb-3 grid grid-cols-1 items-stretch gap-2 md:grid-cols-2 lg:grid-cols-3">
        <div className="min-h-[280px]"><ProjectScalePanel profile={data} index={10} reducedMotion={reducedMotion}/></div>
        <div className="min-h-[280px]"><MethodPieChartPanel profile={data} index={11} reducedMotion={reducedMotion}/></div>
        <div className="min-h-[280px]"><NonAwardDonutPanel profile={data} index={12} reducedMotion={reducedMotion}/></div>
      </div>
      <AwardResultPanel/>
      <TrendChartPanel profile={data} index={15} reducedMotion={reducedMotion}/>
    </motion.div>
  </>;
}
