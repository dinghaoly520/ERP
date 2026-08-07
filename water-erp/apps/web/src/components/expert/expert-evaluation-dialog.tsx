'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createExpertEvaluation, aiSuggestEvaluation } from '@/lib/api/expert';
import type { ExpertListItem } from '@/lib/api/expert';
import { StatusBadge, Modal } from '@/components/workbench';
import { RefreshCw, Sparkles, Loader2, Brain } from 'lucide-react';
import { LEVEL_LABEL, LEVEL_COLOR, LEVEL_WEIGHT } from '@water-erp/shared';

const GRADE_OPTIONS = ['A', 'B', 'C', 'D', 'E'] as const;
const GRADE_COLOR: Record<string, string> = { A: '#059669', B: '#0a5eb8', C: '#d97706', D: '#ca8a04', E: '#dc2626' };
const GRADE_BG: Record<string, string> = { A: 'oklch(0.96 0.05 164 / 0.45)', B: 'oklch(0.96 0.04 251 / 0.45)', C: 'oklch(0.96 0.06 80 / 0.4)', D: 'oklch(0.96 0.06 80 / 0.25)', E: 'oklch(0.96 0.05 27 / 0.35)' };

const DIMENSIONS: { key: 'attendanceGrade' | 'qualityGrade' | 'disciplineGrade'; label: string; hint: string; weight: number }[] = [
  { key: 'attendanceGrade', label: '出勤纪律', hint: '按时签到、遵守评审纪律', weight: LEVEL_WEIGHT.attendanceGrade },
  { key: 'qualityGrade', label: '评审质量', hint: '评分客观、专业、有依据', weight: LEVEL_WEIGHT.qualityGrade },
  { key: 'disciplineGrade', label: '廉洁纪律', hint: '无违规、无利益输送', weight: LEVEL_WEIGHT.disciplineGrade },
];

const GRADE_VALUE: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const VALUE_GRADE: Record<number, string> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E' };

/**
 * 专家履职评价弹窗（从专家评价页提取，供专家库「操作」列调用）。
 * expert 非 null 即打开；切换 expert 自动重置评分。
 */
