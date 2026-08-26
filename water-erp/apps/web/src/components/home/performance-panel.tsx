'use client';

/**
 * E1（GB/T 43711 第 9 章）：采购质效卡——五项统计指标 + 评分卡登记 + 周期报告 DOCX。
 * 挂 :3005 驾驶舱（AwardResultPanel 之下）。
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Gauge, Plus, FileText, Loader2 } from 'lucide-react';
import { Modal } from '@/components/workbench';
import {
  getPerformanceMetrics, listEvaluations, createEvaluation, generatePerformanceReport,
  type PerformanceMetrics, type ProjectEvaluationItem,
} from '@/lib/api/performance';

const KPI = [
  { key: 'avgCycleDays', label: '采购周期', suffix: '天', hint: '立项→签约均值' },
  { key: 'savingsRate', label: '节资率', suffix: '%', hint: '预算 vs 成交' },
  { key: 'competitionAvg', label: '竞争充分性', suffix: '家', hint: '项目均有效供应商' },
  { key: 'objectionRate', label: '异议率', suffix: '%', hint: '异议工单/项目' },
  { key: 'acceptanceRate', label: '履约达标率', suffix: '%', hint: '已验收/已签署' },
  { key: 'satisfactionAvg', label: '满意度', suffix: '分', hint: '供应商 1-5 评价' },
] as const;

export function PerformancePanel() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [evaluations, setEvaluations] = useState<ProjectEvaluationItem[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ projectCode: '', projectName: '', quality: '85', efficiency: '85', compliance: '90', period: '', comment: '' });

  const load = useCallback(() => {
    getPerformanceMetrics().then(setMetrics).catch(() => setMetrics(null));
    listEvaluations().then(setEvaluations).catch(() => setEvaluations([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.projectCode.trim() || !form.projectName.trim()) { toast.error('请填写项目编号与名称'); return; }
    setBusy(true);
    try {
      await createEvaluation({
        projectCode: form.projectCode.trim(), projectName: form.projectName.trim(),
        qualityScore: Number(form.quality), efficiencyScore: Number(form.efficiency), complianceScore: Number(form.compliance),
        period: form.period || undefined, comment: form.comment || undefined,
      });
      toast.success('评分卡已登记（服务端按 40/30/30 加权，可经 SystemConfig 调整）');
      setDialogOpen(false);
      load();
    } catch (e: any) { toast.error(e?.message || '登记失败'); }
    finally { setBusy(false); }
  };

  const downloadReport = async () => {
    setBusy(true);
    try {
      const r = await generatePerformanceReport();
      toast.success(`质效报告 DOCX 已生成（${Math.round(r.size / 1024)} KB）`);
    } catch (e: any) { toast.error(e?.message || '生成失败'); }
    finally { setBusy(false); }
  };

  return (
    <section className="wb-panel mb-3 px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-[9px]" style={{ background: 'var(--accent-soft)' }}>
            <Gauge size={14} className="text-[var(--accent)]" />
          </div>
          <span className="text-sm font-bold">采购质效</span>
          <span className="text-[10px] text-[var(--muted-foreground)]">GB/T 43711 第 9 章{metrics ? ` · ${metrics.period.from} ~ ${metrics.period.to}` : ''}</span>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setDialogOpen(true)} disabled={busy} className="neu-btn-xs !text-[10px]"><Plus size={10} /> 评分卡</button>
          <button onClick={downloadReport} disabled={busy} className="neu-btn-xs !text-[10px]">{busy ? <Loader2 size={10} className="animate-spin" /> : <FileText size={10} />} 质效报告</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {KPI.map(k => {
          const v = metrics ? metrics[k.key] : null;
          return (
            <div key={k.key} className="rounded-[12px] bg-[var(--surface)] px-3 py-2.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.55),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.7)]">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{k.label}</span>
              <p className="mt-0.5 text-lg font-black tabular-nums text-[var(--foreground)]">
                {v ?? '—'}{v != null && <small className="ml-0.5 text-[10px] font-bold text-[var(--muted-foreground)]">{k.suffix}</small>}
              </p>
              <span className="text-[9px] text-[var(--muted-foreground)]">{k.hint}</span>
            </div>
          );
        })}
      </div>

      {evaluations && evaluations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {evaluations.slice(0, 8).map(ev => (
            <span key={ev.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px]"
              style={{ borderColor: 'color-mix(in oklch, var(--accent) 20%, transparent)', background: 'color-mix(in oklch, var(--accent) 6%, transparent)' }}>
              <span className="font-mono text-[var(--accent)]">{ev.projectCode}</span>
              <span className="font-black tabular-nums text-[var(--accent-strong)]">{ev.weightedScore}</span>
              <span className="text-[var(--muted-foreground)]">质{ev.qualityScore}/效{ev.efficiencyScore}/合{ev.complianceScore}</span>
            </span>
          ))}
        </div>
      )}

      <Modal open={dialogOpen} onClose={() => setDialogOpen(false)} title="项目质效评分卡" description="GB/T 43711 9.1/9.3——质量/效率/合规三维（0-100），服务端加权" size="md">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">项目编号</span>
            <input value={form.projectCode} onChange={e => setForm({ ...form, projectCode: e.target.value })} className="neu-input !h-[32px] !text-xs" />
          </label>
          <label className="space-y-1">
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">项目名称</span>
            <input value={form.projectName} onChange={e => setForm({ ...form, projectName: e.target.value })} className="neu-input !h-[32px] !text-xs" />
          </label>
          {([['quality', '质量维度'], ['efficiency', '效率维度'], ['compliance', '合规维度']] as const).map(([k, label]) => (
            <label key={k} className="space-y-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}（0-100）</span>
              <input type="number" min={0} max={100} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} className="neu-input !h-[32px] !text-xs" />
            </label>
          ))}
          <label className="space-y-1">
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">评价周期（选填）</span>
            <input value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} placeholder="如 2026-Q3" className="neu-input !h-[32px] !text-xs" />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">评语（选填）</span>
            <textarea value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} className="neu-input h-16 !text-xs resize-y" />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={submit} disabled={busy} className="neu-btn-primary !h-[30px] !px-3 !text-xs">{busy ? '提交中…' : '登记评分卡'}</button>
        </div>
      </Modal>
    </section>
  );
}
