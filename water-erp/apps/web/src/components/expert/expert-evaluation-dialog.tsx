'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createExpertEvaluation, aiSuggestEvaluation,
  getEvaluationProjects, getEvaluationProjectDetail, analyzeExpertBehavior,
} from '@/lib/api/expert';
import type { ExpertListItem, ExpertEvaluationProject, EvaluationProjectDetail, ExpertBehaviorAnalysis } from '@/lib/api/expert';
import { StatusBadge, Modal } from '@/components/workbench';
import { Sparkles, Loader2, Brain, FileSearch, TrendingUp, TrendingDown } from 'lucide-react';
import { LEVEL_LABEL, LEVEL_WEIGHT, STAGE_LABEL } from '@water-erp/shared';

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

/** 参评状态短标注（关联项目下拉与选项文案） */
function participationLabel(p: ExpertEvaluationProject): string {
  if (p.reportConfirmed) return '已完成评标';
  if (p.scoreCount > 0) return '评分中';
  if (p.signedIn) return '已签到';
  if (p.invitationStatus === 'declined') return '已拒绝邀请';
  return p.invitationStatus === 'confirmed' ? '已确认·未评分' : '待确认';
}

const fmtDT = (v: string | null) => v
  ? new Date(v).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—';

const fmtPrice = (n: number | null) => n != null ? `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—';

/**
 * 专家履职评价弹窗（从专家评价页提取，供专家库「操作」列调用）。
 * expert 非 null 即打开；切换 expert 自动重置评分。
 * 关联项目 = 该专家真实参评项目（BidExpert 分配实数据）；
 * 「评标结果」按钮开窗展示该项目评标结果与本专家评分对照，并支持 AI 行为分析。
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

  // 关联项目（真实参评，独立端点实时拉取）
  const [projects, setProjects] = useState<ExpertEvaluationProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [resultOpen, setResultOpen] = useState(false);

  const loadProjects = (expertId: string) => {
    setProjectsLoading(true);
    setProjectsError('');
    getEvaluationProjects(expertId)
      .then(setProjects)
      .catch((e: { message?: string }) => setProjectsError(e?.message || '参评项目加载失败'))
      .finally(() => setProjectsLoading(false));
  };

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
    setProjects([]);
    setProjectsError('');
    setProjectsLoading(true);
    setResultOpen(false);
    // 取消保护：快速切换专家时，前一请求后到不得把旧数据盖进新对象的下拉
    let cancelled = false;
    getEvaluationProjects(expert.id)
      .then(list => { if (!cancelled) setProjects(list); })
      .catch((e: { message?: string }) => { if (!cancelled) setProjectsError(e?.message || '参评项目加载失败'); })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
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
      toast.success(res.engine === 'ai' ? 'AI 分析完成，已自动选择等级并写入评价说明' : '规则分析已写入评价说明（AI 暂不可用）');
    } catch (e: any) {
      setAiError(e?.message || 'AI 分析失败');
    }
    setAiLoading(false);
  };

  const submit = async () => {
    if (!projectId) { toast.error('请选择本次评价对应的评审项目'); return; }
    // 三维评价依据：AI 分析或手动填写的文本，随评价一并入库（只收非空维度）
    const evidencePayload = Object.fromEntries(
      DIMENSIONS.map(d => [d.key, (evidence[d.key] || '').trim()]).filter(([, v]) => v !== ''),
    );
    setSaving(true);
    try {
      await createExpertEvaluation({
        expertUserId: expert.id,
        projectId,
        ...grades,
        comment: comment || undefined,
        evidence: Object.keys(evidencePayload).length > 0 ? evidencePayload : undefined,
      });
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
      {/* 关联项目（真实参评，实时拉取） */}
      <div>
        <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">关联项目 <span className="text-[var(--danger)]">*</span></span>
        {projectsLoading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 size={12} className="animate-spin" /> 正在载入该专家的真实参评项目…
          </div>
        ) : projectsError ? (
          <div className="flex items-center gap-2 py-1 text-xs text-[var(--danger)]">
            {projectsError}
            <button onClick={() => expert && loadProjects(expert.id)} className="neu-btn-xs">重试</button>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--warning)]">该专家尚未参与任何评审项目，无法发起履职评价</div>
        ) : (
          <div className="flex items-center gap-2">
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="neu-input text-sm flex-1 min-w-0">
              <option value="">请选择本次评价对应的评审项目（{projects.length} 个真实参评记录）</option>
              {projects.map(p => (
                <option key={p.projectId} value={p.projectId}>
                  {p.project.name}（{STAGE_LABEL[p.project.stage] ?? p.project.stage} · {participationLabel(p)}{p.expertRole === '候补' ? ' · 候补' : ''}{p.resultsGenerated ? ' · 已出评标结果' : ''}）
                </option>
              ))}
            </select>
            <button
              onClick={() => setResultOpen(true)}
              disabled={!projectId}
              className="neu-btn-soft flex-shrink-0 inline-flex items-center gap-1.5"
              title={projectId ? '查看该项目的评标结果与本专家评分对照' : '请先选择关联项目'}
            >
              <FileSearch size={13} /> 评标结果
            </button>
          </div>
        )}
      </div>

      {/* 评标结果窗口（嵌套 Modal） */}
      {resultOpen && projectId && (
        <EvaluationResultModal
          expertId={expert.id}
          expertName={expert.displayName}
          projectId={projectId}
          onClose={() => setResultOpen(false)}
        />
      )}

      {/* AI 辅助分析栏 */}
      <div className="flex items-center gap-3 rounded-xl p-3 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {aiLoading ? (
            <><Loader2 size={14} className="animate-spin text-[var(--accent)]" /><span className="text-xs text-[var(--muted-foreground)]">AI 正在分析 {expert.displayName} 的历史评价、偏离度与履职数据…</span></>
          ) : aiSuggested ? (
            <><Brain size={14} className="text-[var(--accent)] flex-shrink-0" /><span className={`text-xs font-semibold flex-shrink-0 ${aiEngine === 'ai' ? 'text-[var(--accent)]' : 'text-[var(--warning)]'}`}>{aiEngine === 'ai' ? 'AI 已分析' : '规则分析'}</span><span className="text-xs text-[var(--muted-foreground)] leading-relaxed">{aiEngine === 'ai' ? 'AI 综合历史评价、偏离度、违规与负荷给出建议，已自动选择各维度等级并填入评价说明' : '基于历史数据与违规记录综合得出，AI 暂不可用'}</span></>
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
        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={aiSuggested ? `${aiEngine === 'ai' ? 'AI' : '规则分析'}已填入参考说明，可编辑或补充...` : '评价说明（可选）'} className="neu-input w-full h-20 resize-none text-sm" />
      </div>
    </Modal>
  );
}

/** 偏差着色：|d|≥5 红、≥2 橙、其余中性 */
function deviationClass(d: number | null): string {
  if (d == null) return 'text-[var(--muted-foreground)]';
  const abs = Math.abs(d);
  if (abs >= 5) return 'text-[var(--danger)] font-bold';
  if (abs >= 2) return 'text-[var(--warning)] font-semibold';
  return 'text-[var(--foreground)]';
}

/**
 * 评标结果窗口（履职评价弹窗内嵌套）：官方评标结果 ∪ 该专家已评分供应商，
 * 附该专家评分对照、行为统计与 AI 行为分析。
 */
function EvaluationResultModal({
  expertId, expertName, projectId, onClose,
}: {
  expertId: string; expertName: string; projectId: string; onClose: () => void;
}) {
  // 挂载即取数（组件按 projectId 条件渲染、切换即重建，loading/error 初始态即请求态）
  const [detail, setDetail] = useState<EvaluationProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ai, setAi] = useState<ExpertBehaviorAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getEvaluationProjectDetail(expertId, projectId)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch((e: { message?: string }) => { if (!cancelled) setError(e?.message || '评标结果加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [expertId, projectId]);

  const runBehaviorAnalysis = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      setAi(await analyzeExpertBehavior(expertId, projectId));
    } catch (e: any) {
      setAiError(e?.message || 'AI 行为分析失败');
    }
    setAiLoading(false);
  };

  const riskTone = (l: string): 'green' | 'orange' | 'red' => (l === '正常' ? 'green' : l === '关注' ? 'orange' : 'red');

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title="评标结果与专家评分对照"
      description={detail ? `${expertName} · ${detail.project.name}` : expertName}
      footer={<button onClick={onClose} className="neu-btn-soft">关闭</button>}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
          <Loader2 size={14} className="animate-spin" /> 正在载入评标结果与评分对照…
        </div>
      ) : error ? (
        <div className="py-6 text-sm text-[var(--danger)]">{error}</div>
      ) : !detail ? null : (
        <div className="space-y-4">
          {/* 项目与参与概况 */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge tone="blue">{STAGE_LABEL[detail.project.stage] ?? detail.project.stage}</StatusBadge>
            <span className="rounded-lg bg-[var(--surface)] px-2 py-1 text-[var(--muted-foreground)]">{detail.project.procurementMethod}</span>
            <span className="rounded-lg bg-[var(--surface)] px-2 py-1 text-[var(--muted-foreground)]">开标 {fmtDT(detail.project.openTime)}</span>
            <span className="rounded-lg bg-[var(--surface)] px-2 py-1 text-[var(--muted-foreground)]">委员会 正选{detail.committee.size}·签到{detail.committee.signedIn}·已交分{detail.committee.scored}</span>
            <span className={`rounded-lg px-2 py-1 ${detail.resultsGenerated ? 'bg-[color-mix(in_oklch,var(--success)_10%,transparent)] text-[var(--success)]' : 'bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] text-[var(--warning)]'}`}>
              {detail.resultsGenerated ? `评标结果已生成 · ${fmtDT(detail.generatedAt)}` : '评标结果未生成（评标中，下表均分为委员会实时口径）'}
            </span>
          </div>

          {/* 该专家流程合规留痕 */}
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {([
              ['已签到', detail.assignment.signedIn],
              ['身份核验', detail.assignment.identityVerified],
              ['回避确认', detail.assignment.avoidanceConfirmed],
              ['保密承诺', detail.assignment.confidentialityAgreed],
              ['纪律确认', detail.assignment.disciplineAgreed],
              ['报告确认', detail.assignment.reportConfirmed],
            ] as [string, boolean][]).map(([label, ok]) => (
              <span key={label} className={`rounded-md px-1.5 py-0.5 font-semibold ${ok ? 'bg-[color-mix(in_oklch,var(--success)_10%,transparent)] text-[var(--success)]' : 'bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] text-[var(--danger)]'}`}>
                {ok ? '✓' : '✗'} {label}
              </span>
            ))}
            {detail.assignment.isLead && <span className="rounded-md bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-1.5 py-0.5 font-semibold text-[var(--accent)]">评标组长</span>}
            {detail.assignment.dissentingOpinion && <span className="rounded-md bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-1.5 py-0.5 font-semibold text-[var(--warning)]">提交书面不同意见</span>}
          </div>

          {/* 评分对照表 */}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[var(--muted-foreground)]">
                  <th className="px-3 py-2 font-semibold">供应商</th>
                  <th className="px-3 py-2 font-semibold">名次</th>
                  <th className="px-3 py-2 font-semibold text-right">该专家总分</th>
                  <th className="px-3 py-2 font-semibold text-right">评标均分</th>
                  <th className="px-3 py-2 font-semibold text-right">偏差</th>
                  <th className="px-3 py-2 font-semibold text-right">报价（元）</th>
                  <th className="px-3 py-2 font-semibold">状态</th>
                </tr>
              </thead>
              <tbody>
                {detail.rows.map(r => (
                  <tr key={r.supplierId} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-3 py-2 font-semibold text-[var(--foreground)]">{r.supplierName}</td>
                    <td className="px-3 py-2 tabular-nums">{r.rank ? `第 ${r.rank} 名` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.expertScore ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.officialAverage ?? r.committeeMean ?? '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${deviationClass(r.deviation)}`}>
                      {r.deviation == null ? '—' : (
                        <span className="inline-flex items-center gap-0.5">
                          {r.deviation > 0 ? <TrendingUp size={11} /> : r.deviation < 0 ? <TrendingDown size={11} /> : null}
                          {r.deviation > 0 ? '+' : ''}{r.deviation}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPrice(r.bidPrice)}</td>
                    <td className="px-3 py-2">
                      {r.disqualified ? <StatusBadge tone="red">废标</StatusBadge>
                        : r.recommended ? <StatusBadge tone="green">中标候选</StatusBadge>
                        : <span className="text-[var(--muted-foreground)]">—</span>}
                    </td>
                  </tr>
                ))}
                {detail.rows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-[var(--muted-foreground)]">该项目暂无供应商评分/结果数据</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 行为统计 */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
            <span>逐项平均偏离 <b className={deviationClass(detail.scoreStats.meanItemDeviation)}>{detail.scoreStats.meanItemDeviation ?? '—'}</b> 分（{detail.scoreStats.deviationSamples} 个共识项）</span>
            <span>唯一极值 <b>{detail.scoreStats.extremeSupplierCount}</b> 家</span>
            <span>评分 <b>{detail.scoreStats.itemCount}</b> 项 · 修改 <b>{detail.scoreStats.editCount}</b> 次</span>
            <span>首次评分 {fmtDT(detail.scoreStats.firstScoredAt)} · 最后修订 {fmtDT(detail.scoreStats.lastScoredAt)}</span>
          </div>

          {/* AI 行为分析 */}
          <div className="rounded-xl border border-[var(--border)] p-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-0 text-xs text-[var(--muted-foreground)]">
                <Brain size={14} className={aiLoading ? 'animate-pulse text-[var(--accent)]' : 'text-[var(--accent)]/60 flex-shrink-0'} />
                {aiLoading ? 'AI 正在结合评标结果与历史履职分析该专家在此项目中的行为…'
                  : ai ? `${ai.engine === 'ai' ? 'AI 分析' : '规则分析'}完成`
                    : '基于该项目评分偏离、极值倾向、修改记录与合规留痕，AI 输出专家行为分析'}
              </div>
              <button onClick={runBehaviorAnalysis} disabled={aiLoading} className="neu-btn-soft flex-shrink-0 inline-flex items-center gap-1.5">
                {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={13} />}
                {aiLoading ? '分析中' : ai ? '重新分析' : 'AI 行为分析'}
              </button>
            </div>
            {aiError && <p className="mt-2 text-xs font-semibold text-[var(--danger)]">{aiError}</p>}
            {ai && (
              <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                <div className="flex items-center gap-2">
                  <StatusBadge tone={riskTone(ai.riskLevel)}>{ai.riskLevel}</StatusBadge>
                  <span className={`text-[10px] font-bold uppercase tracking-wide ${ai.engine === 'ai' ? 'text-[var(--accent)]' : 'text-[var(--warning)]'}`}>{ai.engine === 'ai' ? 'AI' : '规则分析'}</span>
                </div>
                <ul className="space-y-1">
                  {ai.findings.map((f, i) => (
                    <li key={i} className="flex gap-1.5 text-xs text-[var(--foreground)] leading-relaxed">
                      <span className="flex-shrink-0 text-[var(--accent)] font-extrabold">·</span>{f}
                    </li>
                  ))}
                </ul>
                <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{ai.analysis}</p>
                <p className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-2.5 py-1.5 text-xs text-[var(--foreground)]">
                  <b className="text-[var(--accent)]">管理建议：</b>{ai.suggestion}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