export function ExpertEvaluationDialog({
  expert,
  onClose,
  onSubmitted,
}: {
  expert: ExpertListItem | null;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [grades, setGrades] = useState({ attendanceGrade: 'B', qualityGrade: 'B', disciplineGrade: 'A' });
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggested, setAiSuggested] = useState(false);
  const [aiEngine, setAiEngine] = useState<'ai' | 'rules'>('ai');

  // expert 变化时重置
  useEffect(() => {
    if (!expert) return;
    setProjectId('');
    setGrades({ attendanceGrade: 'B', qualityGrade: 'B', disciplineGrade: 'A' });
    setEvidence({});
    setComment('');
    setAiLoading(false);
    setAiError('');
    setAiSuggested(false);
    setAiEngine('ai');
  }, [expert]);

  if (!expert) return null;

  const previewLevel = (() => {
    const w = LEVEL_WEIGHT;
    const weighted =
      GRADE_VALUE[grades.qualityGrade] * w.qualityGrade +
      GRADE_VALUE[grades.disciplineGrade] * w.disciplineGrade +
      GRADE_VALUE[grades.attendanceGrade] * w.attendanceGrade;
    return VALUE_GRADE[Math.max(1, Math.min(5, Math.round(weighted)))] || 'C';
  })();

  const runAiAnalysis = async () => {
    setAiLoading(true); setAiError(''); setAiSuggested(false);
    try {
      const res = await aiSuggestEvaluation(expert.id);
      setGrades({ attendanceGrade: res.attendanceGrade, qualityGrade: res.qualityGrade, disciplineGrade: res.disciplineGrade });
      setEvidence({
        attendanceGrade: `【出勤纪律·${LEVEL_LABEL[res.attendanceGrade] || res.attendanceGrade}级】${res.analysis}`,
        qualityGrade: `【评审质量·${LEVEL_LABEL[res.qualityGrade] || res.qualityGrade}级】${res.analysis}`,
        disciplineGrade: `【廉洁纪律·${LEVEL_LABEL[res.disciplineGrade] || res.disciplineGrade}级】${res.analysis}`,
      });
      setComment(res.analysis);
      setAiEngine(res.engine);
      setAiSuggested(true);
      toast.success(res.engine === 'ai' ? 'AI 分析完成，已自动选择等级并写入评价说明' : '规则兜底已写入评价说明（AI 暂不可用）');
    } catch (e: any) {
      setAiError(e?.message || 'AI 分析失败');
    }
    setAiLoading(false);
  };

  const submit = async () => {
    if (!projectId) { toast.error('请选择本次评价对应的评审项目'); return; }
    setSaving(true);
    try {
      await createExpertEvaluation({ expertUserId: expert.id, projectId, ...grades, comment: comment || undefined });
      toast.success('评价已提交');
      onSubmitted?.();
      onClose();
    } catch (e: any) { toast.error(e?.message || '评价失败'); }
    setSaving(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="专家履职评价"
      description={`${expert.displayName} · ${expert.expertProfile?.specialty}`}
      footer={
        <>
          <button onClick={onClose} className="neu-btn-soft">取消</button>
          <button onClick={submit} disabled={saving} className="neu-btn-soft is-success">{saving ? '提交中...' : '提交评价'}</button>
        </>
      }
    >
      {/* 关联项目 */}
      <div>
        <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">关联项目 <span className="text-[var(--danger)]">*</span></span>
        {expert.bidExperts.length === 0 ? (
          <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--warning)]">该专家尚未参与任何评审项目，无法发起履职评价</div>
        ) : (
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className="neu-input text-sm w-full">
            <option value="">请选择本次评价对应的评审项目</option>
            {expert.bidExperts.map(b => (
              <option key={b.project.id} value={b.project.id}>{b.project.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* AI 辅助分析栏 */}
      <div className="flex items-center gap-3 rounded-xl p-3 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {aiLoading ? (
            <><Loader2 size={14} className="animate-spin text-[var(--accent)]" /><span className="text-xs text-[var(--muted-foreground)]">AI 正在分析 {expert.displayName} 的历史评价、偏离度与履职数据…</span></>
          ) : aiSuggested ? (
            <><Brain size={14} className="text-[var(--accent)] flex-shrink-0" /><span className={`text-xs font-semibold flex-shrink-0 ${aiEngine === 'ai' ? 'text-[var(--accent)]' : 'text-[var(--warning)]'}`}>{aiEngine === 'ai' ? 'AI 已分析' : '规则兜底'}</span><span className="text-xs text-[var(--muted-foreground)] leading-relaxed">{aiEngine === 'ai' ? 'LLM 综合历史评价、偏离度、违规与负荷给出建议，已自动选择各维度等级并填入评价说明' : '基于历史数据与违规记录综合得出，AI 暂不可用'}</span></>
          ) : (
            <><Brain size={14} className="text-[var(--muted-foreground)]/40 flex-shrink-0" /><span className="text-xs text-[var(--muted-foreground)]">AI 可自动分析专家履职数据，完成后将直接填入各维度等级与评价说明</span></>
          )}
        </div>
        <button onClick={runAiAnalysis} disabled={aiLoading} className="neu-btn-soft flex-shrink-0">
          {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={13} />}
          {aiLoading ? '分析中' : aiSuggested ? '重新分析' : 'AI 分析'}
        </button>
      </div>
      {aiError && <p className="text-xs font-semibold text-[var(--danger)]">{aiError}</p>}

      {/* 三维等级评价 */}
      {DIMENSIONS.map(d => (
        <div key={d.key} className="rounded-xl p-4 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[var(--foreground)]">{d.label}</span>
              <span className="text-[11px] text-[var(--muted-foreground)] hidden sm:inline">{d.hint}</span>
            </div>
            <span className="text-xs font-bold text-[var(--muted-foreground)]">权重 ×{d.weight}</span>
          </div>
          <div className="flex gap-1.5">
            {GRADE_OPTIONS.map(g => {
              const selected = grades[d.key] === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrades({ ...grades, [d.key]: g })}
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
      ))}

      {/* 综合等级预览 */}
      <div className="flex items-center gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
        <span className="text-xs font-bold text-[var(--muted-foreground)]">综合等级</span>
        <StatusBadge tone={previewLevel === 'A' ? 'green' : previewLevel === 'B' ? 'blue' : previewLevel === 'C' ? 'orange' : previewLevel === 'D' ? 'orange' : 'red'}>{LEVEL_LABEL[previewLevel]}</StatusBadge>
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">质量×0.5 + 廉洁×0.3 + 出勤×0.2</span>
      </div>

      {/* 评价说明 */}
      <div>
        <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">评价说明</span>
        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={aiSuggested ? `${aiEngine === 'ai' ? 'AI' : '规则兜底'}已填入参考说明，可编辑或补充...` : '评价说明（可选）'} className="neu-input w-full h-20 resize-none text-sm" />
      </div>
    </Modal>
  );
}
