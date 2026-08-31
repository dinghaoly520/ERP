'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * 供应商资格符合性分析面板（详情页右栏内嵌）：
 * AI 对照本次采购的资格条件逐条判定（符合/不符合/待核实 + 依据），
 * 按供应商+项目缓存结果；LLM 不可用回退库内资料粗判。
 */

interface MatchItem { requirement: string; status: '符合' | '不符合' | '待核实'; evidence: string; }
interface MatchResult {
  conclusion: '符合' | '部分符合' | '不符合';
  confidence: number;
  items: MatchItem[];
  summary: string;
  risks: string[];
  source: 'ai' | 'fallback';
  supplierName: string;
  projectName: string;
}

const STATUS_META: Record<MatchItem['status'], { icon: typeof CheckCircle2; cls: string }> = {
  '符合': { icon: CheckCircle2, cls: 'text-[var(--success)]' },
  '不符合': { icon: XCircle, cls: 'text-[var(--danger)]' },
  '待核实': { icon: HelpCircle, cls: 'text-[var(--warning)]' },
};

const CONCLUSION_META: Record<MatchResult['conclusion'], { label: string; cls: string; icon: typeof ShieldCheck }> = {
  '符合': { label: '符合采购要求', cls: 'text-[var(--success)]', icon: ShieldCheck },
  '部分符合': { label: '部分符合（有待核实项）', cls: 'text-[var(--warning)]', icon: CircleDashed },
  '不符合': { label: '不符合采购要求', cls: 'text-[var(--danger)]', icon: XCircle },
};

export function QualificationAnalysisPanel({
  supplierId,
  supplierName,
  projectId,
}: {
  supplierId: string;
  supplierName: string;
  projectId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MatchResult | null>(null);
  const lastKey = useRef('');

  const run = useCallback(async () => {
    if (!supplierId || !projectId) { toast.error('未关联项目，无法分析'); return; }
    setLoading(true);
    try {
      const res = await api.post<MatchResult>('/ai/supplier-qualification-match', { supplierId, projectId });
      setResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '分析失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [supplierId, projectId]);

  // 换供应商/项目 → 缓存失效；详情页打开即自动分析（同供应商不重复调用）
  useEffect(() => {
    const key = `${supplierId}:${projectId}`;
    if (lastKey.current !== key) {
      lastKey.current = key;
      setResult(null);
    }
  }, [supplierId, projectId]);

  useEffect(() => {
    if (supplierId && projectId && !result && !loading) void run();
  }, [supplierId, projectId, result, loading, run]);

  const ConclusionIcon = result ? CONCLUSION_META[result.conclusion].icon : null;

  return (
    <div className="flex h-full flex-col">
      {/* 面板头 */}
      <div className="flex items-center justify-between gap-2 pb-2.5 mb-3" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.16)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck size={14} className="text-[var(--accent)] shrink-0" />
          <span className="text-xs font-bold text-[color:var(--foreground)]">资格符合性分析</span>
          <span className="text-[10px] text-[var(--muted-foreground)] truncate">对照本项目资格条件</span>
        </div>
        <button type="button" onClick={() => void run()} disabled={loading} className="neu-btn-xs shrink-0" title="重新分析">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14">
            <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
            <p className="text-xs text-[var(--muted-foreground)]">AI 正在逐条对照资格条件…</p>
            <p className="text-[10px] text-[var(--muted-foreground)]/70">通常需要 10~30 秒</p>
          </div>
        ) : result ? (
          <div className="space-y-3.5">
            {/* 结论卡 */}
            <div className="rounded-[14px] px-3.5 py-3.5 flex items-center gap-3"
              style={{ background: 'oklch(1 0 0 / 0.52)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 2px 4px oklch(0.55 0.03 258 / 0.08)' }}>
              {ConclusionIcon && <ConclusionIcon size={30} className={CONCLUSION_META[result.conclusion].cls} strokeWidth={1.8} />}
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] font-bold ${CONCLUSION_META[result.conclusion].cls}`}>{CONCLUSION_META[result.conclusion].label}</div>
                <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                  置信度 {Math.round(result.confidence * 100)}% · {result.source === 'ai' ? 'AI 逐条对照' : '库内资料粗判'}
                </div>
              </div>
            </div>

            {/* 逐条对照 */}
            <div className="space-y-1.5">
              <h4 className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">逐条对照</h4>
              {result.items.map((it, i) => {
                const meta = STATUS_META[it.status];
                const Icon = meta.icon;
                return (
                  <div key={i} className="rounded-[12px] px-3 py-2.5"
                    style={{ background: 'oklch(1 0 0 / 0.45)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                    <div className="flex items-start gap-2">
                      <Icon size={13} className={`${meta.cls} shrink-0 mt-0.5`} strokeWidth={2} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold text-[color:var(--foreground)] leading-snug">{it.requirement}</div>
                        <div className="mt-1 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
                          <span className={`font-bold ${meta.cls}`}>{it.status}</span> — {it.evidence}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 总结 */}
            {result.summary && (
              <div className="rounded-[12px] px-3 py-2.5" style={{ background: 'color-mix(in oklch, var(--accent) 5%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.4)' }}>
                <h4 className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)] mb-1">分析总结</h4>
                <p className="text-[11px] leading-relaxed text-[color:var(--foreground)]">{result.summary}</p>
              </div>
            )}

            {/* 风险 */}
            {result.risks.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">风险提示</h4>
                {result.risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-[12px] px-3 py-2"
                    style={{ background: 'color-mix(in oklch, var(--warning) 7%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.4)' }}>
                    <AlertTriangle size={12} className="text-[var(--warning)] shrink-0 mt-0.5" />
                    <span className="text-[10px] leading-relaxed text-[color:var(--foreground)]">{r}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[9px] leading-relaxed text-[var(--muted-foreground)] px-1 pb-1">
              分析依据为供应商库内资料（资质/业绩/经营范围/历史评价），不构成资格审查结论；最终资格认定以资格审查结果为准。
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-14">
            <p className="text-xs text-[var(--muted-foreground)]">尚未分析{supplierName ? `「${supplierName}」` : ''}，点击右上角刷新开始</p>
          </div>
        )}
      </div>
    </div>
  );
}
