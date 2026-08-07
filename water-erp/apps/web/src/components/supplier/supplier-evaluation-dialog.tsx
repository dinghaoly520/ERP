'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getSupplierEvaluationAnalysis, getSupplierEvaluations, createEvaluation } from '@/lib/api/supplier';
import type { DimensionAnalysis, EvaluationAnalysisResult } from '@/lib/api/supplier';
import type { Supplier, SupplierEvaluation } from '@/lib/types';
import { StatusBadge, Modal } from '@/components/workbench';
import { Sparkles, Loader2, Brain } from 'lucide-react';
import { LEVEL_LABEL, LEVEL_COLOR } from '@water-erp/shared';

const GRADES = ['A', 'B', 'C', 'D', 'E'] as const;

const DIMENSIONS: { key: keyof EvalGrades; label: string; hint: string; weight: number }[] = [
  { key: 'completenessGrade', label: '资料完整性(20%)', hint: '资质材料、投标文件的完整与规范程度', weight: 0.20 },
  { key: 'responsivenessGrade', label: '响应及时性(30%)', hint: '沟通回复与问题响应速度', weight: 0.30 },
  { key: 'cooperationGrade', label: '配合协作(20%)', hint: '履约过程中的配合与协作意愿', weight: 0.20 },
  { key: 'complianceGrade', label: '合规守信(20%)', hint: '合同履约、合规与诚信情况', weight: 0.20 },
  { key: 'comprehensiveGrade', label: '综合评价(10%)', hint: '对供应商的总体评价', weight: 0.10 },
];
type EvalGrades = { completenessGrade: string; responsivenessGrade: string; cooperationGrade: string; complianceGrade: string; comprehensiveGrade: string };
const DEFAULTS: EvalGrades = { completenessGrade: '', responsivenessGrade: '', cooperationGrade: '', complianceGrade: '', comprehensiveGrade: '' };

const GRADE_COLOR: Record<string, string> = { A: '#059669', B: '#0a5eb8', C: '#d97706', D: '#ca8a04', E: '#dc2626' };
const GRADE_BG: Record<string, string> = { A: 'oklch(0.96 0.05 164 / 0.45)', B: 'oklch(0.96 0.04 251 / 0.45)', C: 'oklch(0.96 0.06 80 / 0.4)', D: 'oklch(0.96 0.06 80 / 0.25)', E: 'oklch(0.96 0.05 27 / 0.35)' };
const gradeTone = (g: string) => (g === 'A' ? 'green' : g === 'B' ? 'blue' : g === 'E' ? 'red' : 'orange') as 'green' | 'blue' | 'orange' | 'red';

function computeFinalGrade(grades: EvalGrades): string {
  let totalWeight = 0, scoreSum = 0;
  for (const d of DIMENSIONS) {
    const g = grades[d.key];
    const sortVal = GRADES.indexOf(g as any) >= 0 ? (5 - GRADES.indexOf(g as any)) : 0;
    if (g) { scoreSum += sortVal * d.weight; totalWeight += d.weight; }
  }
  if (totalWeight === 0) return '';
  const avg = scoreSum / totalWeight;
  if (avg >= 4.5) return 'A';
  if (avg >= 3.5) return 'B';
  if (avg >= 2.5) return 'C';
  if (avg >= 1.5) return 'D';
  return 'E';
}

/**
 * 供应商评价弹窗（从供应商评价页提取，供供应商库「操作」列调用）。
 * supplier 非 null 即打开；切换 supplier 自动重置评分与历史。
 */
export function SupplierEvaluationDialog({
  supplier,
  onClose,
  onSubmitted,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const [history, setHistory] = useState<SupplierEvaluation[]>([]);
  const [grades, setGrades] = useState<EvalGrades>(DEFAULTS);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiResult, setAiResult] = useState<EvaluationAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // supplier 变化时重置 + 拉历史
  useEffect(() => {
    if (!supplier) { setHistory([]); setGrades(DEFAULTS); setEvidence({}); setComment(''); setAiResult(null); setAiError(''); return; }
    setGrades(DEFAULTS); setEvidence({}); setComment(''); setAiResult(null); setAiError('');
    getSupplierEvaluations(supplier.id).then(setHistory).catch(() => setHistory([]));
  }, [supplier]);

  if (!supplier) return null;

  const runAiAnalysis = async () => {
    setAiLoading(true); setAiError('');
    try {
      const res = await getSupplierEvaluationAnalysis(supplier.id);
      setAiResult(res);
      const autoGrades = { ...grades };
      const autoEvidence = { ...evidence };
      res.dimensions.forEach((d: DimensionAnalysis) => {
        const dim = DIMENSIONS.find(dm => dm.label === d.dimension);
        if (dim && d.suggestedGrade) {
          autoGrades[dim.key] = d.suggestedGrade;
          autoEvidence[dim.key] = d.rationale;
        }
      });
      setGrades(autoGrades);
      setEvidence(autoEvidence);
      const aiSummary = res.dimensions.map(d => `【${d.dimension}】${d.suggestedGrade}级：${d.rationale}`).join('\n');
      setComment(`${aiSummary}\n\n综合建议等级：${LEVEL_LABEL[res.overallGrade] || res.overallGrade} 级\n${res.summary}`);
      toast.success(`AI 已自动选择等级并写入评价说明（综合建议 ${LEVEL_LABEL[res.overallGrade] || res.overallGrade} 级）`);
    } catch (e: any) {
      setAiError(e?.message || 'AI 分析失败，请手动评分');
      toast.error('AI 分析失败，可继续手动评分');
    }
    setAiLoading(false);
  };

  const finalGrade = computeFinalGrade(grades);
  const hasAnyGrade = Object.values(grades).some(g => g !== '');

  const submit = async () => {
    const missingEvidence = DIMENSIONS.filter(d => !evidence[d.key]);
    if (missingEvidence.length > 0) {
      toast.error(`请为以下维度填写评价依据：${missingEvidence.slice(0, 2).map(d => d.label.replace(/\(\d+%\)/, '')).join('、')}${missingEvidence.length > 2 ? '等' : ''}`);
      return;
    }
    if (!hasAnyGrade) { toast.error('请至少为各维度选择等级后再提交'); return; }
    setSaving(true);
    try {
      await createEvaluation(supplier.id, { ...grades, comment: comment || undefined, evidence });
      toast.success('评价已提交');
      setHistory(await getSupplierEvaluations(supplier.id));
      onSubmitted?.();
      onClose();
    } catch (e: any) { toast.error(e?.message || '评价提交失败'); }
    setSaving(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={<span className="flex items-center gap-2">{supplier.name}<StatusBadge tone="blue">评价</StatusBadge></span>}
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <span className="text-xs text-[var(--muted-foreground)]">{saving ? '提交中...' : '每个维度需填写评价依据'}</span>
          <div className="flex gap-3">
            <button onClick={onClose} className="neu-btn-soft">取消</button>
            <button onClick={submit} disabled={saving} className="neu-btn-soft is-success">{saving ? '提交中...' : '提交评价'}</button>
          </div>
        </div>
      }
    >
      {/* AI 状态栏 */}
      <div className="flex items-center gap-3 rounded-xl p-3 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {aiLoading ? (
            <><Loader2 size={14} className="animate-spin text-[var(--accent)]" /><span className="text-xs text-[var(--muted-foreground)]">AI 正在分析 {supplier.name} 的资质、历史评价与项目参与数据…</span></>
          ) : aiResult ? (
            <>
              <Brain size={14} className="text-[var(--accent)] flex-shrink-0" />
              <span className="text-xs text-[var(--accent)] font-semibold flex-shrink-0">AI 已分析</span>
              <span className="text-xs text-[var(--muted-foreground)] leading-relaxed">{aiResult.summary}</span>
            </>
          ) : (
            <>
              <Brain size={14} className="text-[var(--muted-foreground)]/40 flex-shrink-0" />
              <span className="text-xs text-[var(--muted-foreground)]">AI 可自动分析供应商数据，完成后将直接填入各维度等级与评价依据</span>
            </>
          )}
        </div>
        <button onClick={runAiAnalysis} disabled={aiLoading} className="neu-btn-soft flex-shrink-0">
          {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={13} />}
          {aiLoading ? '分析中' : aiResult ? '重新分析' : 'AI 分析'}
        </button>
      </div>
      {aiError && <p className="text-xs font-semibold text-[var(--danger)]">{aiError}</p>}

      {/* 评分维度 */}
      {DIMENSIONS.map(d => {
        const curGrade = grades[d.key];
        return (
          <div key={d.key} className="rounded-xl p-4 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm font-bold text-[var(--foreground)]">{d.label}</span>
                <span className="text-[11px] text-[var(--muted-foreground)] hidden sm:inline">{d.hint}</span>
              </label>
              {curGrade && (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[curGrade] }}>{curGrade}</span>
              )}
            </div>
            <div className="flex gap-1.5">
              {GRADES.map(g => {
                const selected = curGrade === g;
                return (
                  <button
                    key={g}
                    onClick={() => setGrades(prev => ({ ...prev, [d.key]: g }))}
                    style={selected ? { backgroundColor: GRADE_BG[g], color: GRADE_COLOR[g], fontWeight: 700 } : undefined}
                    className="neu-btn-soft flex-1 text-xs font-semibold transition-colors"
                  >
                    {g} · {LEVEL_LABEL[g]}
                  </button>
                );
              })}
            </div>
            <textarea
              value={evidence[d.key] || ''}
              onChange={e => setEvidence(prev => ({ ...prev, [d.key]: e.target.value }))}
              placeholder="评价依据（必填）：基于哪些具体事实或数据得出此等级？"
              className="neu-input w-full h-14 resize-none text-xs mt-2"
            />
          </div>
        );
      })}

      {/* 综合等级预览 */}
      <div className="flex items-center gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
        <span className="text-xs font-bold text-[var(--muted-foreground)]">综合等级</span>
        {finalGrade ? (
          <>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[finalGrade] }}>{finalGrade}</span>
            <StatusBadge tone={gradeTone(finalGrade)}>{LEVEL_LABEL[finalGrade]}（{finalGrade}级）</StatusBadge>
          </>
        ) : (
          <span className="text-sm text-[var(--muted-foreground)]">请选择各维度等级</span>
        )}
        <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">权重: 资料20%+响应30%+配合20%+合规20%+综合10%</span>
      </div>

      <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="总体评价说明（可选）" className="neu-input w-full h-20 resize-none text-sm" />

      {/* 历史评价 */}
      {history.length > 0 && (
        <>
          <hr className="wb-section-rule" />
          <div>
            <h4 className="text-sm font-bold text-[var(--foreground)] mb-2">历史评价（{history.length}）</h4>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {history.map(ev => {
                const fg = ev.finalGrade || 'E';
                const tone = gradeTone(fg);
                let evidenceText = '';
                try {
                  const evData = (ev as any).evidence as Record<string, string> | undefined;
                  if (evData) {
                    evidenceText = Object.entries(evData).slice(0, 5).map(([k, v]) => `${DIMENSIONS.find(d => d.key === k)?.label || k}: ${(v as string).slice(0, 30)}`).join(' · ');
                  }
                } catch {}
                return (
                  <div key={ev.id} className="rounded-lg bg-[var(--surface)] p-2.5 text-xs shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ backgroundColor: LEVEL_COLOR[fg] }}>{fg}</span>
                      <StatusBadge tone={tone}>{LEVEL_LABEL[fg]}</StatusBadge>
                      <span className="text-[var(--muted-foreground)]">{ev.evaluator?.displayName || '—'}</span>
                      <span className="ml-auto text-[var(--muted-foreground)]">{new Date(ev.createdAt).toLocaleDateString('zh-CN')}</span>
                    </div>
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {(['completenessGrade', 'responsivenessGrade', 'cooperationGrade', 'complianceGrade', 'comprehensiveGrade'] as const).map(k => {
                        const v = (ev as any)[k] as string | undefined;
                        if (!v) return null;
                        const dimLabel = DIMENSIONS.find(d => d.key === k)?.label.replace(/\(\d+%\)/, '') || k;
                        return (
                          <span key={k} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold" style={{ backgroundColor: LEVEL_COLOR[v] + '20', color: LEVEL_COLOR[v] }}>
                            {dimLabel}:{v}
                          </span>
                        );
                      })}
                    </div>
                    {ev.comment && <p className="mt-1 text-[var(--muted-foreground)]">{ev.comment.slice(0, 200).replace(/\n--- 评价依据 ---[\s\S]*/, '')}</p>}
                    {evidenceText && <p className="mt-0.5 text-[var(--muted-foreground)]/60 text-[10px]">{evidenceText}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
